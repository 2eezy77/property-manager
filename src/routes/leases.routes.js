/**
 * leases.routes.js — Lease management + e-signature flow.
 */

const express      = require('express');
const pool         = require('../db/client');
const authenticate = require('../middleware/authenticate');
const { Guards }                         = require('../middleware/authorize');
const { staffOnly, tenantOnly, anyRole } = Guards;
const { sendLeaseForSignature, getSigningUrlForUser,
        createInterview, getDocument, fetchDocumentHtml, listTemplates,
        getBinder, processWebhookEvent, mapBinderStatus,
        checkConnection } = require('../services/rocketlawyer.service');
const { ensureLeaseSigningFee } = require('../services/lease-signing-pay.service');

const router = express.Router();
router.use(authenticate);

function resolveRlDocumentId(lease, bodyDocumentId) {
  if (bodyDocumentId) return bodyDocumentId;
  if (lease.rl_document_id) return lease.rl_document_id;
  const url = lease.document_url || '';
  if (url.startsWith('rl-doc-')) return url.slice('rl-doc-'.length);
  return null;
}

// ── GET /api/leases/my  — tenant's leases ────────────────────────────────────
router.get('/my', tenantOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.*, un.unit_number, p.name AS property_name,
              se.id AS envelope_id, se.status AS envelope_status,
              se.provider AS envelope_provider, se.sent_at AS envelope_sent_at,
              se.completed_at AS envelope_completed_at
       FROM leases l
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
       LEFT JOIN LATERAL (
         SELECT id, status, provider, sent_at, completed_at
         FROM signature_envelopes WHERE lease_id = l.id
         ORDER BY created_at DESC LIMIT 1
       ) se ON TRUE
       WHERE l.tenant_id = $1
       ORDER BY l.start_date DESC`,
      [req.user.id]
    );
    res.json({ leases: rows });
  } catch (err) {
    console.error('[GET /leases/my]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leases/:id/sign  — get embedded signing URL for tenant ──────────
router.get('/:id/sign', tenantOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, tenant_id, status FROM leases WHERE id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lease not found' });
    if (rows[0].tenant_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    if (rows[0].status === 'active') return res.status(400).json({ error: 'Lease is already fully signed' });
    const url = await getSigningUrlForUser(req.params.id, req.user.id);
    if (!url) return res.status(404).json({ error: 'No pending signature found for this lease' });
    res.json({ url });
  } catch (err) {
    console.error('[GET /leases/:id/sign]', err);
    res.status(err.statusCode ?? 500).json({ error: err.message });
  }
});

// ── GET /api/leases/rocket-lawyer/status  — integration health (before /:id) ─
router.get('/rocket-lawyer/status', staffOnly, async (_req, res) => {
  try {
    const status = await checkConnection();
    res.json(status);
  } catch (err) {
    console.error('[GET /leases/rocket-lawyer/status]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leases/templates  — must be BEFORE /:id ────────────────────────
router.get('/templates', staffOnly, async (req, res) => {
  try {
    const templates = await listTemplates({
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
      index: req.query.index,
      lookupValue: req.query.lookupValue,
    });
    res.json({ templates });
  } catch (err) {
    console.error('[GET /leases/templates]', err);
    res.status(err.statusCode ?? 500).json({ error: err.message });
  }
});

// ── GET /api/leases  — manager list ─────────────────────────────────────────
router.get('/', staffOnly, async (req, res) => {
  try {
    const { status, property_id, unit_id } = req.query;
    let propIds;
    if (['super_admin','owner'].includes(req.user.role)) {
      const { rows } = await pool.query(
        `SELECT p.id FROM properties p JOIN users u ON u.org_id = p.org_id WHERE u.id = $1`,
        [req.user.id]
      );
      propIds = rows.map(r => r.id);
    } else {
      const { rows } = await pool.query(
        `SELECT property_id AS id FROM property_assignments WHERE user_id = $1`,
        [req.user.id]
      );
      propIds = rows.map(r => r.id);
    }
    if (!propIds.length) return res.json({ leases: [] });

    let conditions = ['un.property_id = ANY($1)'];
    let params = [propIds];
    if (status)      { params.push(status);      conditions.push(`l.status = $${params.length}`); }
    if (property_id) { params.push(property_id); conditions.push(`un.property_id = $${params.length}`); }
    if (unit_id)     { params.push(unit_id);     conditions.push(`l.unit_id = $${params.length}`); }

    const { rows } = await pool.query(
      `SELECT l.id, l.status, l.start_date, l.end_date,
              l.monthly_rent, l.security_deposit, l.document_url, l.pdf_path,
              l.rl_document_id, l.rl_interview_url,
              l.created_at, l.updated_at,
              un.unit_number, p.name AS property_name, p.id AS property_id,
              p.address_line1, p.city, p.state, p.zip,
              (u.first_name || ' ' || u.last_name) AS tenant_name, u.email AS tenant_email,
              se.status AS envelope_status
       FROM leases l
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
       JOIN users u ON u.id = l.tenant_id
       LEFT JOIN LATERAL (
         SELECT status FROM signature_envelopes WHERE lease_id = l.id
         ORDER BY created_at DESC LIMIT 1
       ) se ON TRUE
       WHERE ${conditions.join(' AND ')}
       ORDER BY l.created_at DESC`,
      params
    );
    res.json({ leases: rows });
  } catch (err) {
    console.error('[GET /leases]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leases  — create draft lease ───────────────────────────────────
router.post('/', staffOnly, async (req, res) => {
  const { unit_id, tenant_id, start_date, end_date, monthly_rent,
          security_deposit, grace_period_days, late_fee_type,
          late_fee_amount, late_fee_cap, document_url } = req.body;
  if (!unit_id || !tenant_id || !start_date || !end_date || !monthly_rent) {
    return res.status(400).json({ error: 'Required: unit_id, tenant_id, start_date, end_date, monthly_rent' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO leases
         (unit_id, tenant_id, status, start_date, end_date, monthly_rent,
          security_deposit, grace_period_days, late_fee_type,
          late_fee_amount, late_fee_cap, document_url, created_by)
       VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [unit_id, tenant_id, start_date, end_date, monthly_rent,
       security_deposit ?? null, grace_period_days ?? 5,
       late_fee_type ?? 'flat', late_fee_amount ?? null,
       late_fee_cap ?? null, document_url ?? null, req.user.id]
    );
    res.status(201).json({ lease: rows[0] });
  } catch (err) {
    console.error('[POST /leases]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leases/:id ───────────────────────────────────────────────────────
router.get('/:id', anyRole, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.*, un.unit_number, p.name AS property_name,
              p.address_line1, p.city, p.state, p.zip,
              (u.first_name || ' ' || u.last_name) AS tenant_name, u.email AS tenant_email
       FROM leases l
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
       JOIN users u ON u.id = l.tenant_id
       WHERE l.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lease not found' });
    const lease = rows[0];
    if (req.user.role === 'tenant' && lease.tenant_id !== req.user.id)
      return res.status(403).json({ error: 'Access denied' });
    const { rows: envelopes } = await pool.query(
      `SELECT se.*,
              json_agg(json_build_object(
                'id', es.id, 'email', es.email, 'name', es.name,
                'signer_role', es.signer_role, 'status', es.status,
                'signed_at', es.signed_at, 'routing_order', es.routing_order
              ) ORDER BY es.routing_order) AS signers
       FROM signature_envelopes se
       LEFT JOIN envelope_signers es ON es.envelope_id = se.id
       WHERE se.lease_id = $1 GROUP BY se.id ORDER BY se.created_at DESC`,
      [req.params.id]
    );
    res.json({ lease, envelopes });
  } catch (err) {
    console.error('[GET /leases/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/leases/:id  — update draft lease ──────────────────────────────
router.patch('/:id', staffOnly, async (req, res) => {
  const allowed = ['start_date','end_date','monthly_rent','security_deposit',
                   'grace_period_days','late_fee_type','late_fee_amount','late_fee_cap','document_url'];
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields provided' });
  try {
    const { rows: check } = await pool.query(
      `SELECT status FROM leases WHERE id = $1`, [req.params.id]
    );
    if (!check.length) return res.status(404).json({ error: 'Lease not found' });
    if (check[0].status !== 'draft') return res.status(400).json({ error: 'Only draft leases can be edited' });
    const setClauses = updates.map(([k], i) => `${k} = $${i + 1}`).join(', ');
    const values = [...updates.map(([, v]) => v), req.params.id];
    const { rows } = await pool.query(
      `UPDATE leases SET ${setClauses}, updated_at = NOW()
       WHERE id = $${values.length} RETURNING *`,
      values
    );
    res.json({ lease: rows[0] });
  } catch (err) {
    console.error('[PATCH /leases/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leases/:id/pdf  — deprecated; use Rocket Lawyer documents ────────
router.post('/:id/pdf', staffOnly, (_req, res) => {
  res.status(410).json({
    error: 'DEPRECATED',
    message: 'Local PDF generation is disabled. Create the lease in Rocket Lawyer via POST /api/leases/:id/documents.',
  });
});

// ── GET /api/leases/:id/pdf/status ───────────────────────────────────────────
router.get('/:id/pdf/status', anyRole, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rl_document_id, document_url, rl_interview_url FROM leases WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lease not found' });
    const lease = rows[0];
    if (lease.rl_document_id) {
      const doc = await getDocument(lease.rl_document_id).catch(() => null);
      return res.json({
        provider: 'rocket_lawyer',
        documentId: lease.rl_document_id,
        interviewUrl: lease.rl_interview_url,
        status: doc?.status ?? 'unknown',
        pdfUrl: doc?.pdfUrl ?? (lease.document_url?.startsWith('http') ? lease.document_url : null),
      });
    }
    res.json({ provider: 'rocket_lawyer', documentId: null, generated: false });
  } catch (err) {
    console.error('[GET /leases/:id/pdf/status]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leases/:id/envelopes  — send for e-signature ───────────────────
router.post('/:id/envelopes', staffOnly, async (req, res) => {
  try {
    const { rows: leaseRows } = await pool.query(
      `SELECT l.*, (u.first_name || ' ' || u.last_name) AS tenant_name, u.email AS tenant_email,
              un.unit_number, p.name AS property_name
       FROM leases l
       JOIN users u  ON u.id = l.tenant_id
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
       WHERE l.id = $1`,
      [req.params.id]
    );
    if (!leaseRows.length) return res.status(404).json({ error: 'Lease not found' });
    const lease = leaseRows[0];

    const documentId = resolveRlDocumentId(lease, req.body.documentId ?? null);
    if (!documentId) {
      return res.status(400).json({
        error: 'Create a Rocket Lawyer lease document first (Leases → Create in Rocket Lawyer).',
      });
    }

    const doc = await getDocument(documentId).catch(() => null);
    const docReady = doc?.status
      && ['completed', 'ready', 'signed', 'complete'].includes(String(doc.status).toLowerCase());

    let documentHtml = null;
    if (doc?.htmlUrl?.startsWith('inline:')) {
      documentHtml = await fetchDocumentHtml(doc.htmlUrl.slice('inline:'.length)).catch(() => null);
    }

    if (doc?.status && !docReady) {
      return res.status(400).json({
        error: `Rocket Lawyer document is not ready for signing (status: ${doc.status}). Complete the interview first.`,
        code: 'RL_INTERVIEW_INCOMPLETE',
        documentStatus: doc.status,
        interviewUrl: lease.rl_interview_url ?? doc.interviewUrl ?? null,
      });
    }
    if (['active','expired','terminated'].includes(lease.status))
      return res.status(400).json({ error: `Cannot send a ${lease.status} lease for signature` });

    const { rows: mgr } = await pool.query(
      `SELECT (first_name || ' ' || last_name) AS full_name, email FROM users WHERE id = $1`,
      [req.user.id]
    );
    const signers = [
      { userId: lease.tenant_id, email: lease.tenant_email, name: lease.tenant_name,  role: 'Tenant',           routingOrder: 1 },
      { userId: req.user.id,     email: mgr[0].email,       name: mgr[0].full_name,   role: 'Property Manager', routingOrder: 2 },
    ];
    const subject = req.body.subject ?? `Lease Agreement — ${lease.property_name} Unit ${lease.unit_number}`;
    const message = req.body.message ?? `Please review and sign your lease for ${lease.property_name}, Unit ${lease.unit_number}.`;

    const { envelopeId, providerEnvelopeId } = await sendLeaseForSignature({
      leaseId: lease.id,
      documentId: doc?.documentId ?? documentId,
      documentUrl: doc?.pdfUrl ?? null,
      documentHtml,
      documentName: `Lease_${lease.unit_number}_${String(lease.start_date).slice(0, 10)}.pdf`,
      signers,
      subject,
      message,
      ownerEmail: mgr[0].email,
    });
    res.status(201).json({ envelopeId, providerEnvelopeId });
  } catch (err) {
    console.error('[POST /leases/:id/envelopes]', err);
    res.status(err.statusCode ?? 500).json({
      error: err.message,
      code: err.code ?? (err.statusCode === 403 ? 'RL_APP_PENDING' : undefined),
    });
  }
});

// ── GET /api/leases/:id/envelopes ────────────────────────────────────────────
router.get('/:id/envelopes', staffOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT se.*,
              json_agg(json_build_object(
                'id', es.id, 'name', es.name, 'email', es.email,
                'signer_role', es.signer_role, 'status', es.status,
                'signed_at', es.signed_at
              ) ORDER BY es.routing_order) AS signers
       FROM signature_envelopes se
       LEFT JOIN envelope_signers es ON es.envelope_id = se.id
       WHERE se.lease_id = $1 GROUP BY se.id ORDER BY se.created_at DESC`,
      [req.params.id]
    );
    res.json({ envelopes: rows });
  } catch (err) {
    console.error('[GET /leases/:id/envelopes]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leases/:id/documents  — create Rocket Lawyer doc from template ─
router.post('/:id/documents', staffOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.status, un.unit_number, p.name AS property_name,
              p.address_line1 AS property_address, l.start_date, l.end_date,
              l.monthly_rent, l.security_deposit,
              (u.first_name || ' ' || u.last_name) AS tenant_name, u.email AS tenant_email
       FROM leases l
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
       JOIN users u ON u.id = l.tenant_id
       WHERE l.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lease not found' });
    const lease = rows[0];

    const templateId = req.body.templateId ?? process.env.RL_LEASE_TEMPLATE_ID;
    if (!templateId) {
      return res.status(400).json({
        error: 'templateId required (or set RL_LEASE_TEMPLATE_ID)',
        code: 'RL_TEMPLATE_MISSING',
      });
    }

    const { interviewId, documentId, interviewUrl, status, binderId, serviceToken } = await createInterview({
      templateId,
      partyEmailAddress: lease.tenant_email,
      partnerEndUserId: String(lease.tenant_id),
    });

    const rlId = interviewId ?? documentId;

    await pool.query(
      `UPDATE leases
          SET rl_document_id = $1,
              rl_interview_url = $2,
              document_url = $3,
              updated_at = NOW()
        WHERE id = $4`,
      [rlId, interviewUrl, `rl-doc-${rlId}`, lease.id]
    );

    res.status(201).json({
      documentId: rlId,
      interviewId,
      binderId,
      interviewUrl,
      serviceToken: serviceToken ? '(issued — use for embedded interview UX)' : null,
      status,
    });
  } catch (err) {
    console.error('[POST /leases/:id/documents]', err);
    res.status(err.statusCode ?? 500).json({
      error: err.message,
      code: err.code ?? (err.statusCode === 403 ? 'RL_APP_PENDING' : undefined),
    });
  }
});

// ── GET /api/leases/:id/documents/:docId ─────────────────────────────────────
router.get('/:id/documents/:docId', staffOnly, async (req, res) => {
  try {
    const doc = await getDocument(req.params.docId);
    if (doc.pdfUrl) {
      await pool.query(
        `UPDATE leases SET document_url = $1, updated_at = NOW()
         WHERE id = $2 AND rl_document_id = $3`,
        [doc.pdfUrl, req.params.id, req.params.docId]
      );
    }
    res.json({ document: doc });
  } catch (err) {
    console.error('[GET /leases/:id/documents/:docId]', err);
    res.status(err.statusCode ?? 500).json({ error: err.message });
  }
});

// ── POST /api/leases/:id/activate-signed  — manual RL workaround + manager fee ─
router.post('/:id/activate-signed', Guards.ownerAndAbove, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.status, l.updated_at
         FROM leases l
         JOIN units un ON un.id = l.unit_id
         JOIN properties p ON p.id = un.property_id
         JOIN users u ON u.org_id = p.org_id
        WHERE l.id = $1 AND u.id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lease not found' });
    const lease = rows[0];
    if (lease.status === 'active') {
      const feeId = await ensureLeaseSigningFee(lease.id, { signedAt: lease.updated_at });
      return res.json({ lease: { id: lease.id, status: 'active' }, feeCreated: !!feeId });
    }
    if (['expired', 'terminated'].includes(lease.status)) {
      return res.status(400).json({ error: `Cannot activate a ${lease.status} lease` });
    }

    const { rows: updated } = await pool.query(
      `UPDATE leases SET status = 'active', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    const feeId = await ensureLeaseSigningFee(req.params.id, { signedAt: new Date() });
    res.json({ lease: updated[0], feeCreated: !!feeId });
  } catch (err) {
    console.error('[POST /leases/:id/activate-signed]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leases/:id/envelopes/:envelopeId/sync  — dev sync utility ──────
router.post('/:id/envelopes/:envelopeId/sync', staffOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT se.id, se.provider_envelope_id, se.status AS current_status, se.lease_id
       FROM signature_envelopes se
       WHERE se.id = $1 AND se.lease_id = $2`,
      [req.params.envelopeId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Envelope not found' });
    const envelope = rows[0];

    if (envelope.current_status === 'completed')
      return res.json({ synced: false, message: 'Envelope already completed', status: 'completed' });

    const binder = await getBinder(envelope.provider_envelope_id);
    const newStatus = mapBinderStatus(binder.status);

    if (newStatus === envelope.current_status)
      return res.json({ synced: false, message: 'Status unchanged', status: newStatus, binder });

    await processWebhookEvent({
      event: binder.status,
      binderId: envelope.provider_envelope_id,
      status: binder.status,
      data: { binderId: envelope.provider_envelope_id, status: binder.status, signers: binder.parties ?? [] },
    });

    res.json({ synced: true, oldStatus: envelope.current_status, newStatus, binder });
  } catch (err) {
    console.error('[POST /leases/:id/envelopes/:envelopeId/sync]', err);
    res.status(err.statusCode ?? 500).json({ error: err.message });
  }
});

module.exports = router;
