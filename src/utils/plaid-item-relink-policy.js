/**
 * Pure Plaid Item webhook policy: when to mark bank links needs_relink vs clear.
 * Kept free of Express / DB so unit tests stay deterministic.
 */

const NEEDS_RELINK_CODES = new Set([
  'PENDING_EXPIRATION',
  'USER_PERMISSION_REVOKED',
]);

function itemErrorNeedsRelink(error) {
  if (!error) return false;
  const code = error.error_code || error.errorCode;
  return code === 'ITEM_LOGIN_REQUIRED';
}

/**
 * Decide the Item webhook action without touching the database.
 * @returns {{ action: string, reason?: string, code?: string }}
 */
function classifyItemWebhook({ webhook_code: code, item_id: itemId, error } = {}) {
  if (!itemId) return { action: 'ignored', reason: 'no_item_id' };

  if (NEEDS_RELINK_CODES.has(code) || itemErrorNeedsRelink(error)) {
    return { action: 'needs_relink' };
  }

  if (code === 'LOGIN_REPAIRED' || code === 'NEW_ACCOUNTS_AVAILABLE') {
    return { action: 'cleared_relink' };
  }

  if (code === 'ERROR') {
    // ITEM_LOGIN_REQUIRED is already handled above; other errors are log-only.
    if (itemErrorNeedsRelink(error)) return { action: 'needs_relink' };
    return { action: 'logged_error' };
  }

  return { action: 'noop', code };
}

module.exports = {
  NEEDS_RELINK_CODES,
  itemErrorNeedsRelink,
  classifyItemWebhook,
};
