/**
 * utilities.routes.js — HTTP adapter for utility bill use cases.
 *
 * Business logic: src/use-cases/utilities/ (Sommerville use-case model).
 * Catalog:        src/use-cases/utilities/catalog.js
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const { Guards } = require('../middleware/authorize');
const uc = require('../use-cases/utilities');

const router = express.Router();

function sendUseCaseError(res, err, logPrefix) {
  if (logPrefix) console.error(logPrefix, err.message);
  const status = uc.httpStatusForCode(err.code);
  res.status(status).json({
    error: err.code || 'SERVER_ERROR',
    message: err.message,
  });
}

// UC08 callback — public (Google redirect has no JWT)
router.get('/gmail/callback', async (req, res) => {
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const redirect = (params) => {
    res.redirect(`${clientOrigin}/manager/utilities?${new URLSearchParams(params).toString()}`);
  };

  try {
    const { code, state, error } = req.query;
    if (error) return redirect({ gmail: 'error', message: error });
    if (!code || !state) return redirect({ gmail: 'error', message: 'missing_code' });

    const result = await uc.executeGmailCallback({ code, state });
    redirect({ gmail: 'connected', email: result.gmail_address || '' });
  } catch (err) {
    console.error('[utilities/gmail/callback]', err.message);
    redirect({ gmail: 'error', message: err.code || 'callback_failed' });
  }
});

router.use(authenticate);

// UC01 — POST /bills
router.post('/bills', Guards.staffOnly, async (req, res) => {
  try {
    const detail = await uc.executeCreateBill({
      userId: req.user.id,
      role: req.user.role,
      body: req.body,
    });
    res.status(201).json(detail);
  } catch (err) {
    if (err.code) return sendUseCaseError(res, err, '[utilities/bills POST]');
    console.error('[utilities/bills POST]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Failed to create utility bill.' });
  }
});

// GET /bills — list
router.get('/bills', Guards.staffOnly, async (req, res) => {
  try {
    const bills = await uc.listBills(req.user.id, req.user.role, req.query);
    res.json({ bills });
  } catch (err) {
    console.error('[utilities/bills GET]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /bills/recalculate-splits — prorate by lease days + only latest bill collectible
router.post('/bills/recalculate-splits', Guards.staffOnly, async (req, res) => {
  try {
    const result = await uc.executeRecalculateSplits({
      userId: req.user.id,
      role: req.user.role,
    });
    res.json(result);
  } catch (err) {
    if (err.code) return sendUseCaseError(res, err, '[utilities/bills/recalculate-splits]');
    console.error('[utilities/bills/recalculate-splits]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Failed to recalculate splits.' });
  }
});

// POST /bills/combine-monthly — one draft per property + service + calendar month
router.post('/bills/combine-monthly', Guards.staffOnly, async (req, res) => {
  try {
    const result = await uc.executeCombineMonthlyDrafts({
      userId: req.user.id,
      role: req.user.role,
    });
    res.json(result);
  } catch (err) {
    if (err.code) return sendUseCaseError(res, err, '[utilities/bills/combine-monthly]');
    console.error('[utilities/bills/combine-monthly]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /bills/prune-duplicates — remove duplicate draft rows + monthly combine
router.post('/bills/prune-duplicates', Guards.staffOnly, async (req, res) => {
  try {
    const dupes = await uc.executePruneDuplicateDrafts({
      userId: req.user.id,
      role: req.user.role,
    });
    const stale = await uc.executePruneStaleDrafts({
      userId: req.user.id,
      role: req.user.role,
    });
    const monthly = await uc.executeCombineMonthlyDrafts({
      userId: req.user.id,
      role: req.user.role,
    });
    const policy = await uc.executeEnforceLatestCollectible({
      userId: req.user.id,
      role: req.user.role,
    });
    res.json({
      removed: (dupes.removed || 0) + (stale.removed || 0) + (monthly.removed || 0),
      duplicates: dupes.removed || 0,
      stale: stale.removed || 0,
      monthly_merged: monthly.merged || 0,
      monthly_normalized: monthly.normalized || 0,
      monthly,
      collectible_policy: policy,
    });
  } catch (err) {
    if (err.code) return sendUseCaseError(res, err, '[utilities/bills/prune-duplicates]');
    console.error('[utilities/bills/prune-duplicates]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// DELETE /bills/:id — draft only
router.delete('/bills/:id', Guards.staffOnly, async (req, res) => {
  try {
    const result = await uc.executeDeleteDraftBill({
      userId: req.user.id,
      role: req.user.role,
      billId: req.params.id,
    });
    res.json(result);
  } catch (err) {
    if (err.code) return sendUseCaseError(res, err, '[utilities/bills DELETE]');
    console.error('[utilities/bills DELETE]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// GET /bills/:id
router.get('/bills/:id', Guards.staffOnly, async (req, res) => {
  try {
    const detail = await uc.getBillForStaff(req.params.id, req.user.id, req.user.role);
    if (!detail) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json(detail);
  } catch (err) {
    console.error('[utilities/bills GET :id]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// UC03 — POST /bills/:id/notify
router.post('/bills/:id/notify', Guards.staffOnly, async (req, res) => {
  try {
    const detail = await uc.executeNotifyTenants({
      userId: req.user.id,
      role: req.user.role,
      billId: req.params.id,
    });
    res.json(detail);
  } catch (err) {
    if (err.code) return sendUseCaseError(res, err, '[utilities/bills/:id/notify]');
    console.error('[utilities/bills/:id/notify]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// UC06 — POST /bills/:id/charge
router.post('/bills/:id/charge', Guards.staffOnly, async (req, res) => {
  try {
    const result = await uc.executeChargeBill({
      userId: req.user.id,
      role: req.user.role,
      billId: req.params.id,
      force: req.body?.force === true,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? '',
    });
    res.status(202).json(result);
  } catch (err) {
    if (err.code) return sendUseCaseError(res, err);
    console.error('[utilities/bills/:id/charge]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// UC04 — POST /splits/:id/dispute
router.post('/splits/:id/dispute', Guards.tenantOnly, async (req, res) => {
  try {
    const result = await uc.executeDisputeShare({
      tenantId: req.user.id,
      splitId: req.params.id,
      reason: req.body?.reason,
    });
    res.json(result);
  } catch (err) {
    if (err.code) return sendUseCaseError(res, err, '[utilities/splits/:id/dispute]');
    console.error('[utilities/splits/:id/dispute]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// UC5a — POST /splits/:id/waive
router.post('/splits/:id/waive', Guards.staffOnly, async (req, res) => {
  try {
    const detail = await uc.executeWaiveShare({
      userId: req.user.id,
      role: req.user.role,
      splitId: req.params.id,
    });
    res.json(detail);
  } catch (err) {
    if (err.code) return sendUseCaseError(res, err, '[utilities/splits/:id/waive]');
    console.error('[utilities/splits/:id/waive]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// UC5b — POST /splits/:id/reject-dispute
router.post('/splits/:id/reject-dispute', Guards.staffOnly, async (req, res) => {
  try {
    const detail = await uc.executeRejectDispute({
      userId: req.user.id,
      role: req.user.role,
      splitId: req.params.id,
    });
    res.json(detail);
  } catch (err) {
    if (err.code) return sendUseCaseError(res, err, '[utilities/splits/:id/reject-dispute]');
    console.error('[utilities/splits/:id/reject-dispute]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// UC08 — Gmail status / connect
router.get('/gmail/status', Guards.staffOnly, async (req, res) => {
  try {
    const status = await uc.executeGmailStatus({ userId: req.user.id, role: req.user.role });
    res.json(status);
  } catch (err) {
    sendUseCaseError(res, err);
  }
});

router.get('/gmail/connect', Guards.ownerAndAbove, async (req, res) => {
  try {
    const { url } = await uc.executeGmailConnect({ userId: req.user.id, role: req.user.role });
    res.json({ url });
  } catch (err) {
    sendUseCaseError(res, err);
  }
});

// UC09 — POST /gmail/import
router.post('/gmail/import', Guards.staffOnly, async (req, res) => {
  try {
    const max = Math.min(Number(req.body?.max_messages) || 25, 40);
    const results = await uc.executeImportFromGmail({
      userId: req.user.id,
      role: req.user.role,
      maxMessages: max,
    });
    res.json(results);
  } catch (err) {
    console.error('[utilities/gmail/import]', err.message);
    sendUseCaseError(res, err);
  }
});

// Tenant read — own splits
router.get('/my-splits', Guards.tenantOnly, async (req, res) => {
  try {
    const splits = await uc.getTenantSplits(req.user.id);
    res.json({ splits });
  } catch (err) {
    console.error('[utilities/my-splits]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
