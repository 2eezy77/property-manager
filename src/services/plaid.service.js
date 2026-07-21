/**
 * plaid.service.js
 * Thin wrapper around the Plaid Node SDK.
 *
 * Methods exposed:
 *   createLinkToken(userId, options)       — Link or Update Mode token
 *   exchangePublicToken(publicToken)       — public_token → { accessToken, itemId }
 *   createStripeBankAccountToken(...)      — Stripe btok_...
 *   getAccountDetails(...)                 — institution + account metadata
 *   getAchAccountNumbers(...)              — routing + account for Stripe ACH
 *   evaluateAchRisk(...)                   — Plaid Signal pre-debit score
 *   getAvailableBalance(...)               — real-time available balance
 *   verifyPlaidWebhook(body, header)       — JWT + body hash verification
 *
 * Required env vars:
 *   PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV
 *   PLAID_REDIRECT_URI  — OAuth institutions
 * Optional:
 *   PLAID_WEBHOOK_URL, PLAID_SIGNAL_ENABLED, PLAID_BALANCE_CHECK_ENABLED
 *   PLAID_SIGNAL_RULESET_KEY, PLAID_WEBHOOK_VERIFY_DISABLED (local dev only)
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require('plaid');

const config = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV ?? 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET':    process.env.PLAID_SECRET,
    },
  },
});

const client = new PlaidApi(config);

const jwkCache = new Map();

function envFlag(name) {
  const v = process.env[name];
  if (v == null || v === '') return false;
  return v === '1' || v.toLowerCase() === 'true';
}

function getPlaidRedirectUri() {
  if (process.env.PLAID_REDIRECT_URI) {
    return process.env.PLAID_REDIRECT_URI;
  }
  const origin = process.env.CLIENT_ORIGIN;
  if (origin && process.env.PLAID_ENV === 'production') {
    return `${origin.replace(/\/$/, '')}/oauth-return`;
  }
  return null;
}

function getPlaidWebhookUrl() {
  return process.env.PLAID_WEBHOOK_URL || null;
}

/**
 * Create a Plaid Link token (new link or Update Mode).
 *
 * @param {string} userId
 * @param {{ updateMode?: boolean, accessToken?: string }} [options]
 * @returns {Promise<string>} link_token
 */
async function createLinkToken(userId, options = {}) {
  const { updateMode = false, accessToken = null } = options;

  const request = {
    user:          { client_user_id: userId },
    client_name:   'Property Manager',
    country_codes: [CountryCode.Us],
    language:      'en',
  };

  if (updateMode && accessToken) {
    request.access_token = accessToken;
  } else {
    const products = [Products.Auth];
    if (envFlag('PLAID_SIGNAL_ENABLED')) {
      products.push(Products.Signal);
    }
    request.products = products;
    request.account_filters = {
      depository: {
        account_subtypes: ['checking', 'savings'],
      },
    };
  }

  const redirectUri = getPlaidRedirectUri();
  if (redirectUri) {
    request.redirect_uri = redirectUri;
  }

  const webhook = getPlaidWebhookUrl();
  if (webhook) {
    request.webhook = webhook;
  }

  const { data } = await client.linkTokenCreate(request);
  return data.link_token;
}

async function exchangePublicToken(publicToken) {
  const { data } = await client.itemPublicTokenExchange({ public_token: publicToken });
  return {
    accessToken: data.access_token,
    itemId:      data.item_id,
  };
}

async function createStripeBankAccountToken(accessToken, accountId) {
  const { data } = await client.processorStripeBankAccountTokenCreate({
    access_token: accessToken,
    account_id:   accountId,
  });
  return data.stripe_bank_account_token;
}

async function getAccountDetails(accessToken, accountId) {
  const [authResp, itemResp] = await Promise.all([
    client.authGet({ access_token: accessToken }),
    client.itemGet({ access_token: accessToken }),
  ]);

  const account = authResp.data.accounts.find((a) => a.account_id === accountId);
  if (!account) throw new Error(`Account ${accountId} not found in Plaid auth response`);

  let institutionName = 'Unknown Institution';
  let institutionId   = itemResp.data.item.institution_id;
  if (institutionId) {
    try {
      const instResp = await client.institutionsGetById({
        institution_id: institutionId,
        country_codes:  [CountryCode.Us],
      });
      institutionName = instResp.data.institution.name;
    } catch {
      // Non-fatal
    }
  }

  return {
    institutionName,
    institutionId:  institutionId ?? null,
    accountName:    account.name,
    accountMask:    account.mask,
    accountType:    account.subtype,
  };
}

async function getAchAccountNumbers(accessToken, accountId) {
  const { data } = await client.authGet({ access_token: accessToken });

  const ach = data.numbers.ach.find((n) => n.account_id === accountId);
  if (!ach) throw new Error(`No ACH numbers for Plaid account ${accountId}`);

  return { routing: ach.routing, account: ach.account };
}

/**
 * Plaid Signal — evaluate ACH return risk before debit.
 * @returns {Promise<{ rulesetResult: string|null, customerReturnRiskScore: number|null, bankReturnRiskScore: number|null }>}
 */
async function evaluateAchRisk(accessToken, accountId, amountCents, options = {}) {
  const rulesetKey = process.env.PLAID_SIGNAL_RULESET_KEY;
  if (!rulesetKey) {
    console.warn('[plaid] PLAID_SIGNAL_ENABLED but PLAID_SIGNAL_RULESET_KEY missing — skipping Signal');
    return { rulesetResult: null, customerReturnRiskScore: null, bankReturnRiskScore: null };
  }

  const amountDollars = amountCents / 100;
  const request = {
    access_token:           accessToken,
    account_id:             accountId,
    amount:                 amountDollars,
    client_transaction_id: options.clientTransactionId || `txn-${Date.now()}`,
    user_present:           options.userPresent !== false,
  };

  if (options.userId) {
    request.client_user_id = options.userId;
  }
  if (rulesetKey) {
    request.ruleset_key = rulesetKey;
  }

  const { data } = await client.signalEvaluate(request);

  return {
    rulesetResult: data.ruleset?.result ?? null,
    customerReturnRiskScore: data.scores?.customer_initiated_return_risk?.score ?? null,
    bankReturnRiskScore: data.scores?.bank_initiated_return_risk?.score ?? null,
  };
}

/**
 * Prepare an existing Item for Signal (required when Item was created before Signal was added).
 */
async function prepareSignalForItem(accessToken) {
  const { data } = await client.signalPrepare({ access_token: accessToken });
  return data;
}

/**
 * Real-time available balance for a linked account.
 * @returns {Promise<{ availableCents: number|null, currentCents: number|null }>}
 */
async function getAvailableBalance(accessToken, accountId) {
  const { data } = await client.accountsBalanceGet({ access_token: accessToken });
  const account = data.accounts.find((a) => a.account_id === accountId);
  if (!account?.balances) {
    return { availableCents: null, currentCents: null };
  }

  const available = account.balances.available ?? account.balances.current;
  const current = account.balances.current;

  return {
    availableCents: available != null ? Math.round(available * 100) : null,
    currentCents: current != null ? Math.round(current * 100) : null,
  };
}

async function getWebhookVerificationKey(kid) {
  if (jwkCache.has(kid)) return jwkCache.get(kid);

  const { data } = await client.webhookVerificationKeyGet({ key_id: kid });
  jwkCache.set(kid, data.key);
  return data.key;
}

/**
 * Verify Plaid webhook JWT (Plaid-Verification header) + body SHA-256.
 * @param {Buffer} rawBody
 * @param {string|undefined} verificationHeader
 */
async function verifyPlaidWebhook(rawBody, verificationHeader) {
  if (envFlag('PLAID_WEBHOOK_VERIFY_DISABLED')) {
    return { ok: true, skipped: true };
  }

  if (!verificationHeader) {
    return { ok: false, reason: 'missing_verification_header' };
  }

  let header;
  try {
    const headerB64 = verificationHeader.split('.')[0];
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid_jwt_header' };
  }

  if (header.alg !== 'ES256') {
    return { ok: false, reason: 'unsupported_alg' };
  }

  let jwk;
  try {
    jwk = await getWebhookVerificationKey(header.kid);
  } catch (err) {
    console.error('[plaid/webhook] key fetch failed:', err.response?.data?.error_message || err.message);
    return { ok: false, reason: 'key_fetch_failed' };
  }

  let decoded;
  try {
    const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    decoded = jwt.verify(verificationHeader, keyObject, {
      algorithms: ['ES256'],
      maxAge: '5m',
    });
  } catch {
    return { ok: false, reason: 'jwt_verify_failed' };
  }

  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const claimed = decoded.request_body_sha256;
  if (!claimed || bodyHash.length !== claimed.length) {
    return { ok: false, reason: 'body_hash_mismatch' };
  }
  if (!crypto.timingSafeEqual(Buffer.from(bodyHash), Buffer.from(claimed))) {
    return { ok: false, reason: 'body_hash_mismatch' };
  }

  return { ok: true };
}

/**
 * Point an existing Item at our webhook URL (for banks linked before PLAID_WEBHOOK_URL existed).
 *
 * @param {string} accessToken — decrypted Plaid access_token
 * @param {string} [webhookUrl] — defaults to PLAID_WEBHOOK_URL
 */
async function updateItemWebhook(accessToken, webhookUrl = null) {
  const url = webhookUrl || getPlaidWebhookUrl();
  if (!url) throw new Error('PLAID_WEBHOOK_URL is not set');
  const { data } = await client.itemWebhookUpdate({
    access_token: accessToken,
    webhook: url,
  });
  return data;
}

async function probeLinkToken(userId = '00000000-0000-0000-0000-healthcheck01') {
  const linkToken = await createLinkToken(userId);
  return {
    ok: true,
    env: process.env.PLAID_ENV ?? 'sandbox',
    redirectUri: getPlaidRedirectUri(),
    webhookUrl: getPlaidWebhookUrl(),
    signalEnabled: envFlag('PLAID_SIGNAL_ENABLED'),
    balanceCheckEnabled: envFlag('PLAID_BALANCE_CHECK_ENABLED'),
    linkTokenLength: linkToken.length,
  };
}

module.exports = {
  createLinkToken,
  exchangePublicToken,
  createStripeBankAccountToken,
  getAccountDetails,
  getAchAccountNumbers,
  evaluateAchRisk,
  getAvailableBalance,
  prepareSignalForItem,
  verifyPlaidWebhook,
  getPlaidRedirectUri,
  getPlaidWebhookUrl,
  updateItemWebhook,
  probeLinkToken,
};
