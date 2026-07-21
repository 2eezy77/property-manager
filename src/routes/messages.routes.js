/**
 * messages.routes.js — In-app messaging + AI agent pipeline.
 *
 * Tenant:  GET/POST /api/messages/threads, GET/POST /api/messages/threads/:id
 * Manager: GET /api/messages/inbox, GET summary, POST reply, PATCH close/urgency
 */

const express      = require('express');
const pool         = require('../db/client');
const authenticate = require('../middleware/authenticate');
const { Guards }                         = require('../middleware/authorize');
const { tenantOnly, staffOnly, anyRole } = Guards;
const { processInboundMessage, summariseThread } = require('../services/ai-agent.service');

const router = express.Router();
router.use(authenticate);

async function getTenantLease(tenantId) {
  const { rows } = await pool.query(
    `SELECT l.id AS lease_id, l.unit_id, u.unit_number,
            p.id AS property_id, p.name AS property_name
     FROM leases l
     JOIN units u ON u.id = l.unit_id
     JOIN properties p ON p.id = u.property_id
     WHERE l.tenant_id = $1 AND l.status = 'active'
     ORDER BY l.start_date DESC LIMIT 1`,
    [tenantId]
  );
  return rows[0] ?? null;
}

async function assertThreadAccess(userId, userRole, thread) {
  if (['super_admin', 'owner', 'property_manager'].includes(userRole)) return;
  if (thread.tenant_id !== userId) {
    const err = new Error('Access denied to this thread');
    err.statusCode = 403;
    throw err;
  }
}

// GET /api/messages/threads  — tenant's threads
router.get('/threads', tenantOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mt.id, mt.subject, mt.category, mt.urgency,
              mt.triage_status, mt.is_open, mt.ai_summary,
              mt.created_at, mt.updated_at,
              (SELECT body FROM messages WHERE thread_id = mt.id AND is_internal = FALSE
               ORDER BY created_at DESC LIMIT 1) AS last_message,
              (SELECT COUNT(*) FROM messages WHERE thread_id = mt.id
               AND is_internal = FALSE AND read_at IS NULL
               AND direction = 'outbound') AS unread_count
       FROM message_threads mt WHERE mt.tenant_id = $1
       ORDER BY mt.updated_at DESC`,
      [req.user.id]
    );
    res.json({ threads: rows });
  } catch (err) {
    console.error('[GET /messages/threads]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messages/threads  — start a new thread
router.post('/threads', tenantOnly, async (req, res) => {
  const { subject, body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Message body is required' });
  try {
    const lease = await getTenantLease(req.user.id);
    const { rows: tRows } = await pool.query(
      `INSERT INTO message_threads
         (tenant_id, lease_id, unit_id, subject, urgency, triage_status)
       VALUES ($1,$2,$3,$4,'low','pending') RETURNING *`,
      [req.user.id, lease?.lease_id ?? null, lease?.unit_id ?? null, subject?.trim() ?? null]
    );
    const thread = tRows[0];
    const { rows: mRows } = await pool.query(
      `INSERT INTO messages
         (thread_id, sender_type, sender_user_id, direction, channel, body)
       VALUES ($1,'tenant',$2,'inbound','in_app',$3) RETURNING id`,
      [thread.id, req.user.id, body.trim()]
    );
    res.status(201).json({ thread, messageId: mRows[0].id });
    processInboundMessage(mRows[0].id, thread.id).catch(e =>
      console.error('[ai-agent]', e.message)
    );
  } catch (err) {
    console.error('[POST /messages/threads]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/threads/:threadId
router.get('/threads/:threadId', anyRole, async (req, res) => {
  try {
    const { threadId } = req.params;
    const { rows: tRows } = await pool.query(
      `SELECT mt.*, (u.first_name || ' ' || u.last_name) AS tenant_name, u.email AS tenant_email,
              un.unit_number, p.name AS property_name
       FROM message_threads mt
       JOIN users u ON u.id = mt.tenant_id
       LEFT JOIN units un ON un.id = mt.unit_id
       LEFT JOIN properties p ON p.id = un.property_id
       WHERE mt.id = $1`,
      [threadId]
    );
    if (!tRows.length) return res.status(404).json({ error: 'Thread not found' });
    const thread = tRows[0];
    await assertThreadAccess(req.user.id, req.user.role, thread);
    const isStaff = ['super_admin','owner','property_manager'].includes(req.user.role);
    const { rows: messages } = await pool.query(
      `SELECT id, sender_type, sender_user_id, direction, channel,
              body, is_internal, is_ai_generated, read_at, created_at
       FROM messages WHERE thread_id = $1 ${isStaff ? '' : 'AND is_internal = FALSE'}
       ORDER BY created_at ASC`,
      [threadId]
    );
    if (!isStaff) {
      await pool.query(
        `UPDATE messages SET read_at = NOW()
         WHERE thread_id = $1 AND direction = 'outbound' AND read_at IS NULL`,
        [threadId]
      );
    }
    res.json({ thread, messages });
  } catch (err) {
    console.error('[GET /messages/threads/:id]', err);
    res.status(err.statusCode ?? 500).json({ error: err.message });
  }
});

// POST /api/messages/threads/:threadId  — tenant reply
router.post('/threads/:threadId', tenantOnly, async (req, res) => {
  const { threadId } = req.params;
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Message body is required' });
  try {
    const { rows: tRows } = await pool.query(
      `SELECT id, tenant_id, is_open FROM message_threads WHERE id = $1`, [threadId]
    );
    if (!tRows.length) return res.status(404).json({ error: 'Thread not found' });
    if (tRows[0].tenant_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    if (!tRows[0].is_open) return res.status(400).json({ error: 'Thread is closed' });
    const { rows } = await pool.query(
      `INSERT INTO messages
         (thread_id, sender_type, sender_user_id, direction, channel, body)
       VALUES ($1,'tenant',$2,'inbound','in_app',$3) RETURNING id`,
      [threadId, req.user.id, body.trim()]
    );
    await pool.query(
      `UPDATE message_threads SET triage_status='pending', updated_at=NOW()
       WHERE id=$1 AND triage_status IN ('auto_responded','resolved')`,
      [threadId]
    );
    res.status(201).json({ messageId: rows[0].id });
    processInboundMessage(rows[0].id, threadId).catch(e =>
      console.error('[ai-agent]', e.message)
    );
  } catch (err) {
    console.error('[POST /messages/threads/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/inbox  — manager view
router.get('/inbox', staffOnly, async (req, res) => {
  try {
    const { urgency, triage_status, property_id } = req.query;
    let propFilter;
    if (['super_admin','owner'].includes(req.user.role)) {
      const { rows } = await pool.query(
        `SELECT p.id FROM properties p JOIN users u ON u.org_id = p.org_id WHERE u.id = $1`,
        [req.user.id]
      );
      propFilter = rows.map(r => r.id);
    } else {
      const { rows } = await pool.query(
        `SELECT property_id AS id FROM property_assignments WHERE user_id = $1`,
        [req.user.id]
      );
      propFilter = rows.map(r => r.id);
    }
    if (!propFilter.length) return res.json({ threads: [] });

    let conditions = [`p.id = ANY($1)`, `mt.is_open = TRUE`];
    let params = [propFilter];
    if (urgency)       { params.push(urgency);        conditions.push(`mt.urgency = $${params.length}`); }
    if (triage_status) { params.push(triage_status);  conditions.push(`mt.triage_status = $${params.length}`); }
    if (property_id)   { params.push(property_id);    conditions.push(`p.id = $${params.length}`); }

    const { rows } = await pool.query(
      `SELECT mt.id, mt.subject, mt.category, mt.urgency, mt.triage_status,
              mt.is_open, mt.ai_summary, mt.created_at, mt.updated_at,
              (u.first_name || ' ' || u.last_name) AS tenant_name, u.email AS tenant_email,
              un.unit_number, p.name AS property_name, p.id AS property_id,
              (SELECT body FROM messages WHERE thread_id=mt.id AND is_internal=FALSE
               ORDER BY created_at DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM messages WHERE thread_id=mt.id AND is_internal=FALSE
               ORDER BY created_at DESC LIMIT 1) AS last_message_at
       FROM message_threads mt
       JOIN users u ON u.id = mt.tenant_id
       LEFT JOIN units un ON un.id = mt.unit_id
       LEFT JOIN properties p ON p.id = un.property_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE mt.urgency WHEN 'emergency' THEN 0 WHEN 'high' THEN 1
           WHEN 'medium' THEN 2 ELSE 3 END,
         mt.updated_at DESC
       LIMIT 100`,
      params
    );
    res.json({ threads: rows });
  } catch (err) {
    console.error('[GET /messages/inbox]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/threads/:threadId/summary
router.get('/threads/:threadId/summary', staffOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ai_summary FROM message_threads WHERE id = $1`, [req.params.threadId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Thread not found' });
    let summary = rows[0].ai_summary;
    if (!summary) summary = await summariseThread(req.params.threadId);
    res.json({ summary });
  } catch (err) {
    console.error('[GET /messages/threads/:id/summary]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messages/threads/:threadId/reply  — manager reply
router.post('/threads/:threadId/reply', staffOnly, async (req, res) => {
  const { threadId } = req.params;
  const { body, is_internal = false } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Message body is required' });
  try {
    const { rows: tRows } = await pool.query(
      `SELECT id FROM message_threads WHERE id = $1`, [threadId]
    );
    if (!tRows.length) return res.status(404).json({ error: 'Thread not found' });
    const { rows } = await pool.query(
      `INSERT INTO messages
         (thread_id, sender_type, sender_user_id, direction, channel, body, is_internal)
       VALUES ($1,'manager',$2,'outbound','in_app',$3,$4) RETURNING id`,
      [threadId, req.user.id, body.trim(), Boolean(is_internal)]
    );
    if (!is_internal) {
      await pool.query(
        `UPDATE message_threads SET triage_status='triaged', updated_at=NOW()
         WHERE id=$1 AND triage_status='pending'`,
        [threadId]
      );
    }
    res.status(201).json({ messageId: rows[0].id });
  } catch (err) {
    console.error('[POST /messages/threads/:id/reply]', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/messages/threads/:threadId/close
router.patch('/threads/:threadId/close', staffOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE message_threads
       SET is_open=FALSE, triage_status='resolved', closed_at=NOW(), updated_at=NOW()
       WHERE id=$1 RETURNING id`,
      [req.params.threadId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Thread not found' });
    res.json({ closed: true });
  } catch (err) {
    console.error('[PATCH /messages/threads/:id/close]', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/messages/threads/:threadId/urgency
router.patch('/threads/:threadId/urgency', staffOnly, async (req, res) => {
  const { urgency } = req.body;
  const valid = ['low','medium','high','emergency'];
  if (!valid.includes(urgency))
    return res.status(400).json({ error: `urgency must be one of: ${valid.join(', ')}` });
  try {
    const { rows } = await pool.query(
      `UPDATE message_threads SET urgency=$1, updated_at=NOW() WHERE id=$2 RETURNING id`,
      [urgency, req.params.threadId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Thread not found' });
    res.json({ urgency });
  } catch (err) {
    console.error('[PATCH /messages/threads/:id/urgency]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
