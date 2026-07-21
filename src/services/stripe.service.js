/**
 * stripe.service.js
 * Stripe integration for ACH bank account management and payment processing.
 *
 * Methods:
 *   getOrCreateCustomer(userId, email)                      — idempotent customer lookup/create
 *   attachBankAccount(customerId, bankAccountToken)         — add verified bank account to customer (btok_...)
 *   getBankAccount(customerId, bankAccountId)               — fetch bank account details
 *   chargeACH(params)                                       — create + confirm PaymentIntent
 *   createTransfer(params)                                  — send payout to Connect account
 *   constructWebhookEvent(rawBody, signature)              — verify Stripe webhook signature
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET  — from `stripe listen` or dashboard
 */

const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  appInfo: { name: 'PropertyManager', version: '0.1.0' },
});

/**
 * Look up a Stripe customer by metadata userId, or create one if not found.
 * This keeps Stripe customers in sync with our users table.
 *
 * @param {string} userId  — internal UUID
 * @param {string} email
 * @returns {Promise<string>} stripeCustomerId
 */
async function getOrCreateCustomer(userId, email) {
  // Search for existing customer by our userId metadata tag
  const existing = await stripe.customers.search({
    query: `metadata['userId']:'${userId}'`,
    limit: 1,
  });

  if (existing.data.length > 0) return existing.data[0].id;

  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  });
  return customer.id;
}

/**
 * Stripe customer for org-level property operating accounts (joint owner bank).
 *
 * @param {string} orgId
 * @param {string} email — linking owner's email
 * @returns {Promise<string>}
 */
async function getOrCreateOrgCustomer(orgId, email) {
  const existing = await stripe.customers.search({
    query: `metadata['orgId']:'${orgId}'`,
    limit: 1,
  });

  if (existing.data.length > 0) return existing.data[0].id;

  const customer = await stripe.customers.create({
    email,
    metadata: { orgId },
  });
  return customer.id;
}

async function detachBankAccount(customerId, bankAccountId) {
  return stripe.customers.deleteSource(customerId, bankAccountId);
}

/**
 * Attach a Plaid-issued Stripe bank account token (btok_...) to a Stripe customer.
 * The btok is one-time-use; createSource persists it as a ba_xxx on the customer.
 * Plaid has already authenticated the account, so it skips Stripe's micro-deposit
 * verification and the returned bank account is `status: 'verified'`.
 *
 * @param {string} customerId        — Stripe customer id (cus_xxx)
 * @param {string} bankAccountToken  — btok_... from plaid.createStripeBankAccountToken()
 * @returns {Promise<Stripe.BankAccount>}
 */
async function attachBankAccount(customerId, bankAccountToken) {
  const bankAccount = await stripe.customers.createSource(customerId, {
    source: bankAccountToken,
  });
  return bankAccount;
}

/**
 * Retrieve a specific bank account from a Stripe customer.
 *
 * @param {string} customerId
 * @param {string} bankAccountId  — ba_xxx
 * @returns {Promise<Stripe.BankAccount>}
 */
async function getBankAccount(customerId, bankAccountId) {
  return stripe.customers.retrieveSource(customerId, bankAccountId);
}

/**
 * Normalize ACH credentials for Stripe.
 * Plaid sandbox OAuth institutions return account numbers Stripe test mode rejects.
 * Plaid docs: sandbox tokens always map to Stripe test account 000123456789 / 110000000.
 */
function normalizeAchNumbers(routingNumber, accountNumber) {
  const isTest = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');
  if (isTest) {
    return { routingNumber: '110000000', accountNumber: '000123456789' };
  }
  return { routingNumber, accountNumber };
}

/**
 * Create a Stripe PaymentMethod (type us_bank_account) from Plaid Auth numbers
 * and attach it to the customer. Required because Stripe has deprecated legacy
 * ACH Charges; PaymentIntents need a pm_xxx, not a ba_xxx source.
 *
 * @param {{
 *   customerId:        string,
 *   routingNumber:     string,
 *   accountNumber:     string,
 *   accountHolderName: string,
 * }} params
 * @returns {Promise<Stripe.PaymentMethod>}
 */
async function createUsBankPaymentMethod({ customerId, routingNumber, accountNumber, accountHolderName }) {
  const nums = normalizeAchNumbers(routingNumber, accountNumber);
  const paymentMethod = await stripe.paymentMethods.create({
    type: 'us_bank_account',
    us_bank_account: {
      routing_number:      nums.routingNumber,
      account_number:      nums.accountNumber,
      account_holder_type: 'individual',
    },
    billing_details: { name: accountHolderName || 'Account Holder' },
  });

  await stripe.paymentMethods.attach(paymentMethod.id, { customer: customerId });
  return paymentMethod;
}

/**
 * Create and confirm an ACH debit PaymentIntent.
 * Uses inline payment_method_data so Stripe verifies the bank account as part of
 * the PaymentIntent confirmation (no separate attach step needed).
 *
 * @param {{
 *   amountCents:       number,
 *   customerId:        string,
 *   routingNumber:     string,
 *   accountNumber:     string,
 *   accountHolderName: string,
 *   description:       string,
 *   metadata:          object,
 *   ipAddress:         string,
 *   userAgent:         string,
 * }} params
 * @returns {Promise<Stripe.PaymentIntent>}
 */
/** MCC 6513 — real estate agents and managers (rentals). Required for Connect KYC/tax. */
const CONNECT_SITE_MCC = '6513';

function connectSiteBusinessProfile(displayName) {
  const url = (process.env.CLIENT_ORIGIN || 'https://www.monterorentals.com').replace(/\/$/, '');
  return {
    name: displayName,
    url,
    mcc: CONNECT_SITE_MCC,
    product_description: 'Property management site visit compensation',
  };
}

async function updateConnectAccountBusinessProfile(accountId, displayName) {
  return stripe.accounts.update(accountId, {
    business_profile: connectSiteBusinessProfile(displayName),
  });
}

async function createConnectExpressPayoutAccount({
  email, userId, bankAccountToken, firstName, lastName,
}) {
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || email;
  const accountParams = {
    type: 'express',
    country: 'US',
    email,
    business_type: 'individual',
    capabilities: {
      transfers:      { requested: true },
      card_payments:  { requested: true },
    },
    business_profile: connectSiteBusinessProfile(displayName),
    metadata: {
      userId,
      purpose: 'manager_payout',
    },
  };

  if (firstName || lastName) {
    accountParams.individual = {
      email,
      ...(firstName && { first_name: firstName }),
      ...(lastName && { last_name: lastName }),
    };
  }

  const account = await stripe.accounts.create(accountParams);

  await stripe.accounts.createExternalAccount(account.id, {
    external_account: bankAccountToken,
  });

  return account.id;
}

async function retrieveConnectAccount(accountId) {
  return stripe.accounts.retrieve(accountId);
}

function isConnectTransfersActive(account) {
  return account?.capabilities?.transfers === 'active';
}

async function createConnectAccountLink(accountId, { returnUrl, refreshUrl }) {
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
  return link.url;
}

async function chargeACH({
  amountCents, customerId, routingNumber, accountNumber, accountHolderName,
  description, metadata, ipAddress, userAgent, transferDestination,
}) {
  const nums = normalizeAchNumbers(routingNumber, accountNumber);

  const intentParams = {
    amount:               amountCents,
    currency:             'usd',
    customer:             customerId,
    payment_method_types: ['us_bank_account'],
    payment_method_data:  {
      type: 'us_bank_account',
      us_bank_account: {
        routing_number:      nums.routingNumber,
        account_number:      nums.accountNumber,
        account_holder_type: 'individual',
      },
      billing_details: { name: accountHolderName || 'Account Holder' },
    },
    confirm:              true,
    description,
    metadata,
    mandate_data: {
      customer_acceptance: {
        type:   'online',
        online: {
          ip_address: ipAddress || '127.0.0.1',
          user_agent: userAgent || 'PropertyManager',
        },
      },
    },
  };

  if (transferDestination) {
    intentParams.transfer_data = { destination: transferDestination };
  }

  let paymentIntent = await stripe.paymentIntents.create(intentParams);

  // Sandbox: inline us_bank_account PMs often land in requires_action (microdeposits).
  // Stripe test mode accepts descriptor code SM11AA — auto-verify so webhooks can fire.
  if (
    paymentIntent.status === 'requires_action'
    && paymentIntent.next_action?.type === 'verify_with_microdeposits'
    && (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')
  ) {
    paymentIntent = await stripe.paymentIntents.verifyMicrodeposits(paymentIntent.id, {
      descriptor_code: 'SM11AA',
    });
  }

  return paymentIntent;
}

/**
 * Transfer funds to a Stripe Connect account (vendor or owner payout).
 *
 * @param {{
 *   amountCents:        number,
 *   destinationAccount: string,  — acct_xxx (Stripe Connect)
 *   description:        string,
 *   metadata:           object,
 * }} params
 * @returns {Promise<Stripe.Transfer>}
 */
async function createTransfer({ amountCents, destinationAccount, description, metadata }) {
  return stripe.transfers.create({
    amount:      amountCents,
    currency:    'usd',
    destination: destinationAccount,
    description,
    metadata,
  });
}

/**
 * Verify and parse a Stripe webhook event.
 * Must be called with the RAW request body (Buffer), not parsed JSON.
 *
 * @param {Buffer} rawBody
 * @param {string} signature  — req.headers['stripe-signature']
 * @returns {Stripe.Event}
 */
function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

function getPublishableKey() {
  return process.env.STRIPE_PUBLISHABLE_KEY
    || process.env.VITE_STRIPE_PUBLISHABLE_KEY
    || '';
}

function stripeMode() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (key.startsWith('sk_live_')) return 'live';
  if (key.startsWith('sk_test_')) return 'test';
  return 'unknown';
}

function isCashAppPayConfigured() {
  return Boolean(getPublishableKey() && process.env.STRIPE_SECRET_KEY);
}

/** Required for PaymentIntent ACH + Cash App Pay lifecycle in stripe.webhook.js */
const REQUIRED_WEBHOOK_EVENTS = [
  'payment_intent.processing',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
];

/** Connect payroll + dispute notifications — sync via npm run stripe:webhook:sync */
const EXTRA_WEBHOOK_EVENTS = [
  'charge.dispute.created',
  'account.updated',
];

const ALL_WEBHOOK_EVENTS = [...REQUIRED_WEBHOOK_EVENTS, ...EXTRA_WEBHOOK_EVENTS];

/** Canonical production webhook URLs (always checked when using live keys). */
const PRODUCTION_WEBHOOK_URLS = [
  'https://www.monterorentals.com/webhooks/stripe',
  'https://monterorentals.com/webhooks/stripe',
];

async function retrieveAccountSummary() {
  const account = await stripe.accounts.retrieve();
  return {
    id: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    country: account.country,
    displayName: account.settings?.dashboard?.display_name || account.business_profile?.name,
  };
}

async function listWebhookEndpoints() {
  const { data } = await stripe.webhookEndpoints.list({ limit: 20 });
  return data.map((w) => ({
    id: w.id,
    url: w.url,
    status: w.status,
    enabledEvents: w.enabled_events,
  }));
}

/**
 * Recent events with undelivered webhooks (pending_webhooks > 0).
 * Lightweight signal for delivery failures without Dashboard log scraping.
 */
async function listPendingWebhookEvents({ limit = 15 } = {}) {
  const { data } = await stripe.events.list({ limit });
  return data
    .filter((e) => (e.pending_webhooks ?? 0) > 0)
    .map((e) => ({
      id: e.id,
      type: e.type,
      pendingWebhooks: e.pending_webhooks,
      created: e.created,
    }));
}

function summarizeConnectAccount(account) {
  const transfers = account?.capabilities?.transfers ?? 'unrequested';
  const cardPayments = account?.capabilities?.card_payments ?? 'unrequested';
  const detailsSubmitted = Boolean(account?.details_submitted);
  const payoutsEnabled = Boolean(account?.payouts_enabled);
  const requirements = account?.requirements?.currently_due ?? [];
  return {
    id: account.id,
    email: account.email,
    transfers,
    transfersActive: transfers === 'active',
    cardPayments,
    detailsSubmitted,
    payoutsEnabled,
    requirementsDue: requirements,
    disabledReason: account?.requirements?.disabled_reason ?? null,
  };
}

/**
 * Create + cancel a $0.50 PaymentIntent to verify Cash App Pay is enabled on the account.
 * Safe for live mode — never confirmed, cancelled immediately.
 */
async function probeCashAppPayAvailable() {
  if (!isCashAppPayConfigured()) {
    return { available: false, reason: 'STRIPE_KEYS_MISSING' };
  }
  try {
    const pi = await stripe.paymentIntents.create({
      amount: 50,
      currency: 'usd',
      payment_method_types: ['cashapp'],
      confirm: false,
      metadata: { health_probe: 'payments_health', purpose: 'cashapp_availability_check' },
    });
    await stripe.paymentIntents.cancel(pi.id);
    return { available: true, mode: stripeMode() };
  } catch (err) {
    return {
      available: false,
      reason: err.message,
      code: err.code,
      mode: stripeMode(),
    };
  }
}

async function probeAchPaymentIntentAvailable() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { available: false, reason: 'STRIPE_SECRET_KEY_MISSING' };
  }
  try {
    const pi = await stripe.paymentIntents.create({
      amount: 50,
      currency: 'usd',
      payment_method_types: ['us_bank_account'],
      confirm: false,
      metadata: { health_probe: 'payments_health', purpose: 'ach_availability_check' },
    });
    await stripe.paymentIntents.cancel(pi.id);
    return { available: true, mode: stripeMode() };
  } catch (err) {
    return {
      available: false,
      reason: err.message,
      code: err.code,
      mode: stripeMode(),
    };
  }
}

/**
 * Create a PaymentIntent for Cash App Pay (client confirms via Stripe.js).
 */
async function createCashAppPaymentIntent({
  amountCents,
  customerId,
  description,
  metadata,
  transferDestination,
}) {
  const params = {
    amount: amountCents,
    currency: 'usd',
    customer: customerId,
    payment_method_types: ['cashapp'],
    description,
    metadata,
  };
  if (transferDestination) {
    params.transfer_data = { destination: transferDestination };
  }
  return stripe.paymentIntents.create(params);
}

async function retrievePaymentIntent(paymentIntentId) {
  return stripe.paymentIntents.retrieve(paymentIntentId);
}

async function cancelPaymentIntent(paymentIntentId) {
  return stripe.paymentIntents.cancel(paymentIntentId);
}

module.exports = {
  getOrCreateCustomer,
  getOrCreateOrgCustomer,
  attachBankAccount,
  detachBankAccount,
  getBankAccount,
  createUsBankPaymentMethod,
  createConnectExpressPayoutAccount,
  updateConnectAccountBusinessProfile,
  retrieveConnectAccount,
  isConnectTransfersActive,
  createConnectAccountLink,
  chargeACH,
  createTransfer,
  constructWebhookEvent,
  getPublishableKey,
  isCashAppPayConfigured,
  stripeMode,
  REQUIRED_WEBHOOK_EVENTS,
  EXTRA_WEBHOOK_EVENTS,
  ALL_WEBHOOK_EVENTS,
  PRODUCTION_WEBHOOK_URLS,
  retrieveAccountSummary,
  listWebhookEndpoints,
  listPendingWebhookEvents,
  summarizeConnectAccount,
  probeCashAppPayAvailable,
  probeAchPaymentIntentAvailable,
  createCashAppPaymentIntent,
  retrievePaymentIntent,
  cancelPaymentIntent,
};
