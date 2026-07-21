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
 *   POST /api/payments/cashapp/create-intent   — tenant: start Cash App Pay rent payment
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
const { markLateFeesPaidForLease, settleSuccessfulRentPayment } = require('../utils/payment-settlement');
const { getRentStatusRoster } = require('../services/rent-status.service');
const { syncCashAppFromGmail } = require('../services/cashapp-gmail.service');
const { runPaymentsHealth } = require('../services/payments-health.service');
const { prepareTenantCharge } = require('../services/rent-charge.service');
const { partnerErrorMessage } = require('../utils/plaid-errors');
const { assertAchDebitAllowed } = require('../services/plaid-ach-guard.service');
const {
  createUpdateLinkTokenForAccount,
  completePlaidLinkUpdate,
} = require('../services/plaid-bank-link.service');

const MANUAL_METHODS = new Set(['cash_app', 'check', 'zelle', 'venmo', 'wire', 'cash', 'other']);

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
      message: partnerErrorMessage(err, 'Could not create Plaid Link token. Check PLAID_REDIRECT_URI is https://www.monterorentals.com/oauth-return in Railway and Plaid Dashboard.'),
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
      message: partnerErrorMessage(err, 'Could not create Plaid update token.'),
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
      'SELECT email FROM users WHERE id = $1', [req.user.id]
    );

    const stripeCustomerId = await stripe.getOrCreateCustomer(req.user.id, userRow.email);

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
// Returns the tenant's current open lease, rent due, and any pending late fees
// ─────────────────────────────────────────────────────────────────────────────
router.get('/balance', Guards.tenantOnly, async (req, res) => {
  try {
    // Active lease for this tenant
    const { rows: leaseRows } = await pool.query(
      `SELECT l.id AS lease_id, l.monthly_rent, l.grace_period_days,
              u.unit_number, p.name AS property_name,
              p.address_line1, p.city, p.state
         FROM leases l
         JOIN units      u ON u.id = l.unit_id
         JOIN properties p ON p.id = u.property_id
        WHERE l.tenant_id = $1 AND l.status = 'active'
        LIMIT 1`,
      [req.user.id]
    );
    if (!leaseRows[0]) return res.json({ balance: null, lease: null });

    const lease = leaseRows[0];

    // Pending rent payment for current month
    const now       = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString().split('T')[0];

    const { rows: paymentRows } = await pool.query(
      `SELECT id, amount, status, due_date, period_start, period_end
         FROM payments
        WHERE lease_id = $1
          AND payment_type = 'rent'
          AND status IN ('pending','processing')
          AND period_start = $2
        ORDER BY created_at DESC LIMIT 1`,
      [lease.lease_id, monthStart]
    );

    // Pending late fees
    const { rows: lateFeeRows } = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM late_fees
        WHERE lease_id = $1 AND status IN ('pending','applied')`,
      [lease.lease_id]
    );

    const defaultDueDate = monthStart;

    const { rows: depositRows } = await pool.query(
      `SELECT id, amount, status, due_date, period_start, period_end
         FROM payments
        WHERE lease_id = $1
          AND payment_type = 'security_deposit'
          AND status IN ('pending','processing')
        ORDER BY due_date ASC
        LIMIT 1`,
      [lease.lease_id]
    );

    const securityDepositPayment = depositRows[0]
      ? { ...depositRows[0], amount: parseFloat(depositRows[0].amount) }
      : null;

    res.json({
      lease: {
        id:           lease.lease_id,
        unit:         `${lease.property_name} — Unit ${lease.unit_number}`,
        address:      `${lease.address_line1}, ${lease.city}, ${lease.state}`,
        monthlyRent:  parseFloat(lease.monthly_rent),
        gracePeriod:  lease.grace_period_days,
        nextDueDate:  paymentRows[0]?.due_date ?? defaultDueDate,
      },
      currentPayment: paymentRows[0] ?? null,
      securityDepositPayment,
      lateFeeBalance: parseFloat(lateFeeRows[0]?.total ?? 0),
      totalDue: parseFloat(lease.monthly_rent) + parseFloat(lateFeeRows[0]?.total ?? 0),
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
  const { bankAccountId, leaseId, paymentType = 'rent' } = req.body;

  if (!bankAccountId || !leaseId) {
    return res.status(400).json({ error: 'MISSING_PARAMS' });
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

    // 2. Verify the lease belongs to this tenant
    const { rows: leaseRows } = await client.query(
      `SELECT id, monthly_rent, tenant_id FROM leases
        WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [leaseId, req.user.id]
    );
    const lease = leaseRows[0];
    if (!lease) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'LEASE_NOT_FOUND' });
    }

    // 3. Idempotency: block duplicate payment for same month
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString().split('T')[0];

    let amountDollars;
    let amountCents;
    let description;
    let chargeMeta = {};
    let payment;
    let pendingPaymentId = null;

    if (paymentType === 'security_deposit') {
      const { rows: depRows } = await client.query(
        `SELECT id, amount, period_start, period_end, due_date
           FROM payments
          WHERE lease_id = $1 AND payment_type = 'security_deposit'
            AND status = 'pending'
          ORDER BY due_date ASC
          LIMIT 1
          FOR UPDATE`,
        [leaseId]
      );
      if (!depRows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'NO_DEPOSIT_DUE',
          message: 'No pending security deposit on file.',
        });
      }
      amountDollars = parseFloat(depRows[0].amount);
      amountCents = Math.round(amountDollars * 100);
      description = 'Security deposit';
      chargeMeta = { payment_kind: 'security_deposit' };
      pendingPaymentId = depRows[0].id;
      payment = { id: depRows[0].id };
    } else {
      if (paymentType === 'rent') {
        const { rows: inFlight } = await client.query(
          `SELECT id FROM payments
            WHERE lease_id = $1 AND payment_type = 'rent'
              AND period_start = $2 AND status IN ('processing','succeeded')`,
          [leaseId, monthStart]
        );
        if (inFlight.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error:   'DUPLICATE_PAYMENT',
            message: 'A payment for this period is already in progress or complete.',
          });
        }
      }

      const { rentAmount, lateFeeAmount, totalAmount } =
        await rentBilling.computeChargeBreakdown(client, leaseId);
      amountDollars = totalAmount;
      amountCents = Math.round(amountDollars * 100);

      const dueDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        .toISOString().split('T')[0];
      const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      description = lateFeeAmount > 0
        ? `Rent + late fees — ${monthLabel}`
        : `Rent — ${monthLabel}`;

      chargeMeta = {
        rent_amount: rentAmount.toFixed(2),
        late_fee_amount: lateFeeAmount.toFixed(2),
      };

      const { rows: pendingRows } = await client.query(
        `SELECT id FROM payments
          WHERE lease_id = $1 AND payment_type = 'rent'
            AND period_start = $2 AND status = 'pending'
          FOR UPDATE`,
        [leaseId, monthStart]
      );

      if (pendingRows[0]) {
        const { rows: [updated] } = await client.query(
          `UPDATE payments
              SET amount = $1, bank_account_id = $2,
                  metadata = $3, updated_at = NOW()
            WHERE id = $4
           RETURNING id`,
          [amountDollars, bankAccountId, JSON.stringify(chargeMeta), pendingRows[0].id]
        );
        payment = updated;
      } else {
        const { rows: [inserted] } = await client.query(
          `INSERT INTO payments
             (lease_id, tenant_id, bank_account_id, amount, currency,
              status, payment_type, period_start, period_end, due_date, metadata)
           VALUES ($1,$2,$3,$4,'USD','pending',$5,$6,$7,$8,$9)
           RETURNING id`,
          [
            leaseId, req.user.id, bankAccountId, amountDollars,
            paymentType, monthStart, monthEnd, dueDate.toISOString().split('T')[0],
            JSON.stringify(chargeMeta),
          ]
        );
        payment = inserted;
      }
    }

    if (paymentType === 'security_deposit' && pendingPaymentId) {
      await client.query(
        `UPDATE payments
            SET amount = $1, bank_account_id = $2, metadata = $3, updated_at = NOW()
          WHERE id = $4`,
        [amountDollars, bankAccountId, JSON.stringify(chargeMeta), pendingPaymentId]
      );
    }

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

    const paymentIntent = await stripe.chargeACH({
      amountCents,
      customerId:        account.stripe_customer_id,
      routingNumber:     routing,
      accountNumber:     acctNum,
      accountHolderName: holderName,
      description,
      metadata: {
        payment_id: payment.id,
        lease_id:   leaseId,
        tenant_id:  req.user.id,
        ...chargeMeta,
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
      await markLateFeesPaidForLease(client, leaseId);
    }

    await client.query('COMMIT');

    if (localStatus === 'succeeded') {
      settleSuccessfulRentPayment(pool, {
        paymentId: payment.id,
        tenantId: req.user.id,
        leaseId,
        amount: amountDollars,
        paymentType,
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
// POST /api/payments/cashapp/create-intent — tenant: Cash App Pay for rent
// Body: { leaseId, paymentType?: 'rent' }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/cashapp/create-intent', Guards.tenantOnly, async (req, res) => {
  if (blockManagerPaymentAccess(req, res)) return;

  if (!stripe.isCashAppPayConfigured()) {
    return res.status(503).json({
      error: 'CASHAPP_NOT_CONFIGURED',
      message: 'Cash App Pay is not configured. Add STRIPE_PUBLISHABLE_KEY and enable Cash App Pay in Stripe.',
    });
  }

  const { leaseId, paymentType = 'rent' } = req.body;
  if (!leaseId) return res.status(400).json({ error: 'MISSING_PARAMS' });
  if (paymentType !== 'rent') {
    return res.status(400).json({
      error: 'UNSUPPORTED_TYPE',
      message: 'Cash App Pay is available for rent only.',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prep = await prepareTenantCharge(client, {
      tenantId: req.user.id,
      leaseId,
      paymentType,
      bankAccountId: null,
      metadataExtra: {
        payment_method: 'cash_app',
        source: 'stripe_cashapp',
      },
    });

    const { rows: [userRow] } = await client.query(
      `SELECT first_name, last_name, email FROM users WHERE id = $1`,
      [req.user.id]
    );
    const customerId = await stripe.getOrCreateCustomer(req.user.id, userRow.email);

    const paymentIntent = await stripe.createCashAppPaymentIntent({
      amountCents: prep.amountCents,
      customerId,
      description: prep.description,
      metadata: {
        payment_id: prep.payment.id,
        lease_id: leaseId,
        tenant_id: req.user.id,
        payment_type: paymentType,
        ...prep.chargeMeta,
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
        }),
        prep.payment.id,
      ]
    );

    await client.query('COMMIT');

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentId: prep.payment.id,
      amount: prep.amountDollars,
      publishableKey: stripe.getPublishableKey(),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === 'LEASE_NOT_FOUND') {
      return res.status(404).json({ error: 'LEASE_NOT_FOUND' });
    }
    if (err.code === 'DUPLICATE_PAYMENT') {
      return res.status(409).json({ error: 'DUPLICATE_PAYMENT', message: err.message });
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
// GET /api/payments/cashapp/sync?payment_intent=pi_xxx — after Cash App redirect
// ─────────────────────────────────────────────────────────────────────────────
router.get('/cashapp/sync', Guards.tenantOnly, async (req, res) => {
  const paymentIntentId = req.query.payment_intent;
  if (!paymentIntentId) return res.status(400).json({ error: 'MISSING_PARAMS' });

  try {
    const { rows } = await pool.query(
      `SELECT id, status, amount, payment_type, lease_id, tenant_id, failure_reason
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
      const { rowCount } = await pool.query(
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
      if (rowCount) {
        status = 'succeeded';
        await settleSuccessfulRentPayment(pool, {
          paymentId: payment.id,
          tenantId: payment.tenant_id,
          leaseId: payment.lease_id,
          amount: parseFloat(payment.amount),
          paymentType: payment.payment_type,
        });
      } else {
        status = 'succeeded';
      }
    } else if (pi.status === 'processing' && status === 'pending') {
      await pool.query(
        `UPDATE payments SET status = 'processing', updated_at = NOW() WHERE id = $1`,
        [payment.id]
      );
      status = 'processing';
    } else if (
      pi.status === 'canceled'
      || pi.last_payment_error
      || pi.status === 'requires_payment_method'
    ) {
      failureReason = pi.last_payment_error?.message || 'Cash App payment was not completed.';
      await pool.query(
        `UPDATE payments
            SET status = 'failed', failure_reason = $1, updated_at = NOW()
          WHERE id = $2`,
        [failureReason, payment.id]
      );
      status = 'failed';
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

    let conditions = ['un.property_id = ANY($1)', ledgerPaymentWhere('p')];
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
         WHERE un.property_id = ANY($1)`,
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

// POST /api/payments/cashapp/sync-gmail — staff: import Cash App rent from org Gmail
router.post('/cashapp/sync-gmail', Guards.staffOnly, async (req, res) => {
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
