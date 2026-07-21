/**
 * properties.routes.js - Properties and units management.
 *
 * GET  /api/properties              - list accessible properties
 * POST /api/properties              - create property (owner+)
 * GET  /api/properties/:id          - property detail + units
 * PATCH /api/properties/:id         - update property
 * POST /api/properties/:id/units    - add unit
 * PATCH /api/properties/:id/units/:uid - update unit
 * GET  /api/properties/:id/staff    - list assigned staff
 * POST /api/properties/:id/staff    - assign staff member
 * DELETE /api/properties/:id/staff/:userId - remove assignment
 */

const express      = require('express');
const pool         = require('../db/client');
const authenticate = require('../middleware/authenticate');
const { Guards }   = require('../middleware/authorize');
const { staffOnly } = Guards;

const router = express.Router();
router.use(authenticate);
router.use(staffOnly);

async function accessiblePropertyIds(userId, userRole) {
  if (['super_admin', 'owner'].includes(userRole)) {
    const { rows } = await pool.query(
      `SELECT p.id FROM properties p
       JOIN users u ON u.org_id = p.org_id WHERE u.id = $1`,
      [userId]
    );
    return rows.map(r => r.id);
  }
  const { rows } = await pool.query(
    `SELECT property_id AS id FROM property_assignments WHERE user_id = $1`,
    [userId]
  );
  return rows.map(r => r.id);
}

// GET /api/properties
router.get('/', async (req, res) => {
  try {
    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    if (!propIds.length) return res.json({ properties: [] });
    const { rows } = await pool.query(
      `SELECT p.*,
              COUNT(DISTINCT u.id) AS unit_count,
              COUNT(DISTINCT u.id) FILTER (
                WHERE EXISTS (
                  SELECT 1 FROM leases lx
                   WHERE lx.unit_id = u.id AND lx.status = 'active'
                )
              ) AS occupied_count,
              COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'active') AS active_lease_count,
              COUNT(DISTINCT mr.id) FILTER (WHERE mr.status NOT IN ('resolved','cancelled')) AS open_maintenance_count
       FROM properties p
       LEFT JOIN units u ON u.property_id = p.id
       LEFT JOIN leases l ON l.unit_id = u.id
       LEFT JOIN maintenance_requests mr ON mr.unit_id = u.id
       WHERE p.id = ANY($1)
       GROUP BY p.id
       ORDER BY p.name`,
      [propIds]
    );
    res.json({ properties: rows });
  } catch (err) {
    console.error('[GET /properties]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/properties
router.post('/', async (req, res) => {
  if (!['super_admin','owner'].includes(req.user.role))
    return res.status(403).json({ error: 'Only owners can create properties' });
  const { name, address_line1, address_line2, city, state, zip, country } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows: orgRows } = await pool.query(
      `SELECT org_id FROM users WHERE id = $1`, [req.user.id]
    );
    if (!orgRows.length || !orgRows[0].org_id)
      return res.status(400).json({ error: 'User has no organization' });
    const { rows } = await pool.query(
      `INSERT INTO properties (org_id, name, address_line1, address_line2, city, state, zip, country)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [orgRows[0].org_id, name.trim(), address_line1 ?? null, address_line2 ?? null,
       city ?? null, state ?? null, zip ?? null, country ?? 'US']
    );
    res.status(201).json({ property: rows[0] });
  } catch (err) {
    console.error('[POST /properties]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/properties/:id
router.get('/:id', async (req, res) => {
  try {
    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    if (!propIds.includes(req.params.id))
      return res.status(403).json({ error: 'Access denied' });
    const [propR, unitsR, staffR] = await Promise.all([
      pool.query(`SELECT * FROM properties WHERE id = $1`, [req.params.id]),
      pool.query(
        `SELECT u.*,
                l.id AS lease_id, l.status AS lease_status,
                l.monthly_rent, l.start_date, l.end_date,
                (t.first_name || ' ' || t.last_name) AS tenant_name, t.email AS tenant_email
         FROM units u
         LEFT JOIN LATERAL (
           SELECT id, status, monthly_rent, start_date, end_date, tenant_id
           FROM leases WHERE unit_id = u.id AND status IN ('active','pending_signature','draft')
           ORDER BY created_at DESC LIMIT 1
         ) l ON TRUE
         LEFT JOIN users t ON t.id = l.tenant_id
         WHERE u.property_id = $1
         ORDER BY u.unit_number`,
        [req.params.id]
      ),
      pool.query(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.role, pa.assigned_at
         FROM property_assignments pa
         JOIN users u ON u.id = pa.user_id
         WHERE pa.property_id = $1`,
        [req.params.id]
      ),
    ]);
    if (!propR.rows.length) return res.status(404).json({ error: 'Property not found' });
    res.json({ property: propR.rows[0], units: unitsR.rows, staff: staffR.rows });
  } catch (err) {
    console.error('[GET /properties/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/properties/:id
router.patch('/:id', async (req, res) => {
  if (!['super_admin','owner'].includes(req.user.role))
    return res.status(403).json({ error: 'Only owners can edit properties' });
  const allowed = [
    'name', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'country',
    'dominion_account_number', 'norfolk_utilities_account_number',
  ];
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields' });
  try {
    const setClauses = updates.map(([k], i) => `${k} = $${i + 1}`).join(', ');
    const values = [...updates.map(([, v]) => v), req.params.id];
    const { rows } = await pool.query(
      `UPDATE properties SET ${setClauses}, updated_at=NOW() WHERE id=$${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Property not found' });
    res.json({ property: rows[0] });
  } catch (err) {
    console.error('[PATCH /properties/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/properties/:id/units
router.post('/:id/units', async (req, res) => {
  const { unit_number, bedrooms, bathrooms, square_feet, floor_number } = req.body;
  if (!unit_number?.trim()) return res.status(400).json({ error: 'unit_number is required' });
  try {
    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    if (!propIds.includes(req.params.id))
      return res.status(403).json({ error: 'Access denied' });
    const { rows } = await pool.query(
      `INSERT INTO units (property_id, unit_number, bedrooms, bathrooms, square_feet, floor_number)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, unit_number.trim(),
       bedrooms ?? null, bathrooms ?? null, square_feet ?? null, floor_number ?? null]
    );
    res.status(201).json({ unit: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Unit number already exists in this property' });
    console.error('[POST /properties/:id/units]', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/properties/:id/units/:uid
router.patch('/:id/units/:uid', async (req, res) => {
  const allowed = ['unit_number','bedrooms','bathrooms','square_feet','floor_number','is_occupied'];
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields' });
  try {
    const setClauses = updates.map(([k], i) => `${k} = $${i + 1}`).join(', ');
    const values = [...updates.map(([, v]) => v), req.params.uid];
    const { rows } = await pool.query(
      `UPDATE units SET ${setClauses}, updated_at=NOW() WHERE id=$${values.length} AND property_id=$${values.length + 1} RETURNING *`,
      [...values, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Unit not found' });
    res.json({ unit: rows[0] });
  } catch (err) {
    console.error('[PATCH /properties/:id/units/:uid]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/properties/:id/staff
router.get('/:id/staff', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.role, pa.assigned_at
       FROM property_assignments pa JOIN users u ON u.id = pa.user_id
       WHERE pa.property_id = $1 ORDER BY u.last_name`,
      [req.params.id]
    );
    res.json({ staff: rows });
  } catch (err) {
    console.error('[GET /properties/:id/staff]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/properties/:id/staff
router.post('/:id/staff', async (req, res) => {
  if (!['super_admin','owner'].includes(req.user.role))
    return res.status(403).json({ error: 'Only owners can assign staff' });
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  try {
    await pool.query(
      `INSERT INTO property_assignments (property_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.params.id, user_id]
    );
    res.status(201).json({ assigned: true });
  } catch (err) {
    console.error('[POST /properties/:id/staff]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/properties/:id/staff/:userId
router.delete('/:id/staff/:userId', async (req, res) => {
  if (!['super_admin','owner'].includes(req.user.role))
    return res.status(403).json({ error: 'Only owners can remove staff' });
  try {
    await pool.query(
      `DELETE FROM property_assignments WHERE property_id=$1 AND user_id=$2`,
      [req.params.id, req.params.userId]
    );
    res.json({ removed: true });
  } catch (err) {
    console.error('[DELETE /properties/:id/staff]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
