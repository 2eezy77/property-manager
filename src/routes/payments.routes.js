/**
 * payments.routes.js
 * All tenant-facing payment endpoints.
 *
 * Routes:
 *   GET  /api/payments/bank-accounts          — list the tenant's linked bank accounts
 *   POST /api/payments/plaid/link-token        — create a Plaid Link token (step 1)
 *   POST /api/payments/plaid/exchange          — exchange public_token, store bank account (step 2–4)
 *   DELETE /api/payments/bank-accounts/:id    — remove a linked bank account
 *   GET  /api/payments/balance                 — current rent due + any unpaid late fees
 *   POST /api/payments/charge                  — ACH debit for rent + applied late fees
 *   GET  /api/payments/stripe-config           — tenant: Stripe publishable key + Cash App Pay flag
 *   GET  /api/payments/config                  — alias (publishableKey + cashAppEnabled)
 *   POST /api/payments/cashapp/create-intent   — tenant: start Cash App Pay rent/deposit payment
 *   POST /api/payments/card/create-intent      — tenant: start card rent/deposit payment
 *   GET  /api/payments/cashapp/sync            — tenant: sync status after Cash App redirect
 *   POST /api/payments/run-billing             — staff: generate invoices + apply late fees
 *   GET  /api/payments/health                  — staff: Stripe/Plaid/webhook/tenant readiness
 *   POST /api/payments/record                  — staff: record offline payment (Cash App, etc.)
 *   POST /api/payments/cashapp/sync-gmail      — staff: import Cash App rent from org Gmail
 *   GET  /api/payments/history                 — paginated payment history
 *
 * All routes require authentication (authenticate middleware).
 * Most are tenant-only; balance/charge additionally verify the tenant owns the lease.
 */

const express    = require('express');
const { Pool }   = require('pg');

const authenticate       = require('../middleware/authenticate');
const { Guards }         = require('../middleware/authorize');
const {
  blockManagerPaymentAccess,
  redactPaymentHistoryRow,
  isManagerImpersonation,
} = require('../middleware/impersonation');
const plaid              = require('../services/plaid.service');
const stripe             = require('../services/stripe.service');
const rentBilling        = require('../services/rent-billing.service');
const { notifyPaymentReceived } = require('../services/payment-email.service');
const { encrypt, decrypt } = require('../utils/encryption');
const { ledgerPaymentWhere } = require('../utils/payment-ledger');
const { notSiteArchivedWhere } = require('../utils/site-visibility');
const { markLateFeesPaidForLease, settleSuccessfulRentPayment } = require('../utils/payment-settlement');
const { getRentStatusRoster } = require('../services/rent-status.service');
const { syncCashAppFromGmail } = require('../services/cashapp-gmail.service');
const { runPaymentsHealth } = require('../services/payments-health.service');
const { prepareTenantCharge, assertNoInFlightDeposit, cancelReplacedDepositPaymentIntent } = require('../services/rent-charge.service');
const {
  listOpenUtilitySplits,
  summarizeOpenUtilities,
  prepareUtilityPortalCharge,
  releaseUtilitySplitsForFailedPayment,
  markUtilitySplitsPaidForPayment,
} = require('../services/utility-portal-charge.service');
const {
  shouldMarkCashAppSyncFailed,
  cashAppSyncFailureReason,
  shouldUnlockUtilitySplitsOnCashAppSyncFail,
  shouldMarkUtilityPaidOnCashAppSyncSuccess,
} = require('../services/cashapp-sync-policy');
const { activateNativeLeaseAfterDeposit } = require('../services/native-lease-activate.service');
const {
  computeCardCashAppFee,
  feeMetadata,
  feeSchedulePublic,
} = require('../services/payment-processing-fee.service');
const { partnerErrorMessage, linkTokenCreateErrorMessage } = require('../utils/plaid-errors');
const { assertAchDebitAllowed } = require('../services/plaid-ach-guard.service');
const {
  createUpdateLinkTokenForAccount,
  completePlaidLinkUpdate,
} = require('../services/plaid-bank-link.service');

const MANUAL_METHODS = new Set(['cash_app', 'check', 'zelle', 'venmo', 'wire', 'cash', 'other']);
const CLIENT_INTENT_PAYMENT_TYPES = new Set(['rent', 'security_deposit', 'utility']);

async function accessiblePropertyIds(userId, role) {
  if (['super_admin', 'owner'].includes(role)) {
    const { rows } = await pool.query(
      `SELECT p.id FROM properties p JOIN users u ON u.org_id = p.org_id WHERE u.id = $1`,
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

function monthBounds(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function isStripeAccountRestrictionError(err) {
  return /charges_enabled|charges enabled|account.*restricted|capabilit/i.test(
    `${err.code || ''} ${err.message || ''} ${err.raw?.message || ''}`
  );
}

const router = express.Router();
const pool = require('../db/client');

// All payment routes require a logged-in user
router.use(authenticate);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/bank-accounts
// Returns all verified/pending bank accounts for the current user
// ─────────────────────────────────────────────────────────────────────────────
router.get('/bank-accounts', async (req, res) => {
  if (blockManagerPaymentAccess(req, res)) return;
  try {
    const { rows } = await pool.query(
      `SELECT id, institution_name, account_name, account_mask, account_type,
              stripe_bank_account_id, status, link_status, is_default, verified_at, created_at
         FROM bank_accounts
        WHERE user_id = $1
        ORDER BY is_default DESC, created_at DESC`,
      [req.user.id]
    );
    res.json({ accounts: rows });
  } catch (err) {
    console.error('[payments/bank-accounts]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/plaid/link-token
// Creates a Plaid Link token so the frontend can open the Plaid modal
// ─────────────────────────────────────────────────────────────────────────────
router.post('/plaid/link-token', async (req, res) => {
  if (blockManagerPaymentAccess(req, res)) return;
  try {
    const linkToken = await plaid.createLinkToken(req.user.id);
    res.json({ linkToken });
  } catch (err) {
    console.error('[payments/plaid/link-token]', err.response?.data ?? err);
    res.status(500).json({
      error: 'PLAID_ERROR',
      message: linkTokenCreateErrorMessage(err, 'Could not create Plaid Link token. Check PLAID_REDIRECT_URI is https://www.monterorentals.com/oauth-return in Railway and Plaid Dashboard.'),
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/plaid/update-link-token
// Body: { bankAccountId } — Update Mode token to re-authenticate a broken link
// ─────────────────────────────────────────────────────────────────────────────
router.post('/plaid/update-link-token', async (req, res) => {
  if (blockManagerPaymentAccess(req, res)) return;
  const { bankAccountId } = req.body;
  if (!bankAccountId) {
    return res.status(400).json({ error: 'MISSING_PARAMS', message: 'bankAccountId is required.' });
  }
  try {
    const result = await createUpdateLinkTokenForAccount({
      userId: req.user.id,
      bankAccountId,
      scope: 'tenant',
    });
    res.json(result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: err.message });
    }
    console.error('[payments/plaid/update-link-token]', err.response?.data ?? err);
    res.status(500).json({
      error: 'PLAID_ERROR',
      message: linkTokenCreateErrorMessage(err, 'Could not create Plaid update token.'),
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/plaid/exchange-update
// Body: { publicToken, bankAccountId } — refresh access token after Update Mode
// ─────────────────────────────────────────────────────────────────────────────
router.post('/plaid/exchange-update', async (req, res) => {
  if (blockManagerPaymentAccess(req, res)) return;
  const { publicToken, bankAccountId } = req.body;
  if (!publicToken || !bankAccountId) {
    return res.status(400).json({
      error: 'MISSING_PARAMS',
      message: 'publicToken and bankAccountId are required.',
    });
  }
  try {
    const account = await completePlaidLinkUpdate({
      userId: req.user.id,
      bankAccountId,
      publicToken,
      scope: 'tenant',
    });
    res.json({ account });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: err.message });
    }
    console.error('[payments/plaid/exchange-update]', err.response?.data ?? err);
    res.status(500).json({
      error: 'EXCHANGE_FAILED',
      message: partnerErrorMessage(err, 'Failed to refresh bank connection.'),
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/plaid/exchange
// Body: { publicToken, accountId }
//
// Full flow:
//   1. Exchange public_token → Plaid access_token
//   2. Fetch account metadata from Plaid
//   3. Create Stripe processor token from Plaid
//   4. Get/create Stripe customer for this user
//   5. Attach bank account to Stripe customer
//   6. Persist encrypted bank_accounts row
// ─────────────────────────────────────────────────────────────────────────────
router.post('/plaid/exchange', async (req, res) => {
  if (blockManagerPaymentAccess(req, res)) return;
  const { publicToken, accountId } = req.body;

  if (!publicToken || !accountId) {
    return res.status(400).json({ error: 'MISSING_PARAMS', message: 'publicToken and accountId are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Exchange public_token
    const { accessToken, itemId } = await plaid.exchangePublicToken(publicToken);

    // 2. Fetch account metadata
    const details = await plaid.getAccountDetails(accessToken, accountId);

    // 3. Plaid → Stripe bank account token (btok_...) via the Stripe-specific endpoint
    const bankAccountToken = await plaid.createStripeBankAccountToken(accessToken, accountId);

    // 4. Get or create Stripe customer
    const { rows: userRows } = await client.query(
      'SELECT email, stripe_customer_id FROM users LEFT JOIN bank_accounts ON bank_accounts.user_id = users.id WHERE users.id = $1 LIMIT 1',
      [req.user.id]
    );
    // Fetch the user's email directly for customer creation
    const { rows: [userRow] } = await client.query(
      'SELECT email, first_name, last_name FROM users WHERE id = $1', [req.user.id]
    );

    const stripeCustomerId = await stripe.getOrCreateCustomer(req.user.id, userRow.email, {
      firstName: userRow.first_name,
      lastName: userRow.last_name,
    });

    // 5. Attach bank account to Stripe
    const stripeBankAccount = await stripe.attachBankAccount(stripeCustomerId, bankAccountToken);

    // 6. Check for duplicate (same Stripe fingerprint)
    const { rows: existing } = await client.query(
      'SELECT id FROM bank_accounts WHERE user_id = $1 AND stripe_fingerprint = $2',
      [req.user.id, stripeBankAccount.fingerprint]
    );
    if (existing.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'DUPLICATE_ACCOUNT',
        message: 'This bank account is already connected.',
      });
    }

    // 7. Is this their first account? Make it the default
    const { rows: countRows } = await client.query(
      'SELECT COUNT(*) AS cnt FROM bank_accounts WHERE user_id = $1', [req.user.id]
    );
    const isDefault = parseInt(countRows[0].cnt, 10) === 0;

    // 8. Persist
    const encryptedToken = encrypt(accessToken);
    const { rows: [newAccount] } = await client.query(
      `INSERT INTO bank_accounts
         (user_id, plaid_item_id, plaid_account_id, plaid_access_token_encrypted,
          institution_name, institution_id, account_name, account_mask, account_type,
          stripe_customer_id, stripe_bank_account_id, stripe_fingerprint,
          status, link_status, is_default, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'verified','active', $13, NOW())
       RETURNING id, institution_name, account_name, account_mask, account_type,
                 stripe_bank_account_id, status, link_status, is_default`,
      [
        req.user.id, itemId, accountId, encryptedToken,
        details.institutionName, details.institutionId,
        details.accountName, details.accountMask, details.accountType,
        stripeCustomerId, stripeBankAccount.id, stripeBankAccount.fingerprint,
        isDefault,
      ]
    );

    // Update stripe_customer_id on user if not already set
    await client.query(
      `UPDATE users SET updated_at = NOW() WHERE id = $1`, [req.user.id]
    );

    await client.query('COMMIT');
    res.status(201).json({ account: newAccount });

    const {
      alertTenantBankLinked,
      maybeAlertCheckinComplete,
    } = require('../services/ops-alert.service');
    alertTenantBankLinked({
      tenantId: req.user.id,
      bankAccountId: newAccount.id,
      institutionName: newAccount.institution_name,
      accountMask: newAccount.account_mask,
    }).catch((err) => console.warn('[payments/plaid/exchange] bank alert:', err.message));
    maybeAlertCheckinComplete(req.user.id).catch((err) => {
      console.warn('[payments/plaid/exchange] check-in alert:', err.message);
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[payments/plaid/exchange]', err.response?.data ?? err);
    res.status(500).json({
      error: 'EXCHANGE_FAILED',
      message: partnerErrorMessage(
        err,
        'Failed to link bank account. If this persists, confirm Stripe is enabled under Plaid Dashboard → Integrations.'
      ),
    });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/payments/bank-accounts/:id
// Revokes a linked bank account (Stripe + DB)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/bank-accounts/:id', async (req, res) => {
  if (blockManagerPaymentAccess(req, res)) return;
  try {
    const { rows } = await pool.query(
      `SELECT stripe_customer_id, stripe_bank_account_id
         FROM bank_accounts WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'NOT_FOUND' });

    // Remove from Stripe
    await stripe.stripe?.customers?.deleteSource?.(
      rows[0].stripe_customer_id, rows[0].stripe_bank_account_id
    ).catch(() => {}); // best-effort

    // Soft-delete in DB
    await pool.query(
      `UPDATE bank_accounts SET status = 'revoked', updated_at = NOW()
        WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );

    res.json({ message: 'Bank account removed.' });
  } catch (err) {
    console.error('[payments/bank-accounts/delete]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/balance
// Returns the tenant's current open lease, rent due, and any pending late fees.
// When this month's rent is already succeeded, totalDue is late fees only (not
// another full month) so the tenant UI shows Paid instead of false Overdue.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/balance', Guards.tenantOnly, async (req, res) => {
  try {
    // Active lease for rent, or signed native lease still finishing deposit/identity activation.
    const { rows: leaseRows } = await pool.query(
      `SELECT l.id AS lease_id, l.status, l.monthly_rent, l.grace_period_days,
              u.unit_number, p.name AS property_name,
              p.address_line1, p.city, p.state
         FROM leases l
         JOIN units      u ON u.id = l.unit_id
         JOIN properties p ON p.id = u.property_id
        WHERE l.tenant_id = $1
          AND l.status IN ('active', 'awaiting_deposit', 'awaiting_identity')
        ORDER BY CASE WHEN l.status = 'active' THEN 0 ELSE 1 END,
                 l.start_date DESC
        LIMIT 1`,
      [req.user.id]
    );
    if (!leaseRows[0]) return res.json({ balance: null, lease: null });

    const lease = leaseRows[0];
    const monthlyRent = parseFloat(lease.monthly_rent);

    // Calendar month in America/New_York (property timezone) — avoid UTC
    // flipping the period near month boundaries on Railway.
    const monthStart = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()).replace(/(\d{4})-(\d{2})-\d{2}/, (_, y, m) => `${y}-${m}-01`);

    // Prefer succeeded → processing → pending for "this month" rent row
    const { rows: paymentRows } = await pool.query(
      `SELECT id, amount, status, due_date, period_start, period_end, metadata
         FROM payments
        WHERE lease_id = $1
          AND payment_type = 'rent'
          AND period_start = $2
          AND status IN ('succeeded', 'processing', 'pending')
          AND COALESCE(metadata->>'closed_by_installments', 'false') <> 'true'
        ORDER BY
          CASE status
            WHEN 'succeeded'  THEN 0
            WHEN 'processing' THEN 1
            WHEN 'pending'    THEN 2
            ELSE 3
          END,
          CASE WHEN COALESCE(metadata->>'partial_installment', 'false') = 'true' THEN 1 ELSE 0 END,
          created_at DESC
        LIMIT 1`,
      [lease.lease_id, monthStart]
    );

    const { rows: paidRows } = await pool.query(
      `SELECT COALESCE(SUM(
                COALESCE(
                  NULLIF(metadata->>'rent_amount', '')::numeric,
                  amount
                )
              ), 0) AS paid
         FROM payments
        WHERE lease_id = $1
          AND payment_type = 'rent'
          AND period_start = $2
          AND status = 'succeeded'
          AND COALESCE(metadata->>'closed_by_installments', 'false') <> 'true'`,
      [lease.lease_id, monthStart]
    );
    const paidThisMonth = parseFloat(paidRows[0]?.paid ?? 0);
    const rentRemaining = Math.max(0, Math.round((monthlyRent - paidThisMonth) * 100) / 100);

    // Pending late fees
    const { rows: lateFeeRows } = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM late_fees
        WHERE lease_id = $1 AND status IN ('pending','applied')`,
      [lease.lease_id]
    );
    const lateFeeBalance = parseFloat(lateFeeRows[0]?.total ?? 0);

    const currentPayment = paymentRows[0] ?? null;
    const paidInFull = rentRemaining <= 0.009;

    // Next due: 1st of following month when this month is settled
    let nextDueDate = currentPayment?.due_date ?? monthStart;
    if (paidInFull) {
      const [y, m] = monthStart.split('-').map(Number);
      const next = new Date(Date.UTC(y, m, 1)); // m is already 1-based month number → use as next month index
      // monthStart is YYYY-MM-01; Date.UTC(y, m, 1) with m=7 → Aug 1. Correct.
      nextDueDate = next.toISOString().slice(0, 10);
    }

    const { rows: depositRows } = await pool.query(
      `SELECT id, amount, status, due_date, period_start, period_end, metadata
         FROM payments
        WHERE lease_id = $1
          AND payment_type = 'security_deposit'
          AND status IN ('pending','processing')
          AND COALESCE(metadata->>'partial_installment', 'false') <> 'true'
        ORDER BY due_date ASC
        LIMIT 1`,
      [lease.lease_id]
    );

    let securityDepositPayment = null;
    if (depositRows[0]) {
      const dep = depositRows[0];
      const meta = dep.metadata || {};
      const remaining = parseFloat(dep.amount);
      const paidRaw = parseFloat(meta.deposit_paid_total);
      const paidTotal = Number.isFinite(paidRaw) ? paidRaw : 0;
      const originalRaw = parseFloat(meta.deposit_original_amount);
      const originalAmount = Number.isFinite(originalRaw)
        ? originalRaw
        : Math.round((remaining + paidTotal) * 100) / 100;
      securityDepositPayment = {
        id: dep.id,
        amount: remaining,
        remaining,
        paidTotal,
        originalAmount,
        isPartial: paidTotal > 0.009 || meta.partial_deposit === true,
        status: dep.status,
        due_date: dep.due_date,
        period_start: dep.period_start,
        period_end: dep.period_end,
      };
    }

    const openUtilitySplits = await listOpenUtilitySplits(pool, req.user.id, {
      leaseId: lease.lease_id,
    });
    const utilitySummary = summarizeOpenUtilities(openUtilitySplits);

    res.json({
      lease: {
        id:           lease.lease_id,
        status:       lease.status,
        unit:         `${lease.property_name} — Unit ${lease.unit_number}`,
        address:      `${lease.address_line1}, ${lease.city}, ${lease.state}`,
        monthlyRent,
        gracePeriod:  lease.grace_period_days,
        nextDueDate,
      },
      currentPayment: currentPayment
        ? { ...currentPayment, amount: parseFloat(currentPayment.amount) }
        : (paidInFull
          ? {
              id: null,
              amount: paidThisMonth,
              status: 'succeeded',
              due_date: monthStart,
              period_start: monthStart,
              period_end: null,
            }
          : null),
      securityDepositPayment,
      lateFeeBalance,
      rentRemaining,
      paidThisMonth,
      totalDue: Math.round((rentRemaining + lateFeeBalance) * 100) / 100,
      utilityDue: utilitySummary.utilityDue,
      utilitySplits: utilitySummary.utilitySplits,
      cashAppPayAvailable: stripe.isCashAppPayConfigured(),
    });
  } catch (err) {
    console.error('[payments/balance]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/charge
// Body: { bankAccountId, leaseId, paymentType? }
// Initiates an ACH debit for the tenant's rent (or late fee)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/charge', Guards.tenantOnly, async (req, res) => {
  if (blockManagerPaymentAccess(req, res)) return;
  const { bankAccountId, leaseId, paymentType = 'rent', amount = null, utilitySplitId = null } = req.body;

  if (!bankAccountId || !leaseId) {
    return res.status(400).json({ error: 'MISSING_PARAMS' });
  }
  if (!CLIENT_INTENT_PAYMENT_TYPES.has(paymentType)) {
    return res.status(400).json({ error: 'UNSUPPORTED_TYPE' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Verify the bank account belongs to this tenant and is verified
    const { rows: accountRows } = await client.query(
      `SELECT stripe_customer_id, stripe_bank_account_id, status, link_status,
              plaid_access_token_encrypted, plaid_account_id, account_name
         FROM bank_accounts WHERE id = $1 AND user_id = $2`,
      [bankAccountId, req.user.id]
    );
    const account = accountRows[0];
    if (!account) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });
    }
    if (account.status !== 'verified') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'ACCOUNT_NOT_VERIFIED', message: 'Bank account is not yet verified.' });
    }
    if (account.link_status === 'needs_relink') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'ACCOUNT_NEEDS_RELINK',
        message: 'Your bank connection expired. Reconnect your account on the Payments page before paying.',
      });
    }

    const prep = paymentType === 'utility'
      ? await prepareUtilityPortalCharge(client, {
        tenantId: req.user.id,
        leaseId,
        splitId: utilitySplitId || null,
        bankAccountId,
        metadataExtra: {
          payment_method: 'ach',
          source: 'stripe_ach',
        },
      })
      : await prepareTenantCharge(client, {
        tenantId: req.user.id,
        leaseId,
        paymentType,
        bankAccountId,
        amount: ['rent', 'security_deposit'].includes(paymentType) ? amount : null,
        metadataExtra: {
          payment_method: 'ach',
          source: 'stripe_ach',
        },
      });
    const {
      payment,
      amountDollars,
      amountCents,
      description,
      chargeMeta,
      rentAmount = null,
      lateFeeAmount = null,
      billIds = [],
    } = prep;

    // 6. Plaid Signal / Balance gates, then Stripe ACH debit
    const accessToken = decrypt(account.plaid_access_token_encrypted);

    const guard = await assertAchDebitAllowed({
      accessToken,
      accountId: account.plaid_account_id,
      amountCents,
      userId: req.user.id,
      userPresent: true,
      clientTransactionId: `rent-${payment.id}`,
      context: paymentType,
    });
    if (!guard.ok) {
      await client.query('ROLLBACK');
      return res.status(guard.status).json(guard.body);
    }

    const { routing, account: acctNum } = await plaid.getAchAccountNumbers(
      accessToken, account.plaid_account_id
    );

    const { rows: [userRow] } = await client.query(
      `SELECT first_name, last_name, email FROM users WHERE id = $1`,
      [req.user.id]
    );
    const holderName = [userRow.first_name, userRow.last_name].filter(Boolean).join(' ')
      || userRow.email;

    // Keep Stripe Customer.name filled so Dashboard doesn't show blank/unknown.
    if (account.stripe_customer_id) {
      await stripe.syncCustomerProfile(account.stripe_customer_id, {
        name: holderName,
        email: userRow.email,
      });
    }

    const { rows: [loc] } = await client.query(
      `SELECT p.name AS property_name, u.unit_number
         FROM leases l
         JOIN units u ON u.id = l.unit_id
         JOIN properties p ON p.id = u.property_id
        WHERE l.id = $1`,
      [leaseId]
    );
    const propertyLabel = loc
      ? stripe.formatPropertyLabel(loc.property_name, loc.unit_number)
      : null;
    const labeledDescription = stripe.withPayerLabel(description, {
      name: holderName,
      email: userRow.email,
      propertyLabel,
    });

    const paymentIntent = await stripe.chargeACH({
      amountCents,
      customerId:        account.stripe_customer_id,
      routingNumber:     routing,
      accountNumber:     acctNum,
      accountHolderName: holderName,
      description: labeledDescription,
      metadata: {
        payment_id: payment.id,
        lease_id:   leaseId,
        tenant_id:  req.user.id,
        payment_type: paymentType,
        ...chargeMeta,
        ...stripe.payerMetadata({
          name: holderName,
          email: userRow.email,
          userId: req.user.id,
          propertyLabel,
        }),
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? '',
    });

    const localStatus =
      paymentIntent.status === 'succeeded'  ? 'succeeded'
      : paymentIntent.status === 'canceled' ? 'failed'
      :                                       'processing';

    // 7. Update payment row with Stripe PaymentIntent
    await client.query(
      `UPDATE payments
          SET stripe_payment_intent_id = $1,
              stripe_charge_id         = $2,
              status                   = $3::payment_status,
              paid_at                  = CASE WHEN $3::text = 'succeeded' THEN NOW() ELSE paid_at END,
              updated_at               = NOW()
        WHERE id = $4`,
      [
        paymentIntent.id,
        typeof paymentIntent.latest_charge === 'string'
          ? paymentIntent.latest_charge
          : paymentIntent.latest_charge?.id ?? null,
        localStatus,
        payment.id,
      ]
    );

    if (localStatus === 'succeeded' && paymentType === 'rent') {
      const { settleRentPaymentSuccess } = require('../utils/payment-settlement');
      await settleRentPaymentSuccess(client, {
        paymentId: payment.id,
        leaseId,
        amount: amountDollars,
      });
    }

    if (localStatus === 'succeeded' && paymentType === 'utility') {
      await markUtilitySplitsPaidForPayment(client, payment.id);
    }

    if (localStatus === 'failed' && paymentType === 'utility') {
      await releaseUtilitySplitsForFailedPayment(client, payment.id);
    }

    if (localStatus === 'succeeded' && paymentType === 'security_deposit') {
      const { applyDepositCredit } = require('../services/security-deposit-partial.service');
      const isInstallment = chargeMeta.partial_installment === true;
      if (isInstallment) {
        const credit = await applyDepositCredit(client, {
          leaseId,
          creditAmount: amountDollars,
          installmentPaymentId: payment.id,
          paidAt: new Date(),
          partMeta: { source: 'stripe_ach', payment_method: 'ach' },
        });
        if (credit.completed) {
          await activateNativeLeaseAfterDeposit(client, leaseId);
        }
      } else {
        await client.query(
          `UPDATE leases
              SET deposit_paid_at = COALESCE(deposit_paid_at, NOW()),
                  updated_at = NOW()
            WHERE id = $1`,
          [leaseId]
        );
        await activateNativeLeaseAfterDeposit(client, leaseId);
      }
    }

    await client.query('COMMIT');

    if (localStatus === 'succeeded' && paymentType === 'utility' && billIds.length) {
      const { maybeSettleBill } = require('../use-cases/utilities');
      for (const billId of billIds) {
        await maybeSettleBill(pool, billId).catch((e) =>
          console.error('[payments/charge] settle utility bill', billId, e.message)
        );
      }
    }

    if (localStatus === 'succeeded') {
      settleSuccessfulRentPayment(pool, {
        paymentId: payment.id,
        tenantId: req.user.id,
        leaseId,
        amount: amountDollars,
        paymentType,
        skipLateFeeClear: paymentType === 'rent',
      });
    }

    res.status(202).json({
      message:   localStatus === 'succeeded'
        ? 'Payment succeeded.'
        : 'Payment initiated. ACH transfers settle in 4–5 business days.',
      paymentId: payment.id,
      status:    localStatus,
      amount:    amountDollars,
      rentAmount,
      lateFeeAmount,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'DUPLICATE_PAYMENT') {
      return res.status(409).json({ error: 'DUPLICATE_PAYMENT', message: err.message });
    }
    if (err.code === 'NO_DEPOSIT_DUE') {
      return res.status(404).json({ error: 'NO_DEPOSIT_DUE', message: err.message });
    }
    if (err.code === 'NOTHING_DUE') {
      return res.status(404).json({ error: 'NOTHING_DUE', message: err.message });
    }
    if (err.code === 'LEASE_NOT_FOUND') {
      return res.status(404).json({ error: 'LEASE_NOT_FOUND' });
    }
    if (err.code === 'INVALID_DEPOSIT_AMOUNT' || err.code === 'INVALID_PAYMENT_AMOUNT') {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    console.error('[payments/charge]', err);
    res.status(500).json({ error: 'CHARGE_FAILED', message: 'Payment could not be initiated.' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
function tenantStripeClientConfig() {
  const cashAppPayAvailable = stripe.isCashAppPayConfigured();
  return {
    publishableKey: stripe.getPublishableKey(),
    cashAppPayAvailable,
    cashAppEnabled: cashAppPayAvailable,
    processingFees: feeSchedulePublic(),
  };
}

// GET /api/payments/stripe-config — tenant: publishable key for Stripe.js
// GET /api/payments/config — alias (publishableKey + cashAppEnabled)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stripe-config', Guards.tenantOnly, (req, res) => {
  res.json(tenantStripeClientConfig());
});

router.get('/config', Guards.tenantOnly, (req, res) => {
  res.json(tenantStripeClientConfig());
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/cashapp/create-intent — tenant: Cash App Pay for rent/deposit
// Body: { leaseId, paymentType?: 'rent'|'security_deposit', amount?: number }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/cashapp/create-intent', Guards.tenantOnly, async (req, res) => {
  if (blockManagerPaymentAccess(req, res)) return;

  if (!stripe.isCashAppPayConfigured()) {
    return res.status(503).json({
      error: 'CASHAPP_NOT_CONFIGURED',
      message: 'Cash App Pay is not configured. Add STRIPE_PUBLISHABLE_KEY and enable Cash App Pay in Stripe.',
    });
  }

  const { leaseId, paymentType = 'rent', amount = null, utilitySplitId = null } = req.body;
  if (!leaseId) return res.status(400).json({ error: 'MISSING_PARAMS' });
  if (!CLIENT_INTENT_PAYMENT_TYPES.has(paymentType)) {
    return res.status(400).json({
      error: 'UNSUPPORTED_TYPE',
      message: 'Cash App Pay is available for rent, security deposits, and utilities.',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prep = paymentType === 'utility'
      ? await prepareUtilityPortalCharge(client, {
        tenantId: req.user.id,
        leaseId,
        splitId: utilitySplitId || null,
        bankAccountId: null,
        metadataExtra: {
          payment_method: 'cash_app',
          source: 'stripe_cashapp',
        },
      })
      : await prepareTenantCharge(client, {
        tenantId: req.user.id,
        leaseId,
        paymentType,
        bankAccountId: null,
        amount: ['rent', 'security_deposit'].includes(paymentType) ? amount : null,
        metadataExtra: {
          payment_method: 'cash_app',
          source: 'stripe_cashapp',
        },
      });

    const { rows: [userRow] } = await client.query(
      `SELECT first_name, last_name, email FROM users WHERE id = $1`,
      [req.user.id]
    );
    const customerId = await stripe.getOrCreateCustomer(req.user.id, userRow.email, {
      firstName: userRow.first_name,
      lastName: userRow.last_name,
    });
    const payerName = stripe.personDisplayName({
      firstName: userRow.first_name,
      lastName: userRow.last_name,
      email: userRow.email,
    });

    const { rows: [loc] } = await client.query(
      `SELECT p.name AS property_name, u.unit_number
         FROM leases l
         JOIN units u ON u.id = l.unit_id
         JOIN properties p ON p.id = u.property_id
        WHERE l.id = $1`,
      [leaseId]
    );
    const propertyLabel = loc
      ? stripe.formatPropertyLabel(loc.property_name, loc.unit_number)
      : null;

    // Tenant pays 2.9%+$0.30; ledger payment.amount stays base rent.
    const fee = computeCardCashAppFee(prep.amountCents);
    const feeMeta = feeMetadata(fee);

    const paymentIntent = await stripe.createCashAppPaymentIntent({
      amountCents: fee.totalCents,
      customerId,
      description: stripe.withPayerLabel(`${prep.description} (incl. processing fee)`, {
        name: payerName,
        email: userRow.email,
        propertyLabel,
      }),
      metadata: {
        payment_id: prep.payment.id,
        lease_id: leaseId,
        tenant_id: req.user.id,
        payment_type: paymentType,
        ...prep.chargeMeta,
        ...feeMeta,
        ...stripe.payerMetadata({
          name: payerName,
          email: userRow.email,
          userId: req.user.id,
          propertyLabel,
        }),
      },
    });

    await client.query(
      `UPDATE payments
          SET stripe_payment_intent_id = $1,
              metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE id = $3`,
      [
        paymentIntent.id,
        JSON.stringify({
          payment_method: 'cash_app',
          source: 'stripe_cashapp',
          ...feeMeta,
        }),
        prep.payment.id,
      ]
    );

    await client.query('COMMIT');

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      paymentId: prep.payment.id,
      amount: fee.totalAmount,
      baseAmount: fee.baseAmount,
      processingFee: fee.processingFee,
      publishableKey: stripe.getPublishableKey(),
      isPartialDeposit: prep.chargeMeta?.partial_installment === true,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'LEASE_NOT_FOUND') {
      return res.status(404).json({ error: 'LEASE_NOT_FOUND' });
    }
    if (err.code === 'NO_DEPOSIT_DUE') {
      return res.status(404).json({ error: 'NO_DEPOSIT_DUE', message: err.message });
    }
    if (err.code === 'DUPLICATE_PAYMENT') {
      return res.status(409).json({ error: 'DUPLICATE_PAYMENT', message: err.message });
    }
    if (err.code === 'INVALID_DEPOSIT_AMOUNT' || err.code === 'INVALID_PAYMENT_AMOUNT') {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    if (err.code === 'NOTHING_DUE') {
      return res.status(404).json({ error: 'NOTHING_DUE', message: err.message });
    }
    console.error('[payments/cashapp/create-intent]', err);
    const message = err.message?.includes('cashapp')
      ? 'Cash App Pay is not enabled on your Stripe account. Enable it in Stripe Dashboard → Settings → Payment methods.'
      : 'Could not start Cash App payment.';
    res.status(500).json({ error: 'CASHAPP_INTENT_FAILED', message });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/card/create-intent — tenant: card payment for rent/deposit
// Body: { leaseId, paymentType?: 'rent'|'security_deposit', amount?: number, includeFirstMonth?: boolean }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/card/create-intent', Guards.tenantOnly, async (req, res) => {
  if (blockManagerPaymentAccess(req, res)) return;

  const { leaseId, paymentType = 'rent', amount = null, includeFirstMonth = false, utilitySplitId = null } = req.body;
  if (!leaseId) return res.status(400).json({ error: 'MISSING_PARAMS' });
  if (!CLIENT_INTENT_PAYMENT_TYPES.has(paymentType)) {
    return res.status(400).json({ error: 'UNSUPPORTED_TYPE' });
  }
  if (includeFirstMonth && paymentType !== 'security_deposit') {
    return res.status(400).json({
      error: 'UNSUPPORTED_BUNDLE',
      message: 'First-month bundling is only available with security deposits.',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prep = paymentType === 'utility'
      ? await prepareUtilityPortalCharge(client, {
        tenantId: req.user.id,
        leaseId,
        splitId: utilitySplitId || null,
        bankAccountId: null,
        metadataExtra: {
          payment_method: 'card',
          source: 'stripe_card',
        },
      })
      : await prepareTenantCharge(client, {
        tenantId: req.user.id,
        leaseId,
        paymentType,
        bankAccountId: null,
        amount: ['rent', 'security_deposit'].includes(paymentType) ? amount : null,
        metadataExtra: {
          payment_method: 'card',
          source: 'stripe_card',
          ...(includeFirstMonth ? { include_first_month: 'true' } : {}),
        },
      });

    let amountDollars = prep.amountDollars;
    let amountCents = prep.amountCents;
    const bundleMeta = {};
    if (includeFirstMonth) {
      if (prep.chargeMeta?.partial_installment === true) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'UNSUPPORTED_BUNDLE',
          message: 'First-month rent can only be bundled when paying the full remaining deposit.',
        });
      }
      const firstMonthRent = parseFloat(prep.lease.monthly_rent);
      amountDollars += firstMonthRent;
      amountCents += Math.round(firstMonthRent * 100);
      bundleMeta.include_first_month = 'true';
      bundleMeta.bundled_first_month_rent = firstMonthRent.toFixed(2);
    }

    const { rows: [userRow] } = await client.query(
      `SELECT first_name, last_name, email FROM users WHERE id = $1`,
      [req.user.id]
    );
    const customerId = await stripe.getOrCreateCustomer(req.user.id, userRow.email, {
      firstName: userRow.first_name,
      lastName: userRow.last_name,
    });
    const payerName = stripe.personDisplayName({
      firstName: userRow.first_name,
      lastName: userRow.last_name,
      email: userRow.email,
    });

    const { rows: [loc] } = await client.query(
      `SELECT p.name AS property_name, u.unit_number
         FROM leases l
         JOIN units u ON u.id = l.unit_id
         JOIN properties p ON p.id = u.property_id
        WHERE l.id = $1`,
      [leaseId]
    );
    const propertyLabel = loc
      ? stripe.formatPropertyLabel(loc.property_name, loc.unit_number)
      : null;

    // Tenant pays 2.9%+$0.30 on card; ledger payment.amount stays base.
    const fee = computeCardCashAppFee(amountCents);
    const feeMeta = feeMetadata(fee);

    const baseDescription = includeFirstMonth
      ? `${prep.description} + first month rent (incl. processing fee)`
      : `${prep.description} (incl. processing fee)`;

    const paymentIntent = await stripe.createCardPaymentIntent({
      amountCents: fee.totalCents,
      customerId,
      description: stripe.withPayerLabel(baseDescription, {
        name: payerName,
        email: userRow.email,
        propertyLabel,
      }),
      metadata: {
        payment_id: prep.payment.id,
        lease_id: leaseId,
        tenant_id: req.user.id,
        payment_type: paymentType,
        ...prep.chargeMeta,
        ...bundleMeta,
        ...feeMeta,
        ...stripe.payerMetadata({
          name: payerName,
          email: userRow.email,
          userId: req.user.id,
          propertyLabel,
        }),
      },
    });

    await client.query(
      `UPDATE payments
          SET stripe_payment_intent_id = $1,
              metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE id = $3`,
      [
        paymentIntent.id,
        JSON.stringify({
          payment_method: 'card',
          source: 'stripe_card',
          ...bundleMeta,
          ...feeMeta,
        }),
        prep.payment.id,
      ]
    );

    await client.query('COMMIT');

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      paymentId: prep.payment.id,
      amount: fee.totalAmount,
      baseAmount: fee.baseAmount,
      processingFee: fee.processingFee,
      publishableKey: stripe.getPublishableKey(),
      isPartialDeposit: prep.chargeMeta?.partial_installment === true,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'LEASE_NOT_FOUND') {
      return res.status(404).json({ error: 'LEASE_NOT_FOUND' });
    }
    if (err.code === 'NO_DEPOSIT_DUE') {
      return res.status(404).json({ error: 'NO_DEPOSIT_DUE', message: err.message });
    }
    if (err.code === 'DUPLICATE_PAYMENT') {
      return res.status(409).json({ error: 'DUPLICATE_PAYMENT', message: err.message });
    }
    if (err.code === 'INVALID_DEPOSIT_AMOUNT' || err.code === 'INVALID_PAYMENT_AMOUNT') {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    if (err.code === 'NOTHING_DUE') {
      return res.status(404).json({ error: 'NOTHING_DUE', message: err.message });
    }
    if (isStripeAccountRestrictionError(err)) {
      return res.status(503).json({
        error: 'STRIPE_ACCOUNT_RESTRICTED',
        message: err.message,
      });
    }
    console.error('[payments/card/create-intent]', err);
    res.status(500).json({ error: 'CARD_INTENT_FAILED', message: 'Could not start card payment.' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/cashapp/sync?payment_intent=pi_xxx — after Cash App redirect
// ─────────────────────────────────────────────────────────────────────────────
router.get('/cashapp/sync', Guards.tenantOnly, async (req, res) => {
  const paymentIntentId = req.query.payment_intent;
  if (!paymentIntentId) return res.status(400).json({ error: 'MISSING_PARAMS' });

  try {
    const { rows } = await pool.query(
      `SELECT id, status, amount, payment_type, lease_id, tenant_id, failure_reason, metadata
         FROM payments
        WHERE stripe_payment_intent_id = $1 AND tenant_id = $2`,
      [paymentIntentId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'NOT_FOUND' });

    const payment = rows[0];
    const pi = await stripe.retrievePaymentIntent(paymentIntentId);
    let status = payment.status;
    let failureReason = payment.failure_reason;

    if (pi.status === 'succeeded' && status !== 'succeeded') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rowCount } = await client.query(
          `UPDATE payments
              SET status = 'succeeded',
                  stripe_charge_id = $1,
                  paid_at = COALESCE(paid_at, NOW()),
                  metadata = COALESCE(metadata, '{}'::jsonb) || '{"payment_method":"cash_app","source":"stripe_cashapp"}'::jsonb,
                  updated_at = NOW()
            WHERE id = $2 AND status <> 'succeeded'`,
          [
            typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null,
            payment.id,
          ]
        );
        if (rowCount && payment.payment_type === 'security_deposit') {
          const meta = payment.metadata || {};
          const isInstallment = meta.partial_installment === true
            || meta.partial_installment === 'true';
          const { applyDepositCredit } = require('../services/security-deposit-partial.service');
          if (isInstallment) {
            const credit = await applyDepositCredit(client, {
              leaseId: payment.lease_id,
              creditAmount: parseFloat(payment.amount),
              installmentPaymentId: payment.id,
              paidAt: new Date(),
              partMeta: { source: 'stripe_cashapp', payment_method: 'cash_app' },
            });
            if (credit.completed) {
              await activateNativeLeaseAfterDeposit(client, payment.lease_id);
            }
          } else {
            await client.query(
              `UPDATE leases
                  SET deposit_paid_at = COALESCE(deposit_paid_at, NOW()),
                      updated_at = NOW()
                WHERE id = $1`,
              [payment.lease_id]
            );
            await activateNativeLeaseAfterDeposit(client, payment.lease_id);
          }
        }
        if (rowCount && payment.payment_type === 'rent') {
          const { settleRentPaymentSuccess } = require('../utils/payment-settlement');
          await settleRentPaymentSuccess(client, {
            paymentId: payment.id,
            leaseId: payment.lease_id,
            amount: parseFloat(payment.amount),
          });
        }
        let utilityBillIds = [];
        if (shouldMarkUtilityPaidOnCashAppSyncSuccess({
          rowCount,
          paymentType: payment.payment_type,
        })) {
          utilityBillIds = await markUtilitySplitsPaidForPayment(client, payment.id);
        }
        await client.query('COMMIT');
        if (rowCount) {
          status = 'succeeded';
          for (const billId of utilityBillIds) {
            const { maybeSettleBill } = require('../use-cases/utilities');
            await maybeSettleBill(pool, billId).catch((e) =>
              console.error('[payments/cashapp/sync] settle utility bill', billId, e.message)
            );
          }
          await settleSuccessfulRentPayment(pool, {
            paymentId: payment.id,
            tenantId: payment.tenant_id,
            leaseId: payment.lease_id,
            amount: parseFloat(payment.amount),
            paymentType: payment.payment_type,
            skipLateFeeClear: payment.payment_type === 'rent',
          });
        } else {
          status = 'succeeded';
        }
      } catch (syncErr) {
        await client.query('ROLLBACK');
        throw syncErr;
      } finally {
        client.release();
      }
    } else if (pi.status === 'processing' && status === 'pending') {
      await pool.query(
        `UPDATE payments SET status = 'processing', updated_at = NOW() WHERE id = $1`,
        [payment.id]
      );
      status = 'processing';
    } else if (shouldMarkCashAppSyncFailed(pi.status, status)) {
      // Only terminal PI failures — do not treat a stale last_payment_error on a
      // still-processing intent as failure (would unlock splits then double-charge).
      failureReason = cashAppSyncFailureReason(pi);
      const { rows: failedRows } = await pool.query(
        `UPDATE payments
            SET status = 'failed', failure_reason = $1, updated_at = NOW()
          WHERE id = $2
            AND status IN ('pending', 'processing')
         RETURNING id, payment_type`,
        [failureReason, payment.id]
      );
      if (shouldUnlockUtilitySplitsOnCashAppSyncFail(failedRows[0])) {
        await releaseUtilitySplitsForFailedPayment(pool, failedRows[0].id);
      }
      if (failedRows[0]) status = 'failed';
    }

    res.json({
      paymentId: payment.id,
      status,
      amount: parseFloat(payment.amount),
      failureReason: status === 'failed' ? failureReason : null,
    });
  } catch (err) {
    console.error('[payments/cashapp/sync]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/history?page=1&limit=12
// Paginated payment history for the authenticated tenant
// ─────────────────────────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  ?? '1',  10));
  const limit = Math.min(50, parseInt(req.query.limit ?? '12', 10));
  const offset = (page - 1) * limit;

  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.amount, p.currency, p.status, p.payment_type,
              p.period_start, p.period_end, p.due_date, p.paid_at,
              p.failure_reason, p.metadata,
              ba.institution_name, ba.account_mask,
              p.metadata->>'payment_method' AS payment_method,
              p.metadata->>'external_reference' AS external_reference
         FROM payments p
         LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id
        WHERE p.tenant_id = $1 AND ${ledgerPaymentWhere('p')}
        ORDER BY COALESCE(p.paid_at, p.created_at) DESC
        LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS total FROM payments p WHERE p.tenant_id = $1 AND ${ledgerPaymentWhere('p')}`,
      [req.user.id]
    );

    const payments = isManagerImpersonation(req)
      ? rows.map(redactPaymentHistoryRow)
      : rows;

    res.json({
      payments,
      pagination: {
        page,
        limit,
        total: parseInt(countRows[0].total, 10),
        pages: Math.ceil(parseInt(countRows[0].total, 10) / limit),
      },
    });
  } catch (err) {
    console.error('[payments/history]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/rent-status — staff: who paid, who is late, email hints
// ─────────────────────────────────────────────────────────────────────────────
router.get('/rent-status', Guards.staffOnly, async (req, res) => {
  try {
    const roster = await getRentStatusRoster(req.user.id, req.user.role);
    res.json(roster);
  } catch (err) {
    console.error('[payments/rent-status]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/manager  — manager: all payments across accessible properties
// ─────────────────────────────────────────────────────────────────────────────
router.get('/manager', Guards.staffOnly, async (req, res) => {
  try {
    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    if (!propIds.length) return res.json({ payments: [], stats: null });

    const { status, payment_type, tenant_id } = req.query;
    const page  = Math.max(1, Number(req.query.page  ?? 1));
    const limit = Math.min(100, Number(req.query.limit ?? 50));
    const offset = (page - 1) * limit;

    let conditions = [
      'un.property_id = ANY($1)',
      ledgerPaymentWhere('p'),
      notSiteArchivedWhere('u'),
    ];
    let params = [propIds];
    if (status)       { params.push(status);       conditions.push(`p.status = $${params.length}`); }
    if (payment_type) { params.push(payment_type); conditions.push(`p.payment_type = $${params.length}`); }
    if (tenant_id)    { params.push(tenant_id);    conditions.push(`p.tenant_id = $${params.length}`); }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    const whereSql = conditions.join(' AND ');

    const [paymentsR, countR, statsR] = await Promise.all([
      pool.query(
        `SELECT p.id, p.amount, p.status, p.payment_type, p.period_start, p.paid_at, p.created_at,
                p.failure_reason,
                p.stripe_payment_intent_id,
                p.metadata->>'payment_method' AS payment_method,
                p.metadata->>'external_reference' AS external_reference,
                p.metadata->>'source' AS source,
                p.metadata->>'partial_rent' AS partial_rent,
                (u.first_name || ' ' || u.last_name) AS tenant_name, u.email AS tenant_email,
                u.id AS tenant_id,
                un.unit_number, pr.name AS property_name
         FROM payments p
         JOIN leases l ON l.id = p.lease_id
         JOIN units un ON un.id = l.unit_id
         JOIN properties pr ON pr.id = un.property_id
         JOIN users u ON u.id = p.tenant_id
         WHERE ${whereSql}
         ORDER BY COALESCE(p.paid_at, p.created_at) DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) AS total
           FROM payments p
           JOIN leases l ON l.id = p.lease_id
           JOIN units un ON un.id = l.unit_id
           JOIN users u ON u.id = p.tenant_id
          WHERE ${whereSql}`,
        params
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(p.amount) FILTER (
             WHERE p.status = 'succeeded'
               AND p.payment_type = 'rent'
               AND p.period_start >= $2::date
               AND p.period_start < ($2::date + INTERVAL '1 month')
           ), 0) AS this_month,
           COALESCE(SUM(p.amount) FILTER (WHERE p.status IN ('failed','pending')), 0) AS outstanding,
           COUNT(*) FILTER (WHERE p.status = 'failed') AS failed_count,
           COUNT(DISTINCT p.tenant_id) FILTER (
             WHERE p.status = 'succeeded'
               AND p.payment_type = 'rent'
               AND p.period_start >= $2::date
               AND p.period_start < ($2::date + INTERVAL '1 month')
           ) AS paid_count
         FROM payments p
         JOIN leases l ON l.id = p.lease_id
         JOIN units un ON un.id = l.unit_id
         WHERE un.property_id = ANY($1)
           AND ${ledgerPaymentWhere('p')}`,
        [propIds, monthStart]
      ),
    ]);

    const total = parseInt(countR.rows[0].total, 10);
    res.json({
      payments: paymentsR.rows,
      stats: statsR.rows[0],
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    console.error('[payments/manager]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/record — staff: record offline payment (Cash App, check, etc.)
// Body: { leaseId, amount, paidAt?, periodStart?, periodEnd?, paymentType?,
//         paymentMethod?, reference?, notes?, notify? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/record', Guards.staffOnly, async (req, res) => {
  const {
    leaseId,
    amount,
    paidAt,
    periodStart,
    periodEnd,
    paymentType = 'rent',
    paymentMethod = 'cash_app',
    reference,
    notes,
    notify = false,
  } = req.body;

  if (!leaseId || amount == null) {
    return res.status(400).json({ error: 'MISSING_PARAMS', message: 'leaseId and amount are required.' });
  }

  const amountNum = parseFloat(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'INVALID_AMOUNT' });
  }

  if (!MANUAL_METHODS.has(paymentMethod)) {
    return res.status(400).json({ error: 'INVALID_METHOD', message: `paymentMethod must be one of: ${[...MANUAL_METHODS].join(', ')}` });
  }

  const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
  if (!propIds.length) return res.status(403).json({ error: 'FORBIDDEN' });

  const paidDate = paidAt ? new Date(`${String(paidAt).slice(0, 10)}T12:00:00`) : new Date();
  if (Number.isNaN(paidDate.getTime())) {
    return res.status(400).json({ error: 'INVALID_DATE' });
  }

  const bounds = monthBounds(paidDate);
  const pStart = periodStart ? String(periodStart).slice(0, 10) : bounds.start;
  const pEnd = periodEnd ? String(periodEnd).slice(0, 10) : bounds.end;
  const paidAtTs = paidDate.toISOString();

  const metadata = {
    payment_method: paymentMethod,
    external_reference: reference || null,
    notes: notes || null,
    recorded_by: req.user.id,
    recorded_at: new Date().toISOString(),
    source: 'manual',
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: leaseRows } = await client.query(
      `SELECT l.id, l.tenant_id, un.property_id
         FROM leases l
         JOIN units un ON un.id = l.unit_id
        WHERE l.id = $1 AND un.property_id = ANY($2)`,
      [leaseId, propIds]
    );
    if (!leaseRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'LEASE_NOT_FOUND' });
    }

    const { tenant_id: tenantId } = leaseRows[0];

    const { rows: dupRows } = await client.query(
      `SELECT id FROM payments
        WHERE lease_id = $1 AND payment_type = $2 AND period_start = $3::date
          AND status = 'succeeded'`,
      [leaseId, paymentType, pStart]
    );
    if (dupRows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'DUPLICATE_PAYMENT',
        message: 'A succeeded payment already exists for this lease and period.',
        paymentId: dupRows[0].id,
      });
    }

    const { rows: pendingRows } = await client.query(
      `SELECT id FROM payments
        WHERE lease_id = $1 AND payment_type = $2 AND period_start = $3::date
          AND status IN ('pending','processing')
        ORDER BY created_at DESC LIMIT 1`,
      [leaseId, paymentType, pStart]
    );

    let paymentId;
    if (pendingRows[0]) {
      const { rows: updated } = await client.query(
        `UPDATE payments
            SET amount = $1, status = 'succeeded', paid_at = $2,
                metadata = $3, updated_at = NOW()
          WHERE id = $4
         RETURNING id`,
        [amountNum, paidAtTs, JSON.stringify(metadata), pendingRows[0].id]
      );
      paymentId = updated[0].id;
    } else {
      const { rows: inserted } = await client.query(
        `INSERT INTO payments
           (lease_id, tenant_id, amount, currency, status, payment_type,
            period_start, period_end, due_date, paid_at, metadata)
         VALUES ($1,$2,$3,'USD','succeeded',$4,$5::date,$6::date,$5::date,$7,$8)
         RETURNING id`,
        [leaseId, tenantId, amountNum, paymentType, pStart, pEnd, paidAtTs, JSON.stringify(metadata)]
      );
      paymentId = inserted[0].id;
    }

    if (paymentType === 'rent') {
      await client.query(
        `UPDATE late_fees
            SET status = 'paid', applied_at = NOW()
          WHERE lease_id = $1 AND status IN ('pending','applied')`,
        [leaseId]
      );
    }

    if (paymentType === 'rent') {
      await markLateFeesPaidForLease(client, leaseId);
    }

    await client.query('COMMIT');

    notifyPaymentReceived({
      paymentId,
      tenantId,
      leaseId,
      amount: amountNum,
      paymentType,
    }).catch((err) => console.error('[payments/record] email:', err.message));

    res.status(201).json({
      paymentId,
      message: 'Payment recorded.',
      paymentMethod,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[payments/record]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  } finally {
    client.release();
  }
});

// GET /api/payments/health — staff: Stripe + Plaid + webhook + tenant payment readiness
router.get('/health', Guards.staffOnly, async (req, res) => {
  try {
    const report = await runPaymentsHealth();
    res.status(report.ok ? 200 : 503).json(report);
  } catch (err) {
    console.error('[payments/health]', err);
    res.status(500).json({ error: 'HEALTH_CHECK_FAILED', message: err.message });
  }
});

// POST /api/payments/run-billing — staff: generate monthly invoices + apply late fees
router.post('/run-billing', Guards.staffOnly, async (req, res) => {
  try {
    const result = await rentBilling.runDailyRentBilling();
    res.json(result);
  } catch (err) {
    console.error('[payments/run-billing]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// POST /api/payments/cashapp/sync-gmail — retired (off-app Cash App archived)
router.post('/cashapp/sync-gmail', Guards.staffOnly, async (req, res) => {
  if (process.env.CASHAPP_GMAIL_SYNC_ENABLED !== 'true') {
    return res.status(410).json({
      error: 'CASHAPP_IMPORT_DISABLED',
      message:
        'Off-app Cash App (cashtag) import is retired. Historical off-app rows are in archive/cash-app-payments-*.csv. Tenants should pay in the portal (ACH, card, or Cash App Pay).',
    });
  }
  try {
    const dryRun = req.body?.dryRun === true;
    const newerThanDays = Number(req.body?.newerThanDays) || 400;
    const result = await syncCashAppFromGmail(req.user.id, req.user.role, {
      apply: !dryRun,
      newerThanDays,
    });

    const summary = {
      dryRun,
      paymentEmails: result.paymentCount,
      tenants: result.plan.tenants.map((t) => ({
        name: t.name,
        months: t.months.map((m) => ({
          period: m.periodLabel,
          amount: m.amount,
          parts: m.parts.length,
        })),
        partials: t.unallocated.length,
        depositCredits: (t.depositCredits || []).map((d) => ({
          amount: d.amount,
          date: d.dateIso,
          notes: d.notes,
        })),
      })),
      warnings: result.plan.warnings,
      unparsed: result.unparsed?.length || 0,
    };

    if (!dryRun) {
      summary.inserted = result.inserted;
      summary.synced = result.synced;
      summary.skipped = result.skipped;
      summary.cleared = result.cleared;
      summary.depositApplied = result.depositApplied;
      summary.depositResults = result.depositResults;
    }

    res.json(summary);
  } catch (err) {
    if (err.code === 'NOT_CONNECTED') {
      return res.status(400).json({ error: 'GMAIL_NOT_CONNECTED', message: err.message });
    }
    console.error('[payments/cashapp/sync-gmail]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// GET /api/payments/autopay — tenant autopay settings
router.get('/autopay', Guards.tenantOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id AS lease_id, l.autopay_enabled, l.autopay_bank_account_id
         FROM leases l
        WHERE l.tenant_id = $1 AND l.status = 'active'
        ORDER BY l.start_date DESC LIMIT 1`,
      [req.user.id]
    );
    if (!rows[0]) return res.json({ autopay: null });
    res.json({
      autopay: rows[0],
      benefits: {
        lateFeeExempt: true,
        utilityAutopay: true,
        summary: 'Autopay on = no rent late fees while enabled. Rent debits on the 1st; utility shares auto-debit after each bill dispute window.',
      },
    });
  } catch (err) {
    console.error('[payments/autopay GET]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// PATCH /api/payments/autopay — tenant enable/disable autopay
router.patch('/autopay', Guards.tenantOnly, async (req, res) => {
  const { enabled, bankAccountId } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled boolean required' });
  }
  try {
    const { rows: leaseRows } = await pool.query(
      `SELECT id FROM leases WHERE tenant_id = $1 AND status = 'active' ORDER BY start_date DESC LIMIT 1`,
      [req.user.id]
    );
    if (!leaseRows[0]) return res.status(404).json({ error: 'NO_ACTIVE_LEASE' });

    if (enabled) {
      if (!bankAccountId) {
        return res.status(400).json({ error: 'bankAccountId required when enabling autopay' });
      }
      const { rows: ba } = await pool.query(
        `SELECT id, status, link_status FROM bank_accounts WHERE id = $1 AND user_id = $2`,
        [bankAccountId, req.user.id]
      );
      if (!ba[0]) return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });
      if (ba[0].status !== 'verified') {
        return res.status(400).json({ error: 'ACCOUNT_NOT_VERIFIED' });
      }
      if (ba[0].link_status === 'needs_relink') {
        return res.status(400).json({
          error: 'ACCOUNT_NEEDS_RELINK',
          message: 'Reconnect your bank account before enabling autopay.',
        });
      }
    }

    const { rows } = await pool.query(
      `UPDATE leases
          SET autopay_enabled = $1,
              autopay_bank_account_id = CASE WHEN $1 THEN $2::uuid ELSE NULL END,
              updated_at = NOW()
        WHERE id = $3
        RETURNING id, autopay_enabled, autopay_bank_account_id`,
      [enabled, bankAccountId || null, leaseRows[0].id]
    );
    res.json({
      autopay: rows[0],
      message: enabled
        ? 'Automatic payments enabled — rent late fees are waived while autopay stays on.'
        : 'Automatic payments turned off — rent late fees apply after your grace period if rent is unpaid.',
    });
  } catch (err) {
    console.error('[payments/autopay PATCH]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/payments/late-fees/:id/waive — staff waive late fee
router.post('/late-fees/:id/waive', Guards.staffOnly, async (req, res) => {
  const { reason } = req.body;
  try {
    const propIds = await accessiblePropertyIds(req.user.id, req.user.role);
    const { rows } = await pool.query(
      `UPDATE late_fees lf
          SET status = 'waived', applied_at = NOW()
        FROM leases l
        JOIN units un ON un.id = l.unit_id
       WHERE lf.id = $1 AND lf.lease_id = l.id AND un.property_id = ANY($2)
         AND lf.status IN ('pending', 'applied')
       RETURNING lf.id, lf.amount, lf.lease_id, l.tenant_id`,
      [req.params.id, propIds]
    );
    if (!rows.length) return res.status(404).json({ error: 'Late fee not found or already waived/paid' });

    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, channel, related_entity_type, related_entity_id)
       VALUES ($1, 'late_fee_waived', $2, $3, 'in_app', 'late_fee', $4)`,
      [
        rows[0].tenant_id,
        'Late fee waived',
        reason || 'Your property manager waived a late fee on your account.',
        rows[0].id,
      ]
    );

    res.json({ lateFee: rows[0], message: 'Late fee waived.' });
  } catch (err) {
    console.error('[payments/late-fees/waive]', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
