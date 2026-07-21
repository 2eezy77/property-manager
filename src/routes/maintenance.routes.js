/**
 * maintenance.routes.js - Maintenance request endpoints.
 */
const express = require('express');
const pool = require('../db/client');
const authenticate = require('../middleware/authenticate');
const { Guards } = require('../middleware/authorize');
const { staffOnly, tenantOnly, anyRole } = Guards;
const { accessiblePropertyIds, maintenanceRequestAccessible } = require('../utils/property-access');
const {
  notifyMaintenanceCreated,
  notifyMaintenanceStatusChange,
  notifyMaintenanceBill,
} = require('../services/maintenance-email.service');
const { notifyPaymentReceived } = require('../services/payment-email.service');

const router = express.Router();
router.use(authenticate);

const VALID_CATEGORIES = ['plumbing', 'hvac', 'electrical', 'appliance', 'structural', 'pest', 'exterior', 'other'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'emergency'];
const VALID_STATUSES = ['submitted', 'triaged', 'assigned', 'in_progress', 'pending_tenant', 'resolved', 'cancelled'];

router.get('/my', tenantOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mr.id, mr.title, mr.description, mr.status, mr.priority, mr.category,
              mr.scheduled_at, mr.completed_at, mr.created_at, mr.updated_at,
              mr.estimated_cost, mr.actual_cost, mr.tenant_rating,
              un.unit_number, p.name AS property_name,
              (u.first_name || ' ' || u.last_name) AS assigned_to_name
       FROM maintenance_requests mr
       JOIN units un ON un.id = mr.unit_id
       JOIN properties p ON p.id = un.property_id
       LEFT JOIN users u ON u.id = mr.assigned_to
       WHERE mr.tenant_id = $1
       ORDER BY mr.created_at DESC`,
      [req.user.id]
    );
    res.json({ requests: rows });
  } catch (err) {
    console.error('[GET /maintenance/my]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', tenantOnly, async (req, res) => {
  const { title, description, category, priority } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  if (category && !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
  }
  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of: ${VALID_PRIORITIES.join(', ')}` });
  }

  try {
    const { rows: leaseRows } = await pool.query(
      `SELECT l.id AS lease_id, l.unit_id
       FROM leases l WHERE l.tenant_id = $1 AND l.status = 'active'
       ORDER BY l.start_date DESC LIMIT 1`,
      [req.user.id]
    );
    if (!leaseRows.length) {
      return res.status(400).json({ error: 'No active lease found. Please contact your property manager.' });
    }

    const { lease_id, unit_id } = leaseRows[0];
    const { rows } = await pool.query(
      `INSERT INTO maintenance_requests
         (unit_id, lease_id, tenant_id, title, description, category, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, title, status, priority, category, created_at`,
      [unit_id, lease_id, req.user.id, title.trim(), description?.trim() ?? null, category ?? null, priority ?? 'medium']
    );

    notifyMaintenanceCreated(rows[0].id).catch((err) =>
      console.error('[POST /maintenance] email:', err.message)
    );

    res.status(201).json({ request: rows[0] });
  } catch (err) {
    console.error('[POST /maintenance]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', anyRole, async (req, res) => {
  try {
    const allowed = await maintenanceRequestAccessible(req.params.id, req.user.id, req.user.role);
    if (!allowed) return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      `SELECT mr.*, un.unit_number, p.name AS property_name,
              (u.first_name || ' ' || u.last_name) AS assigned_to_name, u.email AS assigned_to_email
       FROM maintenance_requests mr
       JOIN units un ON un.id = mr.unit_id
       JOIN properties p ON p.id = un.property_id
       LEFT JOIN users u ON u.id = mr.assigned_to
       WHERE mr.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Request not found' });

    const { rows: history } = await pool.query(
      `SELECT old_status, new_status, changed_by, note, created_at
       FROM maintenance_status_history WHERE request_id = $1
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ request: rows[0], history });
  } catch (err) {
    console.error('[GET /maintenance/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/rating', tenantOnly, async (req, res) => {
  const { rating, comment } = req.body;
  const r = Number(rating);
  if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'rating must be 1-5' });
  try {
    const { rows: check } = await pool.query(
      `SELECT tenant_id, status FROM maintenance_requests WHERE id = $1`,
      [req.params.id]
    );
    if (!check.length) return res.status(404).json({ error: 'Request not found' });
    if (check[0].tenant_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    if (check[0].status !== 'resolved') return res.status(400).json({ error: 'Can only rate resolved requests' });
    const { rows } = await pool.query(
      `UPDATE maintenance_requests
       SET tenant_rating=$1, tenant_rating_comment=$2, updated_at=NOW()
       WHERE id=$3 RETURNING tenant_rating, tenant_rating_comment`,
      [r, comment?.trim() ?? null, req.params.id]
    );
    res.json({ rating: rows[0] });
  } catch (err) {
    console.error('[POST /maintenance/:id/rating]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/', staffOnly, async (req, res) => {
  try {
    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    if (!propIds.length) return res.json({ requests: [] });

    const { status, priority, category, property_id } = req.query;
    let conditions = ['un.property_id = ANY($1)'];
    let params = [propIds];
    if (status) { params.push(status); conditions.push(`mr.status = $${params.length}`); }
    if (priority) { params.push(priority); conditions.push(`mr.priority = $${params.length}`); }
    if (category) { params.push(category); conditions.push(`mr.category = $${params.length}`); }
    if (property_id) { params.push(property_id); conditions.push(`un.property_id = $${params.length}`); }

    const { rows } = await pool.query(
      `SELECT mr.id, mr.title, mr.description, mr.status, mr.priority, mr.category,
              mr.scheduled_at, mr.completed_at, mr.created_at, mr.updated_at,
              mr.estimated_cost, mr.actual_cost, mr.assigned_to, mr.is_ai_triaged, mr.ai_priority_suggestion,
              un.unit_number, p.name AS property_name, p.id AS property_id,
              (ten.first_name || ' ' || ten.last_name) AS tenant_name, ten.email AS tenant_email,
              (asgn.first_name || ' ' || asgn.last_name) AS assigned_to_name
       FROM maintenance_requests mr
       JOIN units un ON un.id = mr.unit_id
       JOIN properties p ON p.id = un.property_id
       JOIN users ten ON ten.id = mr.tenant_id
       LEFT JOIN users asgn ON asgn.id = mr.assigned_to
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE mr.priority WHEN 'emergency' THEN 0 WHEN 'high' THEN 1
           WHEN 'medium' THEN 2 ELSE 3 END,
         mr.created_at DESC`,
      params
    );
    res.json({ requests: rows });
  } catch (err) {
    console.error('[GET /maintenance]', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', staffOnly, async (req, res) => {
  const allowed = ['status', 'priority', 'assigned_to', 'scheduled_at', 'estimated_cost', 'actual_cost', 'note'];
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields provided' });

  if (req.body.status && !VALID_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  if (req.body.priority && !VALID_PRIORITIES.includes(req.body.priority)) {
    return res.status(400).json({ error: `priority must be one of: ${VALID_PRIORITIES.join(', ')}` });
  }

  try {
    const ok = await maintenanceRequestAccessible(req.params.id, req.user.id, req.user.role);
    if (!ok) return res.status(403).json({ error: 'Access denied' });

    const { rows: existing } = await pool.query(
      `SELECT status FROM maintenance_requests WHERE id = $1`,
      [req.params.id]
    );
    if (!existing.length) return res.status(404).json({ error: 'Request not found' });
    const oldStatus = existing[0].status;

    const fields = updates.filter(([k]) => k !== 'note');
    if (req.body.status === 'resolved') fields.push(['completed_at', new Date().toISOString()]);

    const setClauses = fields.map(([k], i) => `${k} = $${i + 1}`).join(', ');
    const values = [...fields.map(([, v]) => v), req.params.id];
    const { rows } = await pool.query(
      `UPDATE maintenance_requests SET ${setClauses}, updated_at = NOW()
       WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (req.body.status && req.body.status !== oldStatus) {
      await pool.query(
        `INSERT INTO maintenance_status_history
           (request_id, old_status, new_status, changed_by, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.params.id, oldStatus, req.body.status, req.user.id, req.body.note ?? null]
      );
      notifyMaintenanceStatusChange(req.params.id, {
        oldStatus,
        newStatus: req.body.status,
        note: req.body.note,
      }).catch((err) => console.error('[PATCH /maintenance] email:', err.message));
    }

    res.json({ request: rows[0] });
  } catch (err) {
    console.error('[PATCH /maintenance/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

/** Staff: bill tenant for damages / maintenance actual cost */
router.post('/:id/bill-tenant', staffOnly, async (req, res) => {
  const { amount, notes } = req.body;
  const amountNum = parseFloat(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'INVALID_AMOUNT' });
  }

  try {
    const ok = await maintenanceRequestAccessible(req.params.id, req.user.id, req.user.role);
    if (!ok) return res.status(403).json({ error: 'Access denied' });

    const { rows: mrRows } = await pool.query(
      `SELECT mr.id, mr.title, mr.tenant_id, mr.lease_id, mr.unit_id
         FROM maintenance_requests mr WHERE mr.id = $1`,
      [req.params.id]
    );
    if (!mrRows.length) return res.status(404).json({ error: 'Request not found' });
    const mr = mrRows[0];
    if (!mr.lease_id) {
      return res.status(400).json({ error: 'NO_LEASE', message: 'Request has no lease linked.' });
    }

    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    const { rows: leaseRows } = await pool.query(
      `SELECT l.id FROM leases l
        JOIN units un ON un.id = l.unit_id
       WHERE l.id = $1 AND un.property_id = ANY($2)`,
      [mr.lease_id, propIds]
    );
    if (!leaseRows.length) return res.status(403).json({ error: 'Access denied' });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    const metadata = {
      source: 'manual',
      payment_method: 'other',
      maintenance_request_id: mr.id,
      notes: notes || `Charge for maintenance: ${mr.title}`,
      recorded_by: req.user.id,
      recorded_at: new Date().toISOString(),
    };

    const { rows: inserted } = await pool.query(
      `INSERT INTO payments
         (lease_id, tenant_id, amount, currency, status, payment_type,
          period_start, period_end, due_date, paid_at, metadata)
       VALUES ($1,$2,$3,'USD','succeeded','other',$4::date,$5::date,$4::date,NOW(),$6)
       RETURNING id`,
      [mr.lease_id, mr.tenant_id, amountNum, monthStart, monthEnd, JSON.stringify(metadata)]
    );

    await pool.query(
      `UPDATE maintenance_requests SET actual_cost = $1, updated_at = NOW() WHERE id = $2`,
      [amountNum, mr.id]
    );

    const paymentId = inserted[0].id;
    notifyMaintenanceBill(mr.id, { amount: amountNum, paymentId }).catch((err) =>
      console.error('[bill-tenant] email:', err.message)
    );
    notifyPaymentReceived({
      paymentId,
      tenantId: mr.tenant_id,
      leaseId: mr.lease_id,
      amount: amountNum,
      paymentType: 'other',
    }).catch((err) => console.error('[bill-tenant] payment email:', err.message));

    res.status(201).json({ paymentId, message: 'Charge recorded and tenant notified.' });
  } catch (err) {
    console.error('[POST /maintenance/:id/bill-tenant]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
