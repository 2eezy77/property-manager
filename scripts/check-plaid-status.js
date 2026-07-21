/**
 * One-off: verify linked Plaid Items in DB against Plaid API.
 * Usage: node scripts/check-plaid-status.js
 */
require('../src/config/env');
const pool = require('../src/db/client');
const { decrypt } = require('../src/utils/encryption');
const { Configuration, PlaidApi, PlaidEnvironments, CountryCode } = require('plaid');

const client = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV ?? 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
}));

async function main() {
  console.log('PLAID_ENV:', process.env.PLAID_ENV || '(unset)');
  const { rows } = await pool.query(
    `SELECT ba.id, ba.purpose, ba.institution_name, ba.account_mask, ba.status,
            ba.plaid_item_id, ba.plaid_access_token_encrypted, ba.created_at,
            u.email
       FROM bank_accounts ba
       LEFT JOIN users u ON u.id = ba.user_id
      WHERE ba.status <> 'revoked'
        AND ba.plaid_item_id IS NOT NULL
      ORDER BY ba.created_at DESC`
  );

  if (rows.length === 0) {
    console.log('No Plaid-linked bank_accounts in database.');
    return;
  }

  console.log(`Found ${rows.length} linked account(s):\n`);

  for (const row of rows) {
    console.log('─'.repeat(50));
    console.log('Purpose:     ', row.purpose || 'tenant_rent');
    console.log('Institution: ', row.institution_name, `····${row.account_mask}`);
    console.log('User:        ', row.email || '(n/a)');
    console.log('DB status:   ', row.status);
    console.log('Item ID:     ', row.plaid_item_id);
    console.log('Linked at:   ', row.created_at);

    try {
      const token = decrypt(row.plaid_access_token_encrypted);
      const { data } = await client.itemGet({ access_token: token });
      const item = data.item;
      let instName = item.institution_id || 'unknown';
      if (item.institution_id) {
        try {
          const ir = await client.institutionsGetById({
            institution_id: item.institution_id,
            country_codes: [CountryCode.Us],
          });
          instName = ir.data.institution.name;
        } catch { /* ignore */ }
      }

      const auth = await client.authGet({ access_token: token });
      const err = item.error;

      console.log('Plaid inst:   ', instName);
      console.log('Products:    ', (item.products || []).join(', ') || '(none)');
      console.log('Billed:      ', (item.billed_products || []).join(', ') || '(none)');
      console.log('Item health: ', err ? `ERROR ${err.error_code}: ${err.error_message}` : 'OK');
      console.log('Auth accts:  ', auth.data.accounts.map((a) => `${a.name} ····${a.mask}`).join('; '));
    } catch (e) {
      const msg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      console.log('Plaid API:   FAILED —', msg);
    }
    console.log('');
  }
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    pool.end();
    process.exit(1);
  });
