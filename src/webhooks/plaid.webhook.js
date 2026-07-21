/**
 * plaid.webhook.js
 * Handles inbound Plaid Item webhooks (login required, pending expiration, etc.).
 *
 * CRITICAL: Mount BEFORE express.json() with express.raw().
 * Verification: JWT in Plaid-Verification header (see Plaid webhook docs).
 */

const express = require('express');
const plaid = require('../services/plaid.service');
const {
  markAccountsNeedsRelinkByItemId,
  clearLinkStatusByItemId,
} = require('../services/plaid-bank-link.service');

const router = express.Router();

const NEEDS_RELINK_CODES = new Set([
  'PENDING_EXPIRATION',
  'USER_PERMISSION_REVOKED',
]);

function itemErrorNeedsRelink(error) {
  if (!error) return false;
  const code = error.error_code || error.errorCode;
  return code === 'ITEM_LOGIN_REQUIRED';
}

async function handleItemWebhook(payload) {
  const { webhook_code: code, item_id: itemId, error } = payload;
  if (!itemId) return { action: 'ignored', reason: 'no_item_id' };

  if (NEEDS_RELINK_CODES.has(code) || itemErrorNeedsRelink(error)) {
    const count = await markAccountsNeedsRelinkByItemId(itemId);
    console.warn('[plaid/webhook] marked needs_relink', { code, itemId, accounts: count });
    return { action: 'needs_relink', itemId, accounts: count };
  }

  if (code === 'LOGIN_REPAIRED' || code === 'NEW_ACCOUNTS_AVAILABLE') {
    const count = await clearLinkStatusByItemId(itemId);
    if (count) {
      console.info('[plaid/webhook] cleared needs_relink', { code, itemId, accounts: count });
    }
    return { action: 'cleared_relink', itemId, accounts: count };
  }

  if (code === 'ERROR') {
    if (itemErrorNeedsRelink(error)) {
      const count = await markAccountsNeedsRelinkByItemId(itemId);
      console.warn('[plaid/webhook] item error needs relink', { itemId, accounts: count });
      return { action: 'needs_relink', itemId, accounts: count };
    }
    console.warn('[plaid/webhook] item error', {
      itemId,
      errorCode: error?.error_code,
      errorType: error?.error_type,
    });
    return { action: 'logged_error', itemId };
  }

  return { action: 'noop', code, itemId };
}

router.post('/', async (req, res) => {
  const verification = req.headers['plaid-verification'];
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

  try {
    const verified = await plaid.verifyPlaidWebhook(rawBody, verification);
    if (!verified.ok) {
      console.warn('[plaid/webhook] verification failed:', verified.reason);
      return res.status(401).json({ error: 'WEBHOOK_VERIFICATION_FAILED' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'INVALID_JSON' });
    }

    const { webhook_type: type } = payload;

    if (type === 'ITEM') {
      await handleItemWebhook(payload);
    } else {
      console.info('[plaid/webhook] unhandled type', { type, code: payload.webhook_code });
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[plaid/webhook]', err.message);
    res.status(500).json({ error: 'WEBHOOK_HANDLER_ERROR' });
  }
});

module.exports = router;
