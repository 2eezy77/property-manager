/**
 * Probe Plaid Signal on a linked production Item.
 * Usage: PLAID_SIGNAL_RULESET_KEY=your-key node scripts/plaid-signal-probe.js
 */
require('../src/config/env');
const pool = require('../src/db/client');
const { decrypt } = require('../src/utils/encryption');
const plaid = require('../src/services/plaid.service');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

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
  console.log('PLAID_SIGNAL_ENABLED:', process.env.PLAID_SIGNAL_ENABLED || 'false');
  console.log('PLAID_SIGNAL_RULESET_KEY:', process.env.PLAID_SIGNAL_RULESET_KEY ? '(set)' : 'MISSING');
  console.log('PLAID_BALANCE_CHECK_ENABLED:', process.env.PLAID_BALANCE_CHECK_ENABLED || 'false');
  console.log('');

  const { rows } = await pool.query(
    `SELECT ba.purpose, ba.plaid_account_id, ba.plaid_access_token_encrypted, u.email
       FROM bank_accounts ba
       LEFT JOIN users u ON u.id = ba.user_id
      WHERE ba.status = 'verified' AND ba.plaid_item_id IS NOT NULL
      ORDER BY ba.created_at DESC
      LIMIT 1`
  );
  if (!rows[0]) {
    console.log('No verified Plaid account to probe.');
    return;
  }

  const token = decrypt(rows[0].plaid_access_token_encrypted);
  const accountId = rows[0].plaid_account_id;
  console.log('Probing account:', rows[0].purpose, rows[0].email || '(n/a)');

  try {
    const { data } = await client.signalPrepare({ access_token: token });
    console.log('[ok] signalPrepare', data.request_id);
  } catch (err) {
    const d = err.response?.data;
    console.log('[fail] signalPrepare', d?.error_code || err.message, d?.error_message || '');
  }

  if (!process.env.PLAID_SIGNAL_RULESET_KEY) {
    console.log('\nSet PLAID_SIGNAL_RULESET_KEY (from Plaid Dashboard → Signal → Rules) and re-run.');
    return;
  }

  try {
    const signal = await plaid.evaluateAchRisk(token, accountId, 10000, {
      userId: 'probe-user',
      clientTransactionId: `probe-${Date.now()}`,
    });
    console.log('[ok] signalEvaluate', signal);
  } catch (err) {
    const d = err.response?.data;
    console.log('[fail] signalEvaluate', d?.error_code || err.message, d?.error_message || '');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
