/**
 * Manager site-visit monthly payroll — Plaid bank link + Stripe ACH / Cash App Pay payouts.
 * ACH: debit property operating account → manager Connect account.
 * Cash App Pay: owner confirms in Cash App → manager Connect account (no property bank required).
 */

const pool = require('../db/client');
const plaid = require('./plaid.service');
const stripe = require('./stripe.service');
const { encrypt, decrypt } = require('../utils/encryption');
const { resolveOrgIdForUser, formatNorfolkDateTime } = require('./site-visits.service');
const { norfolkYearMonth, norfolkMonthWindow } = require('../utils/norfolk-time');
const { getPropertyBank, bankSummary } = require('./property-bank.service');

const MANAGER_EMAIL = 'konstantinhazlett@yahoo.com';
const PAYMENT_METHODS = new Set(['manual', 'zelle', 'check', 'cash_app', 'ach', 'other']);
const STRIPE_OWNER_PAY_METHODS = new Set(['ach', 'cash_app']);

function buildAvailableOwnerPayMethods({
  connectPayoutReady,
  cashAppPayAvailable,
  propertyBankLinked,
}) {
  const methods = [];
  if (cashAppPayAvailable && connectPayoutReady) methods.push('cash_app');
  if (propertyBankLinked && connectPayoutReady) methods.push('ach');
  return methods;
}
const BANK_PURPOSE = 'manager_payout';

function wrapStripePayrollError(err) {
  const msg = err?.message || '';
  if (/signed up for Connect/i.test(msg)) {
    const e = new Error(
      'Stripe Connect is not enabled yet. In your live Stripe dashboard open Connect → Get started, ' +
      'complete platform setup, then retry Pay via ACH. dashboard.stripe.com/connect'
    );
    e.statusCode = 503;
    e.code = 'CONNECT_NOT_ENABLED';
    return e;
  }
  if (/insufficient_capabilities_for_transfer/i.test(msg)) {
    const e = new Error(
      'Manager Stripe payout setup is incomplete. Konstantin must finish Connect onboarding ' +
      'on his Boots on site page before ACH payroll can run.'
    );
    e.statusCode = 503;
    e.code = 'CONNECT_ONBOARDING_REQUIRED';
    return e;
  }
  return err;
}

function connectOnboardingUrls() {
  const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  return {
    returnUrl: `${origin}/manager/site-visits?connect=done`,
    refreshUrl: `${origin}/manager/site-visits?connect=refresh`,
  };
}

async function requireConnectTransfersReady(connectId) {
  const account = await stripe.retrieveConnectAccount(connectId);
  if (stripe.isConnectTransfersActive(account)) return account;

  const onboardingUrl = await stripe.createConnectAccountLink(
    connectId,
    connectOnboardingUrls()
  );
  const err = new Error(
    'Konstantin must complete Stripe payout setup before ACH payroll. ' +
    'Ask him to open the setup link on his Boots on site page (Payout bank account section).'
  );
  err.statusCode = 503;
  err.code = 'CONNECT_ONBOARDING_REQUIRED';
  err.onboardingUrl = onboardingUrl;
  throw err;
}

async function resolveOrgManager(orgId) {
  const { rows: byEmail } = await pool.query(
    `SELECT id, first_name, last_name, email
       FROM users
      WHERE org_id = $1 AND LOWER(email) = LOWER($2) AND role = 'property_manager'
      LIMIT 1`,
    [orgId, MANAGER_EMAIL]
  );
  if (byEmail.length) return byEmail[0];

  const { rows } = await pool.query(
    `SELECT id, first_name, last_name, email
       FROM users
      WHERE org_id = $1 AND role = 'property_manager'
      ORDER BY created_at ASC
      LIMIT 1`,
    [orgId]
  );
  return rows[0] ?? null;
}

function managerDisplayName(row) {
  if (!row) return null;
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email;
}

function monthLabel(year, month) {
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'America/New_York',
  });
}

function parseYearMonth(year, month) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    const err = new Error('year and month query params are required (month 1–12).');
    err.statusCode = 400;
    throw err;
  }
  return { year: y, month: m };
}

function payoutRowToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    managerId: row.manager_id,
    periodYear: row.period_year,
    periodMonth: row.period_month,
    periodLabel: monthLabel(row.period_year, row.period_month),
    amountCents: row.amount_cents,
    amountDollars: row.amount_cents / 100,
    visitCount: row.visit_count,
    status: row.status,
    paymentMethod: row.payment_method,
    bankAccountId: row.bank_account_id,
    paidBy: row.paid_by,
    paidAt: row.paid_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payerName: row.payer_name || null,
    bankInstitution: row.bank_institution || null,
    bankMask: row.bank_mask || null,
    stripePaymentIntentId: row.stripe_payment_intent_id || null,
    stripeChargeId: row.stripe_charge_id || null,
  };
}

function bankAccountToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    institutionName: row.institution_name,
    accountName: row.account_name,
    accountMask: row.account_mask,
    accountType: row.account_type,
    status: row.status,
    linkStatus: row.link_status,
    isDefault: row.is_default,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
}

async function loadPayableVisits(orgId, managerId, year, month) {
  const { start, end } = norfolkMonthWindow(year, month);
  const { rows } = await pool.query(
    `SELECT v.id, v.visited_at, v.amount_cents, v.completed_at,
            TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS manager_name
       FROM manager_site_visits v
       JOIN users m ON m.id = v.manager_id
      WHERE v.org_id = $1
        AND v.manager_id = $2
        AND v.status = 'completed'
        AND v.visited_at >= $3
        AND v.visited_at < $4
        AND (
          v.payout_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM manager_site_visit_payouts p
             WHERE p.id = v.payout_id AND p.status = 'paid'
          )
        )
      ORDER BY v.visited_at ASC`,
    [orgId, managerId, start, end]
  );
  return rows.map((r) => ({
    id: r.id,
    visitedAt: r.visited_at,
    visitedAtFormatted: formatNorfolkDateTime(r.visited_at),
    amountCents: r.amount_cents,
    amountDollars: r.amount_cents / 100,
    completedAt: r.completed_at,
  }));
}

async function loadPayoutForPeriod(orgId, managerId, year, month) {
  const { rows } = await pool.query(
    `SELECT p.*,
            TRIM(CONCAT(o.first_name, ' ', o.last_name)) AS payer_name,
            ba.institution_name AS bank_institution,
            ba.account_mask AS bank_mask
       FROM manager_site_visit_payouts p
       LEFT JOIN users o ON o.id = p.paid_by
       LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id
      WHERE p.org_id = $1
        AND p.manager_id = $2
        AND p.period_year = $3
        AND p.period_month = $4`,
    [orgId, managerId, year, month]
  );
  return payoutRowToJson(rows[0]);
}

async function listPayoutHistory(orgId, managerId, limit = 12) {
  const { rows } = await pool.query(
    `SELECT p.*,
            TRIM(CONCAT(o.first_name, ' ', o.last_name)) AS payer_name,
            ba.institution_name AS bank_institution,
            ba.account_mask AS bank_mask
       FROM manager_site_visit_payouts p
       LEFT JOIN users o ON o.id = p.paid_by
       LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id
      WHERE p.org_id = $1 AND p.manager_id = $2
      ORDER BY p.period_year DESC, p.period_month DESC, p.created_at DESC
      LIMIT $3`,
    [orgId, managerId, limit]
  );
  return rows.map(payoutRowToJson);
}

async function getManagerPayoutAccounts(managerId) {
  const { rows } = await pool.query(
    `SELECT id, institution_name, account_name, account_mask, account_type,
            status, link_status, is_default, verified_at, created_at
       FROM bank_accounts
      WHERE user_id = $1
        AND purpose = $2
        AND status <> 'revoked'
      ORDER BY is_default DESC, created_at DESC`,
    [managerId, BANK_PURPOSE]
  );
  return rows.map(bankAccountToJson);
}

async function getDefaultPayoutBank(managerId) {
  const { rows } = await pool.query(
    `SELECT id, institution_name, account_mask, status
       FROM bank_accounts
      WHERE user_id = $1
        AND purpose = $2
        AND status = 'verified'
      ORDER BY is_default DESC, created_at DESC
      LIMIT 1`,
    [managerId, BANK_PURPOSE]
  );
  return rows[0] ?? null;
}

async function getDefaultPayoutBankFull(managerId) {
  const { rows } = await pool.query(
    `SELECT *
       FROM bank_accounts
      WHERE user_id = $1
        AND purpose = $2
        AND status = 'verified'
      ORDER BY is_default DESC, created_at DESC
      LIMIT 1`,
    [managerId, BANK_PURPOSE]
  );
  return rows[0] ?? null;
}

async function getPropertyBankForAch(orgId) {
  const { rows } = await pool.query(
    `SELECT *
       FROM bank_accounts
      WHERE org_id = $1
        AND purpose = 'property_operating'
        AND status = 'verified'
        AND link_status = 'active'
      ORDER BY is_default DESC, created_at DESC
      LIMIT 1`,
    [orgId]
  );
  if (rows[0]) return rows[0];

  const { rows: stale } = await pool.query(
    `SELECT id FROM bank_accounts
      WHERE org_id = $1
        AND purpose = 'property_operating'
        AND status = 'verified'
        AND link_status = 'needs_relink'
      LIMIT 1`,
    [orgId]
  );
  if (stale[0]) {
    const err = new Error(
      'Property bank connection needs re-authentication. Go to Finance → Property account and reconnect via Plaid.'
    );
    err.statusCode = 400;
    err.code = 'PROPERTY_BANK_NEEDS_RELINK';
    throw err;
  }
  return null;
}

async function ensureManagerConnectAccount(bankRow, manager) {
  const displayName = managerDisplayName(manager) || manager.email;

  if (bankRow.stripe_connect_account_id) {
    await stripe.updateConnectAccountBusinessProfile(
      bankRow.stripe_connect_account_id,
      displayName
    ).catch(() => {});
    return bankRow.stripe_connect_account_id;
  }

  const accessToken = decrypt(bankRow.plaid_access_token_encrypted);
  const bankAccountToken = await plaid.createStripeBankAccountToken(
    accessToken,
    bankRow.plaid_account_id
  );
  let connectId;
  try {
    connectId = await stripe.createConnectExpressPayoutAccount({
      email: manager.email,
      userId: bankRow.user_id,
      bankAccountToken,
      firstName: manager.first_name,
      lastName: manager.last_name,
    });
  } catch (err) {
    throw wrapStripePayrollError(err);
  }

  await pool.query(
    `UPDATE bank_accounts SET stripe_connect_account_id = $1, updated_at = NOW() WHERE id = $2`,
    [connectId, bankRow.id]
  );

  return connectId;
}

function mapStripeStatus(piStatus) {
  if (piStatus === 'succeeded') return 'paid';
  if (piStatus === 'canceled') return 'failed';
  return 'processing';
}

function isCancellablePayrollIntent(pi) {
  if (!pi?.status) return false;
  return ['requires_action', 'requires_payment_method', 'requires_confirmation', 'canceled'].includes(pi.status);
}

function payrollProcessingDetails(pi) {
  if (!pi) return null;
  const verificationUrl = pi.next_action?.verify_with_microdeposits?.hosted_verification_url || null;
  return {
    stripeStatus: pi.status,
    canCancel: isCancellablePayrollIntent(pi),
    verificationUrl,
    failureReason: pi.last_payment_error?.message || null,
  };
}

async function releasePayrollAttempt(payoutId, paymentIntentId) {
  if (paymentIntentId) {
    const pi = await stripe.retrievePaymentIntent(paymentIntentId);
    if (pi.status !== 'canceled' && pi.status !== 'succeeded') {
      await stripe.cancelPaymentIntent(paymentIntentId);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE manager_site_visits SET payout_id = NULL, updated_at = NOW() WHERE payout_id = $1`,
      [payoutId]
    );
    await client.query(
      `DELETE FROM manager_site_visit_payouts WHERE id = $1 AND status IN ('processing', 'failed')`,
      [payoutId]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function cancelProcessingPayroll({ orgId, ownerId, year, month }) {
  const manager = await resolveOrgManager(orgId);
  if (!manager) {
    const err = new Error('No property manager found for this organization.');
    err.statusCode = 404;
    throw err;
  }

  const existing = await loadPayoutForPeriod(orgId, manager.id, year, month);
  if (!existing || existing.status !== 'processing') {
    const err = new Error(`No in-progress payroll for ${monthLabel(year, month)}.`);
    err.statusCode = 400;
    err.code = 'NOT_PROCESSING';
    throw err;
  }

  if (!existing.stripePaymentIntentId) {
    const err = new Error('This payroll is not tied to a Stripe payment and cannot be cancelled here.');
    err.statusCode = 400;
    err.code = 'NOT_CANCELLABLE';
    throw err;
  }

  const pi = await stripe.retrievePaymentIntent(existing.stripePaymentIntentId);
  if (!isCancellablePayrollIntent(pi)) {
    const err = new Error(
      pi.status === 'processing'
        ? 'ACH is already submitted to the bank — wait for settlement or microdeposit verification instead of cancelling.'
        : 'This payment can no longer be cancelled in the portal.'
    );
    err.statusCode = 409;
    err.code = 'NOT_CANCELLABLE';
    throw err;
  }

  await releasePayrollAttempt(existing.id, existing.stripePaymentIntentId);

  return getPayrollMonth({
    userId: ownerId,
    userRole: 'owner',
    year,
    month,
  });
}

async function getPayrollMonth({ userId, userRole, year, month }) {
  const orgId = await resolveOrgIdForUser(userId);
  if (!orgId) {
    const err = new Error('No organization found.');
    err.statusCode = 400;
    throw err;
  }

  let managerId;
  let managerRow;
  if (userRole === 'property_manager') {
    managerId = userId;
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, email FROM users WHERE id = $1`,
      [userId]
    );
    managerRow = rows[0];
  } else {
    managerRow = await resolveOrgManager(orgId);
    if (!managerRow) {
      return {
        year,
        month,
        monthLabel: monthLabel(year, month),
        manager: null,
        visits: [],
        visitCount: 0,
        totalCents: 0,
        alreadyPaid: false,
        payout: null,
        payoutBank: null,
        history: [],
      };
    }
    managerId = managerRow.id;
  }

  const visits = await loadPayableVisits(orgId, managerId, year, month);
  const totalCents = visits.reduce((sum, v) => sum + v.amountCents, 0);
  const payout = await loadPayoutForPeriod(orgId, managerId, year, month);
  const alreadyPaid = payout?.status === 'paid';
  const processing = payout?.status === 'processing';
  const payoutBankFull = await getDefaultPayoutBankFull(managerId);
  const payoutBankRow = payoutBankFull;
  const propertyBankRow = userRole !== 'property_manager'
    ? await getPropertyBank(orgId)
    : null;
  const history = userRole !== 'property_manager'
    ? await listPayoutHistory(orgId, managerId)
    : await listPayoutHistory(orgId, managerId, 6);

  const stripeContext = userRole !== 'property_manager'
    ? await getOwnerStripePayContext(orgId, payoutBankFull)
    : {
      connectPayoutReady: null,
      cashAppPayAvailable: false,
      stripePayReady: false,
      propertyBankLinked: false,
      paymentMethods: [],
    };

  let processingDetails = null;
  if (processing && payout?.stripePaymentIntentId && userRole !== 'property_manager') {
    try {
      const pi = await stripe.retrievePaymentIntent(payout.stripePaymentIntentId);
      processingDetails = payrollProcessingDetails(pi);
    } catch {
      processingDetails = null;
    }
  }

  const {
    connectPayoutReady,
    cashAppPayAvailable,
    stripePayReady,
    propertyBankLinked,
    paymentMethods,
  } = stripeContext;
  const canPay = !alreadyPaid
    && (!processing || processingDetails?.canCancel)
    && paymentMethods.length > 0;

  return {
    year,
    month,
    monthLabel: monthLabel(year, month),
    manager: {
      id: managerRow.id,
      name: managerDisplayName(managerRow),
      email: managerRow.email,
    },
    visits,
    visitCount: visits.length,
    totalCents,
    totalDollars: totalCents / 100,
    alreadyPaid,
    processing,
    payout,
    payoutBank: payoutBankRow
      ? {
          linked: true,
          institutionName: payoutBankRow.institution_name,
          accountMask: payoutBankRow.account_mask,
          status: payoutBankRow.status,
        }
      : { linked: false },
    propertyBank: bankSummary(propertyBankRow),
    connectPayoutReady,
    cashAppPayAvailable,
    stripePayReady,
    propertyBankLinked,
    canPay,
    processingDetails,
    history,
    paymentMethods,
  };
}

async function getOwnerStripePayContext(orgId, payoutBankFull) {
  const propertyBankRow = await getPropertyBank(orgId);
  let connectPayoutReady = false;
  if (payoutBankFull?.stripe_connect_account_id) {
    try {
      const account = await stripe.retrieveConnectAccount(payoutBankFull.stripe_connect_account_id);
      connectPayoutReady = stripe.isConnectTransfersActive(account);
    } catch {
      connectPayoutReady = false;
    }
  } else if (payoutBankFull) {
    connectPayoutReady = false;
  }

  const cashAppPayAvailable = stripe.isCashAppPayConfigured();
  const propertyBankLinked = !!propertyBankRow;
  return {
    connectPayoutReady,
    cashAppPayAvailable,
    stripePayReady: connectPayoutReady && cashAppPayAvailable,
    propertyBankLinked,
    paymentMethods: buildAvailableOwnerPayMethods({
      connectPayoutReady,
      cashAppPayAvailable,
      propertyBankLinked,
    }),
  };
}

async function linkManagerPayoutBank({ managerId, publicToken, accountId }) {
  if (!publicToken || !accountId) {
    const err = new Error('publicToken and accountId are required.');
    err.statusCode = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { accessToken, itemId } = await plaid.exchangePublicToken(publicToken);
    const details = await plaid.getAccountDetails(accessToken, accountId);
    const bankAccountToken = await plaid.createStripeBankAccountToken(accessToken, accountId);

    const { rows: [userRow] } = await client.query(
      'SELECT email, first_name, last_name FROM users WHERE id = $1',
      [managerId]
    );
    if (!userRow) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }

    const stripeCustomerId = await stripe.getOrCreateCustomer(managerId, userRow.email);
    let connectAccountId;
    try {
      connectAccountId = await stripe.createConnectExpressPayoutAccount({
        email: userRow.email,
        userId: managerId,
        bankAccountToken,
        firstName: userRow.first_name,
        lastName: userRow.last_name,
      });
    } catch (err) {
      throw wrapStripePayrollError(err);
    }
    const stripeBankAccount = await stripe.attachBankAccount(
      stripeCustomerId,
      await plaid.createStripeBankAccountToken(accessToken, accountId)
    );

    const { rows: existing } = await client.query(
      `SELECT id FROM bank_accounts
        WHERE user_id = $1 AND stripe_fingerprint = $2 AND purpose = $3 AND status <> 'revoked'`,
      [managerId, stripeBankAccount.fingerprint, BANK_PURPOSE]
    );
    if (existing.length > 0) {
      await client.query('ROLLBACK');
      const err = new Error('This bank account is already connected for payouts.');
      err.statusCode = 409;
      err.code = 'DUPLICATE_ACCOUNT';
      throw err;
    }

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*) AS cnt FROM bank_accounts
        WHERE user_id = $1 AND purpose = $2 AND status <> 'revoked'`,
      [managerId, BANK_PURPOSE]
    );
    const isDefault = parseInt(countRows[0].cnt, 10) === 0;

    const encryptedToken = encrypt(accessToken);
    const { rows: [newAccount] } = await client.query(
      `INSERT INTO bank_accounts
         (user_id, purpose, plaid_item_id, plaid_account_id, plaid_access_token_encrypted,
          institution_name, institution_id, account_name, account_mask, account_type,
          stripe_customer_id, stripe_bank_account_id, stripe_fingerprint,
          stripe_connect_account_id,
          status, link_status, is_default, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'verified','active',$15,NOW())
       RETURNING id, institution_name, account_name, account_mask, account_type,
                 status, is_default, verified_at, created_at`,
      [
        managerId, BANK_PURPOSE, itemId, accountId, encryptedToken,
        details.institutionName, details.institutionId,
        details.accountName, details.accountMask, details.accountType,
        stripeCustomerId, stripeBankAccount.id, stripeBankAccount.fingerprint,
        connectAccountId,
        isDefault,
      ]
    );

    await client.query('COMMIT');
    return bankAccountToJson(newAccount);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function removeManagerPayoutBank({ managerId, accountId }) {
  const { rows } = await pool.query(
    `SELECT stripe_customer_id, stripe_bank_account_id
       FROM bank_accounts
      WHERE id = $1 AND user_id = $2 AND purpose = $3 AND status <> 'revoked'`,
    [accountId, managerId, BANK_PURPOSE]
  );
  if (!rows[0]) {
    const err = new Error('Payout bank account not found.');
    err.statusCode = 404;
    throw err;
  }

  await stripe.stripe?.customers?.deleteSource?.(
    rows[0].stripe_customer_id,
    rows[0].stripe_bank_account_id
  ).catch(() => {});

  await pool.query(
    `UPDATE bank_accounts SET status = 'revoked', updated_at = NOW()
      WHERE id = $1 AND user_id = $2`,
    [accountId, managerId]
  );

  return { message: 'Payout bank account removed.' };
}

async function payManagerPayroll({
  orgId,
  ownerId,
  year,
  month,
  paymentMethod,
  note,
  ipAddress,
  userAgent,
}) {
  if (!PAYMENT_METHODS.has(paymentMethod)) {
    const err = new Error(`paymentMethod must be one of: ${[...PAYMENT_METHODS].join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  if (paymentMethod === 'cash_app') {
    const err = new Error('Use Cash App Pay on the payroll form — it opens your Cash App app to confirm.');
    err.statusCode = 400;
    err.code = 'USE_CASHAPP_INTENT';
    throw err;
  }

  if (!STRIPE_OWNER_PAY_METHODS.has(paymentMethod)) {
    const err = new Error('Pay through the portal with Cash App Pay or ACH. Off-app methods are not supported.');
    err.statusCode = 400;
    err.code = 'STRIPE_PAY_ONLY';
    throw err;
  }

  const manager = await resolveOrgManager(orgId);
  if (!manager) {
    const err = new Error('No property manager found for this organization.');
    err.statusCode = 404;
    throw err;
  }

  const existing = await loadPayoutForPeriod(orgId, manager.id, year, month);
  if (existing?.status === 'paid') {
    const err = new Error(`Payroll for ${monthLabel(year, month)} is already marked paid.`);
    err.statusCode = 409;
    err.code = 'ALREADY_PAID';
    throw err;
  }
  if (existing?.status === 'processing') {
    const err = new Error(`Payroll for ${monthLabel(year, month)} is already processing via ACH.`);
    err.statusCode = 409;
    err.code = 'ALREADY_PROCESSING';
    throw err;
  }

  const visits = await loadPayableVisits(orgId, manager.id, year, month);
  if (!visits.length) {
    const err = new Error(`No completed visits to pay for ${monthLabel(year, month)}.`);
    err.statusCode = 400;
    throw err;
  }

  const totalCents = visits.reduce((sum, v) => sum + v.amountCents, 0);
  const payoutBankFull = paymentMethod === 'ach'
    ? await getDefaultPayoutBankFull(manager.id)
    : await getDefaultPayoutBank(manager.id);
  const propertyBankRow = paymentMethod === 'ach' ? await getPropertyBankForAch(orgId) : null;
  const propertyBank = await getPropertyBank(orgId);

  if (paymentMethod === 'ach' && !payoutBankFull) {
    const err = new Error('Manager has no verified payout bank on file. Konstantin must link a bank under Boots on site first.');
    err.statusCode = 400;
    err.code = 'NO_PAYOUT_BANK';
    throw err;
  }

  if (paymentMethod === 'ach' && !propertyBankRow) {
    const err = new Error(
      'Link your property operating account first (Finance → Property account), then pay via ACH.'
    );
    err.statusCode = 400;
    err.code = 'NO_PROPERTY_BANK';
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const initialStatus = paymentMethod === 'ach' ? 'processing' : 'paid';
    const paidAt = paymentMethod === 'ach' ? null : new Date();

    const { rows: [payoutRow] } = await client.query(
      `INSERT INTO manager_site_visit_payouts
         (org_id, manager_id, period_year, period_month,
          amount_cents, visit_count, status, payment_method,
          bank_account_id, paid_by, paid_at, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        orgId,
        manager.id,
        year,
        month,
        totalCents,
        visits.length,
        initialStatus,
        paymentMethod,
        payoutBankFull?.id ?? null,
        ownerId,
        paidAt,
        note?.trim() || null,
      ]
    );

    const visitIds = visits.map((v) => v.id);
    await client.query(
      `UPDATE manager_site_visits
          SET payout_id = $1, updated_at = NOW()
        WHERE id = ANY($2::uuid[])`,
      [payoutRow.id, visitIds]
    );

    let paymentIntent = null;
    if (paymentMethod === 'ach') {
      const connectId = await ensureManagerConnectAccount(payoutBankFull, manager);
      await requireConnectTransfersReady(connectId);
      const accessToken = decrypt(propertyBankRow.plaid_access_token_encrypted);
      const { routing, account: acctNum } = await plaid.getAchAccountNumbers(
        accessToken,
        propertyBankRow.plaid_account_id
      );

      const { rows: [ownerRow] } = await client.query(
        `SELECT first_name, last_name, email FROM users WHERE id = $1`,
        [ownerId]
      );
      const holderName = [ownerRow?.first_name, ownerRow?.last_name].filter(Boolean).join(' ')
        || ownerRow?.email
        || 'Property operating account';

      try {
        paymentIntent = await stripe.chargeACH({
          amountCents: totalCents,
          customerId: propertyBankRow.stripe_customer_id,
          routingNumber: routing,
          accountNumber: acctNum,
          accountHolderName: holderName,
          description: `Site visit payroll — ${monthLabel(year, month)}`,
          metadata: {
            payment_type: 'manager_site_visit_payroll',
            payout_id: payoutRow.id,
            org_id: orgId,
            manager_id: manager.id,
          },
          transferDestination: connectId,
          ipAddress: ipAddress || '',
          userAgent: userAgent || 'property-manager-payroll',
        });
      } catch (err) {
        throw wrapStripePayrollError(err);
      }

      const localStatus = mapStripeStatus(paymentIntent.status);
      const chargeId = typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id ?? null;

      const { rows: [updatedPayout] } = await client.query(
        `UPDATE manager_site_visit_payouts
            SET status = $1::site_visit_payout_status,
                stripe_payment_intent_id = $2,
                stripe_charge_id = $3,
                paid_at = CASE WHEN $1::text = 'paid' THEN NOW() ELSE paid_at END,
                updated_at = NOW()
          WHERE id = $4
         RETURNING *`,
        [localStatus, paymentIntent.id, chargeId, payoutRow.id]
      );
      Object.assign(payoutRow, updatedPayout);
    }

    await client.query('COMMIT');
    return payoutRowToJson({
      ...payoutRow,
      payer_name: null,
      bank_institution: payoutBankFull?.institution_name ?? null,
      bank_mask: payoutBankFull?.account_mask ?? null,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      const err = new Error(`Payroll for ${monthLabel(year, month)} is already recorded.`);
      err.statusCode = 409;
      err.code = 'ALREADY_PAID';
      throw err;
    }
    throw e;
  } finally {
    client.release();
  }
}

async function getManagerConnectOnboardingUrl(managerId) {
  const bankRow = await getDefaultPayoutBankFull(managerId);
  if (!bankRow) {
    const err = new Error('Link a payout bank first.');
    err.statusCode = 400;
    err.code = 'NO_PAYOUT_BANK';
    throw err;
  }

  if (!bankRow.stripe_connect_account_id) {
    const err = new Error('Stripe Connect account not found. Re-link your payout bank.');
    err.statusCode = 400;
    err.code = 'NO_CONNECT_ACCOUNT';
    throw err;
  }

  const { rows: [userRow] } = await pool.query(
    'SELECT first_name, last_name, email FROM users WHERE id = $1',
    [managerId]
  );
  const displayName = managerDisplayName(userRow) || userRow.email;
  await stripe.updateConnectAccountBusinessProfile(
    bankRow.stripe_connect_account_id,
    displayName
  ).catch(() => {});

  const account = await stripe.retrieveConnectAccount(bankRow.stripe_connect_account_id);
  if (stripe.isConnectTransfersActive(account)) {
    return { ready: true, onboardingUrl: null };
  }

  const onboardingUrl = await stripe.createConnectAccountLink(
    bankRow.stripe_connect_account_id,
    connectOnboardingUrls()
  );
  return { ready: false, onboardingUrl };
}

async function startCashAppPayroll({
  orgId,
  ownerId,
  year,
  month,
  note,
}) {
  if (!stripe.isCashAppPayConfigured()) {
    const err = new Error(
      'Cash App Pay is not configured. Enable it in Stripe Dashboard → Settings → Payment methods.'
    );
    err.statusCode = 503;
    err.code = 'CASHAPP_NOT_CONFIGURED';
    throw err;
  }

  const manager = await resolveOrgManager(orgId);
  if (!manager) {
    const err = new Error('No property manager found for this organization.');
    err.statusCode = 404;
    throw err;
  }

  const existing = await loadPayoutForPeriod(orgId, manager.id, year, month);
  if (existing?.status === 'paid') {
    const err = new Error(`Payroll for ${monthLabel(year, month)} is already marked paid.`);
    err.statusCode = 409;
    err.code = 'ALREADY_PAID';
    throw err;
  }
  if (existing?.status === 'processing') {
    if (existing.stripePaymentIntentId) {
      const pi = await stripe.retrievePaymentIntent(existing.stripePaymentIntentId);
      if (isCancellablePayrollIntent(pi)) {
        await releasePayrollAttempt(existing.id, existing.stripePaymentIntentId);
      } else {
        const err = new Error(
          existing.paymentMethod === 'ach' && pi.status === 'requires_action'
            ? `Payroll for ${monthLabel(year, month)} is waiting on property-bank verification. Cancel it on the payroll page to pay via Cash App Pay instead.`
            : `Payroll for ${monthLabel(year, month)} is already processing via ${existing.paymentMethod}.`
        );
        err.statusCode = 409;
        err.code = 'ALREADY_PROCESSING';
        throw err;
      }
    } else {
      const err = new Error(`Payroll for ${monthLabel(year, month)} is already processing.`);
      err.statusCode = 409;
      err.code = 'ALREADY_PROCESSING';
      throw err;
    }
  }

  const visits = await loadPayableVisits(orgId, manager.id, year, month);
  if (!visits.length) {
    const err = new Error(`No completed visits to pay for ${monthLabel(year, month)}.`);
    err.statusCode = 400;
    throw err;
  }

  const payoutBankFull = await getDefaultPayoutBankFull(manager.id);
  if (!payoutBankFull) {
    const err = new Error('Manager has no verified payout bank on file. Konstantin must link a bank under Boots on site first.');
    err.statusCode = 400;
    err.code = 'NO_PAYOUT_BANK';
    throw err;
  }

  const totalCents = visits.reduce((sum, v) => sum + v.amountCents, 0);
  const connectId = await ensureManagerConnectAccount(payoutBankFull, manager);
  await requireConnectTransfersReady(connectId);

  const { rows: [ownerRow] } = await pool.query(
    `SELECT first_name, last_name, email FROM users WHERE id = $1`,
    [ownerId]
  );
  const customerId = await stripe.getOrCreateCustomer(ownerId, ownerRow.email);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [payoutRow] } = await client.query(
      `INSERT INTO manager_site_visit_payouts
         (org_id, manager_id, period_year, period_month,
          amount_cents, visit_count, status, payment_method,
          bank_account_id, paid_by, note)
       VALUES ($1,$2,$3,$4,$5,$6,'processing','cash_app',$7,$8,$9)
       RETURNING *`,
      [
        orgId,
        manager.id,
        year,
        month,
        totalCents,
        visits.length,
        payoutBankFull.id,
        ownerId,
        note?.trim() || null,
      ]
    );

    const visitIds = visits.map((v) => v.id);
    await client.query(
      `UPDATE manager_site_visits
          SET payout_id = $1, updated_at = NOW()
        WHERE id = ANY($2::uuid[])`,
      [payoutRow.id, visitIds]
    );

    let paymentIntent;
    try {
      paymentIntent = await stripe.createCashAppPaymentIntent({
        amountCents: totalCents,
        customerId,
        description: `Site visit payroll — ${monthLabel(year, month)}`,
        metadata: {
          payment_type: 'manager_site_visit_payroll',
          payout_id: payoutRow.id,
          org_id: orgId,
          manager_id: manager.id,
          payment_method: 'cash_app',
        },
        transferDestination: connectId,
      });
    } catch (err) {
      throw wrapStripePayrollError(err);
    }

    await client.query(
      `UPDATE manager_site_visit_payouts
          SET stripe_payment_intent_id = $1, updated_at = NOW()
        WHERE id = $2`,
      [paymentIntent.id, payoutRow.id]
    );

    await client.query('COMMIT');

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      payoutId: payoutRow.id,
      amountCents: totalCents,
      publishableKey: stripe.getPublishableKey(),
    };
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      const err = new Error(`Payroll for ${monthLabel(year, month)} is already recorded.`);
      err.statusCode = 409;
      err.code = 'ALREADY_PAID';
      throw err;
    }
    throw e;
  } finally {
    client.release();
  }
}

async function syncCashAppPayroll({ orgId, ownerId, paymentIntentId }) {
  if (!paymentIntentId) {
    const err = new Error('payment_intent is required.');
    err.statusCode = 400;
    throw err;
  }

  const pi = await stripe.retrievePaymentIntent(paymentIntentId);
  if (pi.metadata?.payment_type !== 'manager_site_visit_payroll') {
    const err = new Error('Not a site-visit payroll payment.');
    err.statusCode = 400;
    throw err;
  }
  if (pi.metadata?.org_id && String(pi.metadata.org_id) !== String(orgId)) {
    const err = new Error('Payment does not belong to this organization.');
    err.statusCode = 403;
    throw err;
  }

  const { rows: [payoutRow] } = await pool.query(
    `SELECT * FROM manager_site_visit_payouts
      WHERE stripe_payment_intent_id = $1 AND org_id = $2`,
    [paymentIntentId, orgId]
  );
  if (!payoutRow) {
    const err = new Error('Payroll record not found for this payment.');
    err.statusCode = 404;
    throw err;
  }
  if (payoutRow.paid_by !== ownerId) {
    const err = new Error('Access denied.');
    err.statusCode = 403;
    throw err;
  }

  const localStatus = mapStripeStatus(pi.status);
  const chargeId = typeof pi.latest_charge === 'string'
    ? pi.latest_charge
    : pi.latest_charge?.id ?? null;

  if (localStatus !== payoutRow.status) {
    await pool.query(
      `UPDATE manager_site_visit_payouts
          SET status = $1::site_visit_payout_status,
              stripe_charge_id = COALESCE($2, stripe_charge_id),
              paid_at = CASE WHEN $1::text = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
              updated_at = NOW()
        WHERE id = $3`,
      [localStatus, chargeId, payoutRow.id]
    );
  }

  const payroll = await getPayrollMonth({
    userId: ownerId,
    userRole: 'owner',
    year: payoutRow.period_year,
    month: payoutRow.period_month,
  });

  return {
    status: localStatus,
    paymentIntentStatus: pi.status,
    failureReason: pi.last_payment_error?.message || null,
    payroll,
  };
}

module.exports = {
  PAYMENT_METHODS,
  STRIPE_OWNER_PAY_METHODS,
  buildAvailableOwnerPayMethods,
  getOwnerStripePayContext,
  parseYearMonth,
  norfolkYearMonth,
  getPayrollMonth,
  getManagerPayoutAccounts,
  linkManagerPayoutBank,
  removeManagerPayoutBank,
  payManagerPayroll,
  cancelProcessingPayroll,
  startCashAppPayroll,
  syncCashAppPayroll,
  getManagerConnectOnboardingUrl,
  listPayoutHistory,
  ensureManagerConnectAccount,
  requireConnectTransfersReady,
  getDefaultPayoutBankFull,
  getPropertyBankForAch,
  wrapStripePayrollError,
};
