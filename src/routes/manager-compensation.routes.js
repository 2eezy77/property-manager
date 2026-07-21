/**
 * Manager compensation — lease signing fees ($350/lease).
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const { Guards } = require('../middleware/authorize');
const { resolveOrgIdForUser } = require('../services/site-visits.service');
const {
  listLeaseSigningFees,
  syncLeaseSigningFees,
  payLeaseSigningFee,
  startCashAppLeaseSigningFee,
  syncCashAppLeaseSigningFee,
  markFeePaidExternally,
} = require('../services/lease-signing-pay.service');

const router = express.Router();
router.use(authenticate);

function sendErr(res, err) {
  const code = err.statusCode || 500;
  res.status(code).json({
    error: err.code || 'ERROR',
    message: err.message || 'Request failed.',
  });
}

/** GET /api/manager-compensation/lease-signing?status=owed|paid */
router.get('/lease-signing', Guards.staffOnly, async (req, res) => {
  try {
    const data = await listLeaseSigningFees({
      userId: req.user.id,
      userRole: req.user.role,
      status: req.query.status,
    });
    res.json(data);
  } catch (err) {
    console.error('[GET /manager-compensation/lease-signing]', err);
    sendErr(res, err);
  }
});

/** POST /api/manager-compensation/lease-signing/sync — backfill active leases */
router.post('/lease-signing/sync', Guards.ownerAndAbove, async (req, res) => {
  try {
    const orgId = await resolveOrgIdForUser(req.user.id);
    if (!orgId) return res.status(400).json({ error: 'NO_ORG', message: 'No organization found.' });
    const result = await syncLeaseSigningFees(orgId);
    const data = await listLeaseSigningFees({
      userId: req.user.id,
      userRole: req.user.role,
    });
    res.json({ ...result, ...data });
  } catch (err) {
    console.error('[POST /manager-compensation/lease-signing/sync]', err);
    sendErr(res, err);
  }
});

/** POST /api/manager-compensation/lease-signing/:id/pay */
router.post('/lease-signing/:id/pay', Guards.ownerAndAbove, async (req, res) => {
  try {
    const orgId = await resolveOrgIdForUser(req.user.id);
    if (!orgId) return res.status(400).json({ error: 'NO_ORG', message: 'No organization found.' });

    const fee = await payLeaseSigningFee({
      orgId,
      ownerId: req.user.id,
      feeId: req.params.id,
      paymentMethod: req.body?.paymentMethod || 'ach',
      note: req.body?.note,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.json(fee);
  } catch (err) {
    console.error('[POST /manager-compensation/lease-signing/:id/pay]', err);
    sendErr(res, err);
  }
});

/** POST /api/manager-compensation/lease-signing/:id/cashapp/create-intent */
router.post('/lease-signing/:id/cashapp/create-intent', Guards.ownerAndAbove, async (req, res) => {
  try {
    const orgId = await resolveOrgIdForUser(req.user.id);
    if (!orgId) return res.status(400).json({ error: 'NO_ORG', message: 'No organization found.' });

    const intent = await startCashAppLeaseSigningFee({
      orgId,
      ownerId: req.user.id,
      feeId: req.params.id,
      note: req.body?.note,
    });

    res.status(201).json(intent);
  } catch (err) {
    console.error('[POST /manager-compensation/lease-signing/:id/cashapp/create-intent]', err);
    sendErr(res, err);
  }
});

/** GET /api/manager-compensation/lease-signing/cashapp/sync */
router.get('/lease-signing/cashapp/sync', Guards.ownerAndAbove, async (req, res) => {
  try {
    const orgId = await resolveOrgIdForUser(req.user.id);
    if (!orgId) return res.status(400).json({ error: 'NO_ORG', message: 'No organization found.' });

    const result = await syncCashAppLeaseSigningFee({
      orgId,
      ownerId: req.user.id,
      paymentIntentId: req.query.payment_intent,
    });

    res.json(result);
  } catch (err) {
    console.error('[GET /manager-compensation/lease-signing/cashapp/sync]', err);
    sendErr(res, err);
  }
});

/** POST /api/manager-compensation/lease-signing/:id/mark-paid-externally — deprecated */
router.post('/lease-signing/:id/mark-paid-externally', Guards.ownerAndAbove, async (req, res) => {
  try {
    const orgId = await resolveOrgIdForUser(req.user.id);
    if (!orgId) return res.status(400).json({ error: 'NO_ORG', message: 'No organization found.' });

    await markFeePaidExternally({
      orgId,
      ownerId: req.user.id,
      feeId: req.params.id,
      note: req.body?.note,
    });
    res.json({});
  } catch (err) {
    console.error('[POST /manager-compensation/lease-signing/:id/mark-paid-externally]', err);
    sendErr(res, err);
  }
});

module.exports = router;
