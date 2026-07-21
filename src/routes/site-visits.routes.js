/**
 * Manager on-site visit pay — inspection scope, 24h notice, multi-photo proof.
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const { Guards } = require('../middleware/authorize');
const {
  getMonthlyUsage,
  listVisits,
  requestVisit,
  approveVisit,
  rejectVisit,
  cancelVisit,
  completeVisit,
  resolveOrgIdForUser,
  loadInspectionAreas,
  getDefaultPropertyId,
  minPlannedVisitLocalString,
  norfolkNowLocalString,
} = require('../services/site-visits.service');
const plaid = require('../services/plaid.service');
const {
  getPayrollMonth,
  getManagerPayoutAccounts,
  linkManagerPayoutBank,
  removeManagerPayoutBank,
  getManagerConnectOnboardingUrl,
  payManagerPayroll,
  startCashAppPayroll,
  syncCashAppPayroll,
  cancelProcessingPayroll,
  parseYearMonth,
  norfolkYearMonth,
} = require('../services/site-visits-payout.service');

const router = express.Router();
router.use(authenticate);

function sendErr(res, err) {
  const code = err.statusCode || 500;
  const body = {
    error: err.code || 'ERROR',
    message: err.message || 'Request failed.',
  };
  if (err.onboardingUrl) body.onboardingUrl = err.onboardingUrl;
  res.status(code).json(body);
}

/** GET /api/site-visits/areas — inspection checklist */
router.get('/areas', Guards.staffOnly, async (req, res) => {
  try {
    const orgId = await resolveOrgIdForUser(req.user.id);
    if (!orgId) return res.status(400).json({ error: 'NO_ORG', message: 'No organization found.' });
    const propertyId = await getDefaultPropertyId(orgId);
    const areas = await loadInspectionAreas(orgId, propertyId);
    res.json({
      areas,
      commonMandatory: true,
      commonKeys: areas.common.map((a) => a.key),
      videoRequired: true,
      maxVideoMb: 25,
      minPlannedVisitLocal: minPlannedVisitLocalString(),
      minVisitNowLocal: norfolkNowLocalString(),
      timezone: 'America/New_York',
      location: 'Norfolk, VA 23504',
    });
  } catch (err) {
    console.error('[GET /site-visits/areas]', err);
    sendErr(res, err);
  }
});

/** GET /api/site-visits — summary + list */
router.get('/', Guards.staffOnly, async (req, res) => {
  try {
    const orgId = await resolveOrgIdForUser(req.user.id);
    if (!orgId) return res.status(400).json({ error: 'NO_ORG', message: 'No organization found.' });

    const isManager = req.user.role === 'property_manager';
    const usage = await getMonthlyUsage(orgId);
    const visits = await listVisits({
      orgId,
      managerId: isManager ? req.user.id : null,
    });

    res.json({
      usage,
      visits,
      policy: {
        perVisit: usage.visit_amount_cents / 100,
        monthlyCap: usage.cap_cents / 100,
        noticeHours: 24,
        timezone: 'America/New_York',
        flow: 'All 3 common areas every visit → owner approves (24h tenant notice when applicable) → video per area at check-in.',
        roomPurposes: ['routine_inspection', 'maintenance_followup', 'vacant_showing'],
      },
    });
  } catch (err) {
    console.error('[GET /site-visits]', err);
    sendErr(res, err);
  }
});

/** GET /api/site-visits/payroll?year=&month= — monthly earnings / owner pay panel */
router.get('/payroll', Guards.staffOnly, async (req, res) => {
  try {
    const orgId = await resolveOrgIdForUser(req.user.id);
    if (!orgId) return res.status(400).json({ error: 'NO_ORG', message: 'No organization found.' });

    const defaults = norfolkYearMonth();
    const { year, month } = parseYearMonth(
      req.query.year ?? defaults.year,
      req.query.month ?? defaults.month
    );

    const payroll = await getPayrollMonth({
      userId: req.user.id,
      userRole: req.user.role,
      year,
      month,
    });
    res.json({ payroll });
  } catch (err) {
    console.error('[GET /site-visits/payroll]', err);
    sendErr(res, err);
  }
});

/** GET /api/site-visits/payout-bank — manager payout accounts */
router.get('/payout-bank', Guards.staffOnly, async (req, res) => {
  try {
    if (req.user.role !== 'property_manager') {
      return res.status(403).json({
        error: 'MANAGER_ONLY',
        message: 'Only the property manager can view payout bank accounts.',
      });
    }
    const accounts = await getManagerPayoutAccounts(req.user.id);
    res.json({ accounts });
  } catch (err) {
    console.error('[GET /site-visits/payout-bank]', err);
    sendErr(res, err);
  }
});

/** POST /api/site-visits/payout-bank/plaid/link-token */
router.post('/payout-bank/plaid/link-token', Guards.staffOnly, async (req, res) => {
  try {
    if (req.user.role !== 'property_manager') {
      return res.status(403).json({
        error: 'MANAGER_ONLY',
        message: 'Only the property manager can link a payout bank account.',
      });
    }
    const linkToken = await plaid.createLinkToken(req.user.id);
    res.json({ linkToken });
  } catch (err) {
    console.error('[POST /site-visits/payout-bank/plaid/link-token]', err);
    res.status(500).json({ error: 'PLAID_ERROR', message: 'Could not create Plaid Link token.' });
  }
});

/** POST /api/site-visits/payout-bank/plaid/update-link-token */
router.post('/payout-bank/plaid/update-link-token', Guards.staffOnly, async (req, res) => {
  try {
    if (req.user.role !== 'property_manager') {
      return res.status(403).json({
        error: 'MANAGER_ONLY',
        message: 'Only the property manager can update a payout bank account.',
      });
    }
    const { bankAccountId } = req.body;
    if (!bankAccountId) {
      return res.status(400).json({ error: 'MISSING_PARAMS', message: 'bankAccountId is required.' });
    }
    const { createUpdateLinkTokenForAccount } = require('../services/plaid-bank-link.service');
    const result = await createUpdateLinkTokenForAccount({
      userId: req.user.id,
      bankAccountId,
      scope: 'manager_payout',
    });
    res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: err.message });
    }
    console.error('[POST /site-visits/payout-bank/plaid/update-link-token]', err);
    res.status(500).json({ error: 'PLAID_ERROR', message: 'Could not create Plaid update token.' });
  }
});

/** POST /api/site-visits/payout-bank/plaid/exchange-update */
router.post('/payout-bank/plaid/exchange-update', Guards.staffOnly, async (req, res) => {
  try {
    if (req.user.role !== 'property_manager') {
      return res.status(403).json({
        error: 'MANAGER_ONLY',
        message: 'Only the property manager can update a payout bank account.',
      });
    }
    const { publicToken, bankAccountId } = req.body;
    if (!publicToken || !bankAccountId) {
      return res.status(400).json({ error: 'MISSING_PARAMS', message: 'publicToken and bankAccountId are required.' });
    }
    const { completePlaidLinkUpdate } = require('../services/plaid-bank-link.service');
    const account = await completePlaidLinkUpdate({
      userId: req.user.id,
      bankAccountId,
      publicToken,
      scope: 'manager_payout',
    });
    res.json({ account });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: err.message });
    }
    console.error('[POST /site-visits/payout-bank/plaid/exchange-update]', err);
    res.status(500).json({ error: 'EXCHANGE_FAILED', message: 'Failed to refresh bank connection.' });
  }
});

/** POST /api/site-visits/payout-bank/plaid/exchange */
router.post('/payout-bank/plaid/exchange', Guards.staffOnly, async (req, res) => {
  try {
    if (req.user.role !== 'property_manager') {
      return res.status(403).json({
        error: 'MANAGER_ONLY',
        message: 'Only the property manager can link a payout bank account.',
      });
    }
    const account = await linkManagerPayoutBank({
      managerId: req.user.id,
      publicToken: req.body?.publicToken,
      accountId: req.body?.accountId,
    });
    res.status(201).json({ account });
  } catch (err) {
    console.error('[POST /site-visits/payout-bank/plaid/exchange]', err);
    sendErr(res, err);
  }
});

/** GET /api/site-visits/payout-bank/connect-onboarding — manager completes Stripe Express setup */
router.get('/payout-bank/connect-onboarding', Guards.staffOnly, async (req, res) => {
  try {
    if (req.user.role !== 'property_manager') {
      return res.status(403).json({
        error: 'MANAGER_ONLY',
        message: 'Only the property manager can complete Stripe payout setup.',
      });
    }
    const result = await getManagerConnectOnboardingUrl(req.user.id);
    res.json(result);
  } catch (err) {
    console.error('[GET /site-visits/payout-bank/connect-onboarding]', err);
    sendErr(res, err);
  }
});

/** DELETE /api/site-visits/payout-bank/:id */
router.delete('/payout-bank/:id', Guards.staffOnly, async (req, res) => {
  try {
    if (req.user.role !== 'property_manager') {
      return res.status(403).json({
        error: 'MANAGER_ONLY',
        message: 'Only the property manager can remove payout bank accounts.',
      });
    }
    const result = await removeManagerPayoutBank({
      managerId: req.user.id,
      accountId: req.params.id,
    });
    res.json(result);
  } catch (err) {
    console.error('[DELETE /site-visits/payout-bank/:id]', err);
    sendErr(res, err);
  }
});

/** POST /api/site-visits/payroll/pay — owner marks month paid */
router.post('/payroll/pay', Guards.ownerAndAbove, async (req, res) => {
  try {
    const orgId = await resolveOrgIdForUser(req.user.id);
    if (!orgId) return res.status(400).json({ error: 'NO_ORG', message: 'No organization found.' });

    const defaults = norfolkYearMonth();
    const { year, month } = parseYearMonth(
      req.body?.year ?? defaults.year,
      req.body?.month ?? defaults.month
    );

    const payout = await payManagerPayroll({
      orgId,
      ownerId: req.user.id,
      year,
      month,
      paymentMethod: req.body?.paymentMethod ?? 'manual',
      note: req.body?.note,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? '',
    });

    const payroll = await getPayrollMonth({
      userId: req.user.id,
      userRole: req.user.role,
      year,
      month,
    });

    res.status(201).json({ payout, payroll });
  } catch (err) {
    console.error('[POST /site-visits/payroll/pay]', err);
    sendErr(res, err);
  }
});

/** POST /api/site-visits/payroll/cashapp/create-intent — owner pays via Stripe Cash App Pay */
router.post('/payroll/cashapp/create-intent', Guards.ownerAndAbove, async (req, res) => {
  try {
    const orgId = await resolveOrgIdForUser(req.user.id);
    if (!orgId) return res.status(400).json({ error: 'NO_ORG', message: 'No organization found.' });

    const defaults = norfolkYearMonth();
    const { year, month } = parseYearMonth(
      req.body?.year ?? defaults.year,
      req.body?.month ?? defaults.month
    );

    const intent = await startCashAppPayroll({
      orgId,
      ownerId: req.user.id,
      year,
      month,
      note: req.body?.note,
    });

    res.status(201).json(intent);
  } catch (err) {
    console.error('[POST /site-visits/payroll/cashapp/create-intent]', err);
    sendErr(res, err);
  }
});

/** POST /api/site-visits/payroll/cancel-processing — cancel stuck ACH / Cash App attempt */
router.post('/payroll/cancel-processing', Guards.ownerAndAbove, async (req, res) => {
  try {
    const orgId = await resolveOrgIdForUser(req.user.id);
    if (!orgId) return res.status(400).json({ error: 'NO_ORG', message: 'No organization found.' });

    const defaults = norfolkYearMonth();
    const { year, month } = parseYearMonth(
      req.body?.year ?? defaults.year,
      req.body?.month ?? defaults.month
    );

    const payroll = await cancelProcessingPayroll({
      orgId,
      ownerId: req.user.id,
      year,
      month,
    });

    res.json({ payroll });
  } catch (err) {
    console.error('[POST /site-visits/payroll/cancel-processing]', err);
    sendErr(res, err);
  }
});

/** GET /api/site-visits/payroll/cashapp/sync — after Cash App redirect */
router.get('/payroll/cashapp/sync', Guards.ownerAndAbove, async (req, res) => {
  try {
    const orgId = await resolveOrgIdForUser(req.user.id);
    if (!orgId) return res.status(400).json({ error: 'NO_ORG', message: 'No organization found.' });

    const result = await syncCashAppPayroll({
      orgId,
      ownerId: req.user.id,
      paymentIntentId: req.query.payment_intent,
    });

    res.json(result);
  } catch (err) {
    console.error('[GET /site-visits/payroll/cashapp/sync]', err);
    sendErr(res, err);
  }
});

/** POST /api/site-visits/request */
router.post('/request', Guards.staffOnly, async (req, res) => {
  try {
    if (req.user.role !== 'property_manager') {
      return res.status(403).json({
        error: 'MANAGER_ONLY',
        message: 'Only the property manager can request on-site visits.',
      });
    }
    const visit = await requestVisit({
      managerId: req.user.id,
      note: req.body?.note,
      plannedVisitAt: req.body?.plannedVisitAt,
      commonAreas: req.body?.commonAreas,
      unitIds: req.body?.unitIds,
      roomSelections: req.body?.roomSelections,
    });
    res.status(201).json({ visit });
  } catch (err) {
    console.error('[POST /site-visits/request]', err);
    sendErr(res, err);
  }
});

router.post('/:id/approve', Guards.ownerAndAbove, async (req, res) => {
  try {
    const visit = await approveVisit({ visitId: req.params.id, ownerId: req.user.id });
    res.json({ visit, usage: await getMonthlyUsage(visit.orgId) });
  } catch (err) {
    console.error('[POST /site-visits/:id/approve]', err);
    sendErr(res, err);
  }
});

router.post('/:id/reject', Guards.ownerAndAbove, async (req, res) => {
  try {
    const visit = await rejectVisit({
      visitId: req.params.id,
      ownerId: req.user.id,
      note: req.body?.note,
    });
    res.json({ visit });
  } catch (err) {
    console.error('[POST /site-visits/:id/reject]', err);
    sendErr(res, err);
  }
});

router.post('/:id/cancel', Guards.staffOnly, async (req, res) => {
  try {
    const visit = await cancelVisit({
      visitId: req.params.id,
      actorId: req.user.id,
      actorRole: req.user.role,
    });
    res.json({ visit });
  } catch (err) {
    console.error('[POST /site-visits/:id/cancel]', err);
    sendErr(res, err);
  }
});

router.post('/:id/complete', Guards.staffOnly, async (req, res) => {
  try {
    if (req.user.role !== 'property_manager') {
      return res.status(403).json({
        error: 'MANAGER_ONLY',
        message: 'Only the property manager can complete a visit.',
      });
    }
    const visit = await completeVisit({
      visitId: req.params.id,
      managerId: req.user.id,
      photos: req.body?.photos,
    });
    const usage = await getMonthlyUsage(visit.orgId);
    res.json({ visit, usage });
  } catch (err) {
    console.error('[POST /site-visits/:id/complete]', err);
    sendErr(res, err);
  }
});

module.exports = router;
