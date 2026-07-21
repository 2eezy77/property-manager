/**
 * announcements.routes.js - Manager broadcast messages to tenants.
 *
 * GET  /api/announcements    - list announcements (staff: all in org; tenant: their property only)
 * POST /api/announcements    - create and send to tenants (staff only)
 */

const express      = require('express');
const pool         = require('../db/client');
const authenticate = require('../middleware/authenticate');
const { Guards }   = require('../middleware/authorize');
const { staffOnly, anyRole } = Guards;

const router = express.Router();
router.use(authenticate);

// GET /api/announcements — staff see their org; tenants see their property's announcements
router.get('/', anyRole, async (req, res) => {
  try {
    let rows;

    if (['super_admin', 'owner', 'property_manager', 'maintenance_staff'].includes(req.user.role)) {
      // Staff: find org via property assignments or direct ownership
      const orgRes = await pool.query(
        `SELECT DISTINCT p.org_id
         FROM properties p
         WHERE p.org_id IN (
           SELECT org_id FROM properties p2
           JOIN property_assignments pa ON pa.property_id = p2.id
           WHERE pa.user_id = $1
           UNION
           SELECT org_id FROM properties p3
           WHERE p3.org_id = (SELECT id FROM organizations WHERE owner_id = $1 LIMIT 1)
         )
         LIMIT 1`,
        [req.user.id]
      );
      const orgId = orgRes.rows[0]?.org_id;
      if (!orgId) return res.json({ announcements: [] });

      const result = await pool.query(
        `SELECT a.*, p.name AS property_name,
                (u.first_name || ' ' || u.last_name) AS sender_name
         FROM announcements a
         LEFT JOIN properties p ON p.id = a.property_id
         JOIN users u ON u.id = a.sender_id
         WHERE a.org_id = $1
         ORDER BY a.created_at DESC LIMIT 100`,
        [orgId]
      );
      rows = result.rows;
    } else {
      // Tenant: show announcements for their active lease's property
      const result = await pool.query(
        `SELECT a.*, p.name AS property_name,
                (u.first_name || ' ' || u.last_name) AS sender_name
         FROM announcements a
         LEFT JOIN properties p ON p.id = a.property_id
         JOIN users u ON u.id = a.sender_id
         WHERE (a.property_id IN (
           SELECT un.property_id FROM leases l
           JOIN units un ON un.id = l.unit_id
           WHERE l.tenant_id = $1 AND l.status = 'active'
         ) OR a.property_id IS NULL)
         AND a.org_id IN (
           SELECT p2.org_id FROM leases l2
           JOIN units un2 ON un2.id = l2.unit_id
           JOIN properties p2 ON p2.id = un2.property_id
           WHERE l2.tenant_id = $1 AND l2.status = 'active'
         )
         AND (a.send_at IS NULL OR a.send_at <= NOW())
         ORDER BY a.created_at DESC LIMIT 50`,
        [req.user.id]
      );
      rows = result.rows;
    }

    res.json({ announcements: rows });
  } catch (err) {
    console.error('[GET /announcements]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/announcements — staff only
router.post('/', staffOnly, async (req, res) => {
  const { title, body, channel, property_id, send_at } = req.body;
  if (!title?.trim() || !body?.trim())
    return res.status(400).json({ error: 'title and body are required' });

  const validChannels = ['sms','email','in_app','push'];
  if (channel && !validChannels.includes(channel))
    return res.status(400).json({ error: `channel must be one of: ${validChannels.join(', ')}` });

  try {
    // Get org_id via ownership
    const orgRes = await pool.query(
      `SELECT id AS org_id FROM organizations WHERE owner_id = $1
       UNION
       SELECT p.org_id FROM properties p
       JOIN property_assignments pa ON pa.property_id = p.id
       WHERE pa.user_id = $1
       LIMIT 1`,
      [req.user.id]
    );
    const orgId = orgRes.rows[0]?.org_id;
    if (!orgId) return res.status(400).json({ error: 'User has no organization' });

    // Find target tenants
    let tenantQuery, tenantParams;
    if (property_id) {
      tenantQuery = `
        SELECT DISTINCT u.id FROM users u
        JOIN leases l ON l.tenant_id = u.id
        JOIN units un ON un.id = l.unit_id
        WHERE un.property_id = $1 AND l.status = 'active' AND u.role = 'tenant'`;
      tenantParams = [property_id];
    } else {
      tenantQuery = `
        SELECT DISTINCT u.id FROM users u
        JOIN leases l ON l.tenant_id = u.id
        JOIN units un ON un.id = l.unit_id
        JOIN properties p ON p.id = un.property_id
        WHERE p.org_id = $1 AND l.status = 'active' AND u.role = 'tenant'`;
      tenantParams = [orgId];
    }
    const { rows: tenants } = await pool.query(tenantQuery, tenantParams);

    const sendAt = send_at ?? null;
    const sentAt = sendAt ? null : new Date();

    const { rows: annRows } = await pool.query(
      `INSERT INTO announcements (org_id, property_id, sender_id, title, body, channel, recipient_count, send_at, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [orgId, property_id ?? null, req.user.id,
       title.trim(), body.trim(), channel ?? 'in_app',
       tenants.length, sendAt, sentAt]
    );
    const ann = annRows[0];

    if (!send_at && tenants.length > 0) {
      const values = tenants.map((t, i) => `($${i*7+1},$${i*7+2},$${i*7+3},$${i*7+4},$${i*7+5},$${i*7+6},$${i*7+7})`).join(',');
      const params = tenants.flatMap(t => [
        t.id, 'announcement', title.trim(), body.trim(), channel ?? 'in_app', ann.id, new Date(),
      ]);
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, channel, related_entity_id, sent_at)
         VALUES ${values}`, params
      );
    }

    const { rows: senderRows } = await pool.query(
      `SELECT (first_name || ' ' || last_name) AS sender_name FROM users WHERE id = $1`,
      [req.user.id]
    );
    res.status(201).json({ announcement: { ...ann, sender_name: senderRows[0]?.sender_name ?? null } });
  } catch (err) {
    console.error('[POST /announcements]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
