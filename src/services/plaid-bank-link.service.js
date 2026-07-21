/**
 * Complete Plaid Link update mode (re-auth) — refresh access token, clear needs_relink.
 */

const pool = require('../db/client');
const plaid = require('./plaid.service');
const { encrypt } = require('../utils/encryption');

async function loadBankAccountForUser(bankAccountId, userId) {
  const { rows } = await pool.query(
    `SELECT id, user_id, plaid_item_id, plaid_access_token_encrypted, status, link_status
       FROM bank_accounts
      WHERE id = $1 AND user_id = $2 AND status <> 'revoked'`,
    [bankAccountId, userId]
  );
  return rows[0] ?? null;
}

async function loadOrgPropertyBank(bankAccountId, ownerId) {
  const { rows } = await pool.query(
    `SELECT ba.id, ba.user_id, ba.org_id, ba.plaid_access_token_encrypted, ba.status, ba.link_status
       FROM bank_accounts ba
       JOIN users u ON u.org_id = ba.org_id
      WHERE ba.id = $1
        AND u.id = $2
        AND ba.purpose = 'property_operating'
        AND ba.status <> 'revoked'`,
    [bankAccountId, ownerId]
  );
  return rows[0] ?? null;
}

async function loadManagerPayoutBank(bankAccountId, managerId) {
  const { rows } = await pool.query(
    `SELECT id, user_id, plaid_access_token_encrypted, status, link_status
       FROM bank_accounts
      WHERE id = $1 AND user_id = $2 AND purpose = 'manager_payout' AND status <> 'revoked'`,
    [bankAccountId, managerId]
  );
  return rows[0] ?? null;
}

async function createUpdateLinkTokenForAccount({ userId, bankAccountId, scope = 'tenant' }) {
  let row;
  if (scope === 'owner_property') {
    row = await loadOrgPropertyBank(bankAccountId, userId);
  } else if (scope === 'manager_payout') {
    row = await loadManagerPayoutBank(bankAccountId, userId);
  } else {
    row = await loadBankAccountForUser(bankAccountId, userId);
  }

  if (!row) {
    const err = new Error('Bank account not found.');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  const { decrypt } = require('../utils/encryption');
  const accessToken = decrypt(row.plaid_access_token_encrypted);
  const linkToken = await plaid.createLinkToken(userId, { updateMode: true, accessToken });
  return { linkToken, bankAccountId: row.id, linkStatus: row.link_status };
}

async function completePlaidLinkUpdate({ userId, bankAccountId, publicToken, scope = 'tenant' }) {
  let row;
  if (scope === 'owner_property') {
    row = await loadOrgPropertyBank(bankAccountId, userId);
  } else if (scope === 'manager_payout') {
    row = await loadManagerPayoutBank(bankAccountId, userId);
  } else {
    row = await loadBankAccountForUser(bankAccountId, userId);
  }

  if (!row) {
    const err = new Error('Bank account not found.');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  const { accessToken, itemId } = await plaid.exchangePublicToken(publicToken);
  const encryptedToken = encrypt(accessToken);

  const { rows: [updated] } = await pool.query(
    `UPDATE bank_accounts
        SET plaid_access_token_encrypted = $1,
            plaid_item_id = COALESCE($2, plaid_item_id),
            link_status = 'active',
            status = CASE WHEN status = 'failed' THEN 'verified' ELSE status END,
            verified_at = COALESCE(verified_at, NOW()),
            updated_at = NOW()
      WHERE id = $3
      RETURNING id, institution_name, account_name, account_mask, account_type,
                stripe_bank_account_id, status, is_default, link_status, verified_at`,
    [encryptedToken, itemId, row.id]
  );

  return updated;
}

async function markAccountsNeedsRelinkByItemId(itemId) {
  const { rowCount } = await pool.query(
    `UPDATE bank_accounts
        SET link_status = 'needs_relink', updated_at = NOW()
      WHERE plaid_item_id = $1 AND status <> 'revoked' AND link_status <> 'needs_relink'`,
    [itemId]
  );
  return rowCount ?? 0;
}

async function clearLinkStatusByItemId(itemId) {
  const { rowCount } = await pool.query(
    `UPDATE bank_accounts
        SET link_status = 'active', updated_at = NOW()
      WHERE plaid_item_id = $1 AND link_status = 'needs_relink'`,
    [itemId]
  );
  return rowCount ?? 0;
}

module.exports = {
  createUpdateLinkTokenForAccount,
  completePlaidLinkUpdate,
  markAccountsNeedsRelinkByItemId,
  clearLinkStatusByItemId,
};
