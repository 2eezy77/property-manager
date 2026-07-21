/**
 * Org-level property operating bank — joint account for owners (pay manager, expenses).
 */

const pool = require('../db/client');
const plaid = require('./plaid.service');
const stripe = require('./stripe.service');
const { encrypt } = require('../utils/encryption');
const { resolveOrgIdForUser } = require('./site-visits.service');

const BANK_PURPOSE = 'property_operating';

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
    linkedByName: row.linked_by_name?.trim() || null,
    linkedByEmail: row.linked_by_email || null,
  };
}

function bankSummary(row) {
  if (!row) {
    return { linked: false };
  }
  return {
    linked: true,
    institutionName: row.institution_name,
    accountMask: row.account_mask,
    accountName: row.account_name,
    status: row.status,
    linkStatus: row.link_status,
    linkedByName: row.linked_by_name?.trim() || null,
  };
}

async function getPropertyBank(orgId) {
  const { rows } = await pool.query(
    `SELECT ba.id, ba.institution_name, ba.account_name, ba.account_mask,
            ba.account_type, ba.status, ba.link_status, ba.is_default, ba.verified_at, ba.created_at,
            TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS linked_by_name,
            u.email AS linked_by_email
       FROM bank_accounts ba
       LEFT JOIN users u ON u.id = ba.user_id
      WHERE ba.org_id = $1
        AND ba.purpose = $2
        AND ba.status <> 'revoked'
      ORDER BY ba.is_default DESC, ba.created_at DESC
      LIMIT 1`,
    [orgId, BANK_PURPOSE]
  );
  return rows[0] ?? null;
}

async function getPropertyBankForOwner(ownerId) {
  const orgId = await resolveOrgIdForUser(ownerId);
  if (!orgId) {
    const err = new Error('No organization found.');
    err.statusCode = 400;
    throw err;
  }
  const row = await getPropertyBank(orgId);
  return {
    orgId,
    account: bankAccountToJson(row),
    summary: bankSummary(row),
  };
}

async function linkPropertyBank({ ownerId, publicToken, accountId }) {
  if (!publicToken || !accountId) {
    const err = new Error('publicToken and accountId are required.');
    err.statusCode = 400;
    throw err;
  }

  const orgId = await resolveOrgIdForUser(ownerId);
  if (!orgId) {
    const err = new Error('No organization found.');
    err.statusCode = 400;
    throw err;
  }

  const existing = await getPropertyBank(orgId);
  if (existing) {
    const err = new Error(
      'A property operating account is already linked. Remove it first to connect a different account.'
    );
    err.statusCode = 409;
    err.code = 'ALREADY_LINKED';
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [ownerRow] } = await client.query(
      'SELECT email FROM users WHERE id = $1',
      [ownerId]
    );
    if (!ownerRow) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }

    const { accessToken, itemId } = await plaid.exchangePublicToken(publicToken);
    const details = await plaid.getAccountDetails(accessToken, accountId);
    const bankAccountToken = await plaid.createStripeBankAccountToken(accessToken, accountId);

    const stripeCustomerId = await stripe.getOrCreateOrgCustomer(orgId, ownerRow.email);
    const stripeBankAccount = await stripe.attachBankAccount(stripeCustomerId, bankAccountToken);

    await client.query(
      `UPDATE organizations SET stripe_customer_id = $1, updated_at = NOW()
        WHERE id = $2 AND (stripe_customer_id IS NULL OR stripe_customer_id = '')`,
      [stripeCustomerId, orgId]
    );

    const { rows: dup } = await client.query(
      `SELECT id FROM bank_accounts
        WHERE org_id = $1 AND stripe_fingerprint = $2 AND purpose = $3 AND status <> 'revoked'`,
      [orgId, stripeBankAccount.fingerprint, BANK_PURPOSE]
    );
    if (dup.length > 0) {
      await client.query('ROLLBACK');
      const err = new Error('This bank account is already connected for the property.');
      err.statusCode = 409;
      err.code = 'DUPLICATE_ACCOUNT';
      throw err;
    }

    const encryptedToken = encrypt(accessToken);
    const { rows: [newAccount] } = await client.query(
      `INSERT INTO bank_accounts
         (user_id, org_id, purpose, plaid_item_id, plaid_account_id, plaid_access_token_encrypted,
          institution_name, institution_id, account_name, account_mask, account_type,
          stripe_customer_id, stripe_bank_account_id, stripe_fingerprint,
          status, link_status, is_default, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'verified','active',TRUE,NOW())
       RETURNING id, institution_name, account_name, account_mask, account_type,
                 status, is_default, verified_at, created_at`,
      [
        ownerId, orgId, BANK_PURPOSE, itemId, accountId, encryptedToken,
        details.institutionName, details.institutionId,
        details.accountName, details.accountMask, details.accountType,
        stripeCustomerId, stripeBankAccount.id, stripeBankAccount.fingerprint,
      ]
    );

    await client.query('COMMIT');

    const { rows: [withLinker] } = await pool.query(
      `SELECT ba.*, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS linked_by_name, u.email AS linked_by_email
         FROM bank_accounts ba
         LEFT JOIN users u ON u.id = ba.user_id
        WHERE ba.id = $1`,
      [newAccount.id]
    );
    return bankAccountToJson(withLinker);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function removePropertyBank({ ownerId, accountId }) {
  const orgId = await resolveOrgIdForUser(ownerId);
  if (!orgId) {
    const err = new Error('No organization found.');
    err.statusCode = 400;
    throw err;
  }

  const { rows } = await pool.query(
    `SELECT stripe_customer_id, stripe_bank_account_id
       FROM bank_accounts
      WHERE id = $1 AND org_id = $2 AND purpose = $3 AND status <> 'revoked'`,
    [accountId, orgId, BANK_PURPOSE]
  );
  if (!rows[0]) {
    const err = new Error('Property bank account not found.');
    err.statusCode = 404;
    throw err;
  }

  await stripe.detachBankAccount(
    rows[0].stripe_customer_id,
    rows[0].stripe_bank_account_id
  ).catch(() => {});

  await pool.query(
    `UPDATE bank_accounts SET status = 'revoked', updated_at = NOW()
      WHERE id = $1 AND org_id = $2`,
    [accountId, orgId]
  );

  return { message: 'Property operating account removed.' };
}

module.exports = {
  BANK_PURPOSE,
  getPropertyBank,
  getPropertyBankForOwner,
  bankSummary,
  linkPropertyBank,
  removePropertyBank,
};
