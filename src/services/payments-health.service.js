/**
 * Payments stack health checks — Stripe, Plaid, webhooks, env parity, tenant readiness.
 * Run via GET /api/payments/health (staff) or `npm run payments:health`.
 */

const pool = require('../db/client');
const stripe = require('./stripe.service');
const plaid = require('./plaid.service');

const PROPERTY_MATCH = '%743%';

function check(id, category, status, message, extra = {}) {
  return { id, category, status, message, ...extra };
}

function stripeKeyMode(key = '') {
  if (key.startsWith('sk_live_') || key.startsWith('pk_live_')) return 'live';
  if (key.startsWith('sk_test_') || key.startsWith('pk_test_')) return 'test';
  return 'unknown';
}

function expectedWebhookUrls() {
  const urls = new Set(stripe.PRODUCTION_WEBHOOK_URLS);

  const origin = (process.env.CLIENT_ORIGIN || '').replace(/\/$/, '');
  if (origin && !/localhost|127\.0\.0\.1/i.test(origin)) {
    try {
      const u = new URL(origin.startsWith('http') ? origin : `https://${origin}`);
      u.protocol = 'https:';
      const bare = u.hostname.replace(/^www\./, '');
      const withWww = bare.startsWith('www.') ? bare : `www.${bare}`;
      urls.add(`${u.protocol}//${withWww}/webhooks/stripe`);
      urls.add(`${u.protocol}//${bare}/webhooks/stripe`);
    } catch {
      // ignore malformed CLIENT_ORIGIN
    }
  }

  return [...urls];
}

function expectedWebhookUrl() {
  return expectedWebhookUrls()[0];
}

function checkEnv(checks) {
  const isProd = process.env.NODE_ENV === 'production';
  const sk = process.env.STRIPE_SECRET_KEY || '';
  const pk = process.env.STRIPE_PUBLISHABLE_KEY || process.env.VITE_STRIPE_PUBLISHABLE_KEY || '';
  const skMode = stripeKeyMode(sk);
  const pkMode = stripeKeyMode(pk);
  const plaidEnv = (process.env.PLAID_ENV || 'sandbox').toLowerCase();

  if (!sk) {
    checks.push(check('env.stripe_secret', 'env', 'fail', 'STRIPE_SECRET_KEY is not set'));
  } else if (skMode === 'unknown') {
    checks.push(check('env.stripe_secret', 'env', 'fail', 'STRIPE_SECRET_KEY format invalid (expected sk_test_ or sk_live_)'));
  } else {
    checks.push(check('env.stripe_secret', 'env', 'pass', `Stripe secret key present (${skMode})`));
  }

  if (!pk) {
    checks.push(check('env.stripe_publishable', 'env', 'fail', 'STRIPE_PUBLISHABLE_KEY is not set (required for Cash App Pay in tenant portal)'));
  } else if (pkMode === 'unknown') {
    checks.push(check('env.stripe_publishable', 'env', 'fail', 'STRIPE_PUBLISHABLE_KEY format invalid'));
  } else if (skMode !== 'unknown' && pkMode !== skMode) {
    checks.push(check('env.stripe_mode_match', 'env', 'fail', `Stripe key mode mismatch: secret=${skMode}, publishable=${pkMode}`));
  } else {
    checks.push(check('env.stripe_publishable', 'env', 'pass', `Stripe publishable key present (${pkMode})`));
  }

  const apiPk = stripe.getPublishableKey();
  if (!apiPk) {
    checks.push(check(
      'env.stripe_publishable_api',
      'env',
      'fail',
      'GET /api/payments/stripe-config would return empty publishableKey — Cash App Pay blocked',
      { fix: 'Set STRIPE_PUBLISHABLE_KEY in Railway + .env.local' }
    ));
  } else if (apiPk !== pk) {
    checks.push(check('env.stripe_publishable_api', 'env', 'warn', 'Publishable key resolved differently than env (check VITE_STRIPE_PUBLISHABLE_KEY override)'));
  } else {
    checks.push(check(
      'env.stripe_publishable_api',
      'env',
      'pass',
      'Publishable key exposed to tenant portal via GET /api/payments/stripe-config'
    ));
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    checks.push(check('env.stripe_webhook_secret', 'env', 'fail', 'STRIPE_WEBHOOK_SECRET is not set'));
  } else if (!process.env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) {
    checks.push(check('env.stripe_webhook_secret', 'env', 'warn', 'STRIPE_WEBHOOK_SECRET does not look like whsec_…'));
  } else {
    checks.push(check('env.stripe_webhook_secret', 'env', 'pass', 'Stripe webhook secret configured'));
  }

  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    checks.push(check('env.plaid', 'env', 'fail', 'PLAID_CLIENT_ID or PLAID_SECRET missing'));
  } else {
    checks.push(check('env.plaid', 'env', 'pass', `Plaid credentials present (${plaidEnv})`));
  }

  if (isProd && skMode === 'test') {
    checks.push(check('env.prod_stripe_live', 'env', 'fail', 'Production NODE_ENV but Stripe test keys — live payments will not work'));
  }
  if (isProd && plaidEnv !== 'production') {
    checks.push(check('env.prod_plaid', 'env', 'fail', 'Production NODE_ENV but PLAID_ENV is not production — tenant bank linking will fail for real banks'));
  }
  if (isProd && skMode === 'live' && plaidEnv === 'production') {
    checks.push(check('env.prod_parity', 'env', 'pass', 'Production Stripe + Plaid env parity OK'));
  }

  const redirect = plaid.getPlaidRedirectUri();
  if (plaidEnv === 'production') {
    if (!redirect) {
      checks.push(check('env.plaid_redirect', 'env', 'fail', 'PLAID_REDIRECT_URI required in production (OAuth banks). Set to https://www.monterorentals.com/oauth-return'));
    } else if (!redirect.startsWith('https://')) {
      checks.push(check('env.plaid_redirect', 'env', 'fail', `PLAID_REDIRECT_URI must be HTTPS in production: ${redirect}`));
    } else {
      checks.push(check('env.plaid_redirect', 'env', 'pass', `Plaid redirect URI: ${redirect}`));
    }
  } else if (redirect) {
    checks.push(check('env.plaid_redirect', 'env', 'pass', `Plaid redirect URI: ${redirect}`));
  }

  try {
    if (!process.env.ENCRYPTION_KEY) {
      checks.push(check('env.encryption', 'env', 'fail', 'ENCRYPTION_KEY missing — cannot store Plaid tokens'));
    } else {
      const key = Buffer.from(process.env.ENCRYPTION_KEY, 'base64');
      if (key.length !== 32) {
        checks.push(check('env.encryption', 'env', 'fail', 'ENCRYPTION_KEY must decode to 32 bytes'));
      } else {
        checks.push(check('env.encryption', 'env', 'pass', 'ENCRYPTION_KEY valid for Plaid token storage'));
      }
    }
  } catch {
    checks.push(check('env.encryption', 'env', 'fail', 'ENCRYPTION_KEY invalid base64'));
  }

  if (process.env.RENT_BILLING_ENABLED === 'false') {
    checks.push(check('env.rent_billing', 'env', 'warn', 'RENT_BILLING_ENABLED=false — daily invoices/autopay scheduler is off'));
  } else {
    checks.push(check('env.rent_billing', 'env', 'pass', `Rent billing scheduler on (hour ${process.env.RENT_BILLING_HOUR ?? 8})`));
  }
}

async function checkStripeApi(checks) {
  if (!process.env.STRIPE_SECRET_KEY) return;

  try {
    const account = await stripe.retrieveAccountSummary();
    if (!account.chargesEnabled) {
      checks.push(check('stripe.charges', 'stripe', 'fail', 'Stripe account charges_enabled is false'));
    } else {
      checks.push(check('stripe.charges', 'stripe', 'pass', `Stripe account ${account.id} — charges enabled`));
    }
    if (!account.payoutsEnabled) {
      checks.push(check('stripe.payouts', 'stripe', 'warn', 'Stripe payouts_enabled is false'));
    } else {
      checks.push(check('stripe.payouts', 'stripe', 'pass', 'Stripe payouts enabled'));
    }
  } catch (err) {
    checks.push(check('stripe.api', 'stripe', 'fail', `Stripe API unreachable: ${err.message}`, { code: err.code }));
    return;
  }

  const cashApp = await stripe.probeCashAppPayAvailable();
  if (cashApp.available) {
    checks.push(check('stripe.cashapp', 'stripe', 'pass', `Cash App Pay available (${cashApp.mode})`));
  } else {
    checks.push(check(
      'stripe.cashapp',
      'stripe',
      'fail',
      `Cash App Pay not available: ${cashApp.reason}`,
      { fix: 'Enable Cash App Pay at https://dashboard.stripe.com/settings/payment_methods' }
    ));
  }

  const ach = await stripe.probeAchPaymentIntentAvailable();
  if (ach.available) {
    checks.push(check('stripe.ach', 'stripe', 'pass', `ACH PaymentIntents available (${ach.mode})`));
  } else {
    checks.push(check('stripe.ach', 'stripe', 'fail', `ACH not available: ${ach.reason}`));
  }

  try {
    const endpoints = await stripe.listWebhookEndpoints();
    const wantUrls = expectedWebhookUrls();
    const match = endpoints.find((w) => {
      const normalized = w.url.replace(/\/$/, '');
      return wantUrls.some((u) => normalized === u.replace(/\/$/, ''));
    });
    if (!match) {
      checks.push(check(
        'stripe.webhook_url',
        'stripe',
        'fail',
        `No webhook endpoint for ${wantUrls.join(' or ')}`,
        { fix: `Register POST ${wantUrls[0]} in Stripe Dashboard → Developers → Webhooks`, endpoints: endpoints.map((e) => e.url) }
      ));
    } else if (match.status !== 'enabled') {
      checks.push(check('stripe.webhook_url', 'stripe', 'fail', `Webhook ${match.url} status=${match.status}`));
    } else {
      checks.push(check('stripe.webhook_url', 'stripe', 'pass', `Webhook registered: ${match.url}`));
    }

    const missingEvents = stripe.ALL_WEBHOOK_EVENTS.filter((ev) => {
      if (match?.enabledEvents?.includes('*')) return false;
      return !match?.enabledEvents?.includes(ev);
    });
    if (match && missingEvents.length) {
      checks.push(check(
        'stripe.webhook_events',
        'stripe',
        'fail',
        `Webhook missing events: ${missingEvents.join(', ')}`,
        { fix: 'Run npm run stripe:webhook:sync (or stripe:webhook-events:dry first)' }
      ));
    } else if (match) {
      checks.push(check('stripe.webhook_events', 'stripe', 'pass', 'Webhook has all required events (payment_intent.*, charge.dispute.created, account.updated)'));
    }

    try {
      const pending = await stripe.listPendingWebhookEvents({ limit: 15 });
      if (pending.length) {
        checks.push(check(
          'stripe.webhook_delivery',
          'stripe',
          'warn',
          `${pending.length} recent Stripe event(s) still have pending webhook deliveries`,
          {
            fix: 'Stripe Dashboard → Developers → Webhooks → inspect failed deliveries for this endpoint',
            events: pending.slice(0, 5).map((e) => ({ id: e.id, type: e.type, pending: e.pendingWebhooks })),
          }
        ));
      } else {
        checks.push(check('stripe.webhook_delivery', 'stripe', 'pass', 'No pending webhook deliveries on recent events'));
      }
    } catch (err) {
      checks.push(check('stripe.webhook_delivery', 'stripe', 'warn', `Could not probe webhook delivery status: ${err.message}`));
    }
  } catch (err) {
    checks.push(check('stripe.webhooks', 'stripe', 'warn', `Could not list webhook endpoints: ${err.message}`));
  }
}

async function checkConnectPayroll(checks, db = pool) {
  if (!process.env.STRIPE_SECRET_KEY) return;

  const { rows } = await db.query(
    `SELECT ba.stripe_connect_account_id, ba.institution_name, ba.account_mask,
            u.email, u.first_name, u.last_name
       FROM bank_accounts ba
       JOIN users u ON u.id = ba.user_id
      WHERE ba.purpose = 'manager_payout'
        AND ba.status = 'verified'
        AND ba.is_default = TRUE
      ORDER BY ba.updated_at DESC
      LIMIT 1`
  );

  const bank = rows[0];
  if (!bank) {
    checks.push(check(
      'stripe.connect',
      'stripe',
      'warn',
      'No verified manager payout bank — Connect payroll and lease-signing ACH blocked',
      { fix: 'Manager → Site Visits → link payout bank and complete Stripe onboarding' }
    ));
    return;
  }

  if (!bank.stripe_connect_account_id) {
    checks.push(check(
      'stripe.connect',
      'stripe',
      'fail',
      `Manager payout bank linked (${bank.institution_name} ····${bank.account_mask}) but no Stripe Connect account`,
      { fix: 'Re-link payout bank or run npm run stripe:connect:status for details' }
    ));
    return;
  }

  try {
    const account = await stripe.retrieveConnectAccount(bank.stripe_connect_account_id);
    const summary = stripe.summarizeConnectAccount(account);
    const name = [bank.first_name, bank.last_name].filter(Boolean).join(' ') || bank.email;

    if (summary.transfersActive) {
      checks.push(check(
        'stripe.connect',
        'stripe',
        'pass',
        `Connect payroll ready — ${summary.id} (${name}) transfers=active`,
        { accountId: summary.id, email: bank.email }
      ));
    } else {
      const due = summary.requirementsDue.length
        ? ` — needs: ${summary.requirementsDue.slice(0, 4).join(', ')}`
        : '';
      checks.push(check(
        'stripe.connect',
        'stripe',
        'fail',
        `Connect account ${summary.id} transfers=${summary.transfers}${due}`,
        {
          fix: 'Manager → Site Visits → Complete Stripe payout setup (identity + bank)',
          accountId: summary.id,
          transfers: summary.transfers,
          requirementsDue: summary.requirementsDue,
        }
      ));
    }
  } catch (err) {
    checks.push(check(
      'stripe.connect',
      'stripe',
      'fail',
      `Could not retrieve Connect account ${bank.stripe_connect_account_id}: ${err.message}`,
      { fix: 'Verify account in Stripe Dashboard → Connect → Accounts' }
    ));
  }
}

async function checkPlaidApi(checks) {
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) return;

  try {
    const probe = await plaid.probeLinkToken();
    checks.push(check('plaid.link_token', 'plaid', 'pass', `Plaid link token OK (${probe.env})`));
  } catch (err) {
    const msg = err.response?.data?.error_message || err.message;
    checks.push(check(
      'plaid.link_token',
      'plaid',
      'fail',
      `Plaid link token failed: ${msg}`,
      { fix: 'Verify PLAID_CLIENT_ID/SECRET, production access, and PLAID_REDIRECT_URI in Plaid Dashboard allowed URIs' }
    ));
  }
}

async function checkDatabase(checks, db = pool) {
  const { rows: tenantsNoBank } = await db.query(
    `SELECT u.email, u.first_name, u.last_name, un.unit_number
       FROM users u
       JOIN leases l ON l.tenant_id = u.id AND l.status = 'active'
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
      WHERE p.name ILIKE $1
        AND u.role = 'tenant'
        AND u.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM bank_accounts ba
           WHERE ba.user_id = u.id AND ba.status = 'verified'
        )
      ORDER BY u.last_name, u.first_name`,
    [PROPERTY_MATCH]
  );

  if (tenantsNoBank.length) {
    checks.push(check(
      'db.tenants_no_bank',
      'database',
      'warn',
      `${tenantsNoBank.length} active tenant(s) without verified bank — ACH/autopay/deposit pay blocked`,
      { tenants: tenantsNoBank.map((t) => ({ email: t.email, name: `${t.first_name} ${t.last_name}`, unit: t.unit_number })) }
    ));
  } else {
    checks.push(check('db.tenants_no_bank', 'database', 'pass', 'All active tenants have a verified bank linked'));
  }

  const { rows: autopayBroken } = await db.query(
    `SELECT u.email FROM leases l
       JOIN users u ON u.id = l.tenant_id
      WHERE l.status = 'active' AND l.autopay_enabled = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM bank_accounts ba
           WHERE ba.id = l.autopay_bank_account_id AND ba.status = 'verified'
        )`
  );
  if (autopayBroken.length) {
    checks.push(check('db.autopay_broken', 'database', 'fail', `${autopayBroken.length} lease(s) have autopay on but no valid bank`, { emails: autopayBroken.map((r) => r.email) }));
  }

  const { rows: [stuck] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM payments
      WHERE status = 'processing'
        AND updated_at < NOW() - INTERVAL '7 days'`
  );
  if (stuck?.n > 0) {
    checks.push(check('db.stuck_processing', 'database', 'warn', `${stuck.n} payment(s) processing > 7 days — check Stripe Dashboard`));
  }

  const { rows: [orphanPi] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM payments
      WHERE stripe_payment_intent_id IS NOT NULL
        AND status IN ('pending', 'processing')
        AND updated_at < NOW() - INTERVAL '2 hours'`
  );
  if (orphanPi?.n > 0) {
    checks.push(check('db.stale_intents', 'database', 'warn', `${orphanPi.n} payment(s) with Stripe intent still open > 2h — webhook or sync issue?`));
  }

  const { rows: pendingDeposits } = await db.query(
    `SELECT u.email, p.amount::float AS amount
       FROM payments p
       JOIN users u ON u.id = p.tenant_id
       JOIN leases l ON l.id = p.lease_id AND l.status = 'active'
      WHERE p.payment_type = 'security_deposit' AND p.status = 'pending'`
  );
  if (pendingDeposits.length) {
    checks.push(check(
      'db.pending_deposits',
      'database',
      'warn',
      `${pendingDeposits.length} pending security deposit(s) — tenants need bank link + ACH (Cash App Pay is rent-only)`,
      { tenants: pendingDeposits }
    ));
  }
}

function buildStripeSubsection(checks) {
  const stripeChecks = checks.filter((c) => c.category === 'stripe' || c.id.startsWith('env.stripe'));
  const actions = stripeChecks
    .filter((c) => c.status === 'fail' || (c.status === 'warn' && c.fix))
    .map((c) => ({
      id: c.id,
      status: c.status,
      message: c.message,
      fix: c.fix || null,
    }));

  const fail = stripeChecks.filter((c) => c.status === 'fail').length;
  const warn = stripeChecks.filter((c) => c.status === 'warn').length;

  const connectCheck = stripeChecks.find((c) => c.id === 'stripe.connect');
  const webhookCheck = stripeChecks.find((c) => c.id === 'stripe.webhook_url');
  const eventsCheck = stripeChecks.find((c) => c.id === 'stripe.webhook_events');
  const cashAppCheck = stripeChecks.find((c) => c.id === 'stripe.cashapp');
  const achCheck = stripeChecks.find((c) => c.id === 'stripe.ach');
  const pkCheck = stripeChecks.find((c) => c.id === 'env.stripe_publishable_api');

  return {
    ok: fail === 0,
    mode: stripe.stripeMode(),
    summary: { pass: stripeChecks.filter((c) => c.status === 'pass').length, warn, fail },
    account: stripeChecks.find((c) => c.id === 'stripe.charges')?.message ?? null,
    cashAppPay: cashAppCheck ? { status: cashAppCheck.status, message: cashAppCheck.message } : null,
    ach: achCheck ? { status: achCheck.status, message: achCheck.message } : null,
    publishableKey: pkCheck ? { status: pkCheck.status, message: pkCheck.message } : null,
    webhook: {
      registered: webhookCheck?.status === 'pass',
      url: webhookCheck?.status === 'pass' ? webhookCheck.message.replace(/^Webhook registered: /, '') : expectedWebhookUrl(),
      eventsComplete: eventsCheck?.status === 'pass',
      message: eventsCheck?.message ?? webhookCheck?.message ?? null,
    },
    connect: connectCheck ? {
      status: connectCheck.status,
      message: connectCheck.message,
      accountId: connectCheck.accountId ?? null,
      fix: connectCheck.fix ?? null,
    } : null,
    actions,
  };
}

async function runPaymentsHealth({ skipStripeProbe = false, skipPlaidProbe = false, skipDatabase = false } = {}) {
  const checks = [];
  checkEnv(checks);

  if (!skipStripeProbe) {
    await checkStripeApi(checks);
    await checkConnectPayroll(checks);
  }
  if (!skipPlaidProbe) await checkPlaidApi(checks);
  if (!skipDatabase) await checkDatabase(checks);

  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const c of checks) summary[c.status] += 1;

  const ok = summary.fail === 0;
  const stripeSection = buildStripeSubsection(checks);

  return {
    ok,
    checkedAt: new Date().toISOString(),
    summary,
    expectedWebhookUrl: expectedWebhookUrl(),
    stripe: stripeSection,
    checks,
  };
}

module.exports = {
  runPaymentsHealth,
  expectedWebhookUrl,
  expectedWebhookUrls,
  buildStripeSubsection,
};
