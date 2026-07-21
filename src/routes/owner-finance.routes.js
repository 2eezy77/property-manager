/**
 * owner-finance.routes.js — Owner-only personal finance checklist + mortgage RAG context.
 *
 * GET  /api/owner/checklist
 * PATCH /api/owner/checklist/:id
 * GET  /api/owner/mortgage/statements
 * GET  /api/owner/mortgage/summary
 * GET  /api/owner/finance-context
 * GET  /api/owner/manager-oversight
 * GET  /api/owner/manager-playbook
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const { Guards } = require('../middleware/authorize');
const checklist = require('../services/owner-checklist.service');
const mortgage = require('../services/mortgage-statement.service');
const oversight = require('../services/owner-oversight.service');
const playbook = require('../services/manager-playbook.service');
const { listActivityLog, getActivityPolicy } = require('../services/activity-audit.service');
const plaid = require('../services/plaid.service');
const {
  getPropertyBankForOwner,
  linkPropertyBank,
  removePropertyBank,
} = require('../services/property-bank.service');
const pool = require('../db/client');

const router = express.Router();
router.use(authenticate);
router.use(Guards.ownerAndAbove);

function sendError(res, err) {
  const code = err.code || 'SERVER_ERROR';
  const status = {
    NOT_FOUND: 404,
    VALIDATION: 400,
    PARSE_FAILED: 422,
    FILE_NOT_FOUND: 404,
    NO_OWNER: 404,
    NO_ORG: 404,
  }[code] || 500;
  res.status(status).json({ error: code, message: err.message });
}

router.get('/checklist', async (req, res) => {
  try {
    const items = await checklist.listChecklist(req.user.id);
    res.json({ items });
  } catch (err) {
    console.error('[GET /owner/checklist]', err.message);
    sendError(res, err);
  }
});

router.patch('/checklist/:id', async (req, res) => {
  try {
    const patch = {};
    if (req.body?.label != null) patch.label = String(req.body.label).trim();
    if (req.body?.amount_estimate != null) patch.amount_estimate = Number(req.body.amount_estimate);
    if (req.body?.due_day != null) patch.due_day = Number(req.body.due_day);
    if (req.body?.payment_method != null) patch.payment_method = String(req.body.payment_method).trim();
    if (req.body?.notes != null) patch.notes = String(req.body.notes).trim();
    if (req.body?.mark_paid === true) patch.last_paid_at = new Date();
    if (req.body?.mark_verified === true) patch.last_verified_at = new Date();
    if (req.body?.clear_paid === true) patch.last_paid_at = null;
    if (req.body?.clear_verified === true) patch.last_verified_at = null;

    const item = await checklist.updateChecklistItem(req.user.id, req.params.id, patch);
    res.json({ item });
  } catch (err) {
    console.error('[PATCH /owner/checklist/:id]', err.message);
    sendError(res, err);
  }
});

router.get('/mortgage/statements', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 12, 48);
    const statements = await mortgage.listStatements(req.user.id, limit);
    res.json({ statements });
  } catch (err) {
    console.error('[GET /owner/mortgage/statements]', err.message);
    sendError(res, err);
  }
});

router.get('/mortgage/summary', async (req, res) => {
  try {
    const summary = await mortgage.getLatestSummary(req.user.id);
    res.json({ summary });
  } catch (err) {
    console.error('[GET /owner/mortgage/summary]', err.message);
    sendError(res, err);
  }
});

router.get('/finance-context', async (req, res) => {
  try {
    const data = await mortgage.buildFinanceRagContext(req.user.id);
    res.json(data);
  } catch (err) {
    console.error('[GET /owner/finance-context]', err.message);
    sendError(res, err);
  }
});

router.get('/manager-oversight', async (req, res) => {
  try {
    const snapshot = await oversight.getManagerOversight(req.user.id);
    res.json({ snapshot });
  } catch (err) {
    console.error('[GET /owner/manager-oversight]', err.message);
    sendError(res, err);
  }
});

router.get('/manager-playbook', async (req, res) => {
  try {
    const orgId = await oversight.resolveOrgId(req.user.id);
    if (!orgId) {
      return res.status(404).json({ error: 'NO_ORG', message: 'No organization found.' });
    }

    const { rows: mgrRows } = await pool.query(
      `SELECT id, first_name, last_name, email
         FROM users
        WHERE org_id = $1 AND role = 'property_manager'
        ORDER BY CASE WHEN LOWER(email) = LOWER($2) THEN 0 ELSE 1 END, created_at ASC
        LIMIT 1`,
      [orgId, oversight.MANAGER_EMAIL]
    );
    const manager = mgrRows[0];
    if (!manager) {
      return res.json({ manager: null, total: 0, completed: 0, verified: 0, items: [] });
    }

    const summary = await playbook.playbookSummary(manager.id);
    res.json({
      manager: {
        id: manager.id,
        name: [manager.first_name, manager.last_name].filter(Boolean).join(' ') || manager.email,
        email: manager.email,
      },
      ...summary,
    });
  } catch (err) {
    console.error('[GET /owner/manager-playbook]', err.message);
    sendError(res, err);
  }
});

/** GET /api/owner/property-bank — org joint operating account (both owners) */
router.get('/property-bank', async (req, res) => {
  try {
    const data = await getPropertyBankForOwner(req.user.id);
    res.json(data);
  } catch (err) {
    console.error('[GET /owner/property-bank]', err.message);
    sendError(res, err);
  }
});

/** POST /api/owner/property-bank/plaid/link-token */
router.post('/property-bank/plaid/link-token', async (req, res) => {
  try {
    const linkToken = await plaid.createLinkToken(req.user.id);
    res.json({ linkToken });
  } catch (err) {
    console.error('[POST /owner/property-bank/plaid/link-token]', err.message);
    res.status(500).json({ error: 'PLAID_ERROR', message: 'Could not create Plaid Link token.' });
  }
});

/** POST /api/owner/property-bank/plaid/update-link-token */
router.post('/property-bank/plaid/update-link-token', async (req, res) => {
  const { bankAccountId } = req.body;
  if (!bankAccountId) {
    return res.status(400).json({ error: 'MISSING_PARAMS', message: 'bankAccountId is required.' });
  }
  try {
    const { createUpdateLinkTokenForAccount } = require('../services/plaid-bank-link.service');
    const result = await createUpdateLinkTokenForAccount({
      userId: req.user.id,
      bankAccountId,
      scope: 'owner_property',
    });
    res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: err.message });
    }
    console.error('[POST /owner/property-bank/plaid/update-link-token]', err.message);
    res.status(500).json({ error: 'PLAID_ERROR', message: 'Could not create Plaid update token.' });
  }
});

/** POST /api/owner/property-bank/plaid/exchange-update */
router.post('/property-bank/plaid/exchange-update', async (req, res) => {
  const { publicToken, bankAccountId } = req.body;
  if (!publicToken || !bankAccountId) {
    return res.status(400).json({ error: 'MISSING_PARAMS', message: 'publicToken and bankAccountId are required.' });
  }
  try {
    const { completePlaidLinkUpdate } = require('../services/plaid-bank-link.service');
    const account = await completePlaidLinkUpdate({
      userId: req.user.id,
      bankAccountId,
      publicToken,
      scope: 'owner_property',
    });
    res.json({ account });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: err.message });
    }
    console.error('[POST /owner/property-bank/plaid/exchange-update]', err.message);
    res.status(500).json({ error: 'EXCHANGE_FAILED', message: 'Failed to refresh bank connection.' });
  }
});

/** POST /api/owner/property-bank/plaid/exchange */
router.post('/property-bank/plaid/exchange', async (req, res) => {
  try {
    const account = await linkPropertyBank({
      ownerId: req.user.id,
      publicToken: req.body?.publicToken,
      accountId: req.body?.accountId,
    });
    res.status(201).json({ account });
  } catch (err) {
    console.error('[POST /owner/property-bank/plaid/exchange]', err.message);
    if (err.code === 'ALREADY_LINKED' || err.code === 'DUPLICATE_ACCOUNT') {
      return res.status(err.statusCode || 409).json({ error: err.code, message: err.message });
    }
    sendError(res, err);
  }
});

/** DELETE /api/owner/property-bank/:id */
router.delete('/property-bank/:id', async (req, res) => {
  try {
    const result = await removePropertyBank({
      ownerId: req.user.id,
      accountId: req.params.id,
    });
    res.json(result);
  } catch (err) {
    console.error('[DELETE /owner/property-bank/:id]', err.message);
    sendError(res, err);
  }
});

/** GET /api/owner/activity-log — owners only; same org-wide list for every owner */
router.get('/activity-log', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 80));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const failedOnly = req.query.failed === '1' || req.query.failed === 'true';
    const { logs, total } = await listActivityLog({
      viewerUserId: req.user.id,
      limit,
      offset,
      category: req.query.category || null,
      actorUserId: req.query.actor || null,
      actorRole: req.query.role || null,
      since: req.query.since || null,
      failedOnly,
    });
    res.json({
      logs,
      total,
      limit,
      offset,
      policy: getActivityPolicy(),
    });
  } catch (err) {
    console.error('[GET /owner/activity-log]', err);
    sendError(res, err);
  }
});

module.exports = router;
