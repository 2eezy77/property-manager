/**
 * Call Plaid signal/prepare on all linked Items (run once when enabling Signal).
 *
 *   node scripts/plaid-signal-prepare-all.js           # dry-run
 *   node scripts/plaid-signal-prepare-all.js --apply
 */
require('../src/config/env');
const pool = require('../src/db/client');
const { decrypt } = require('../src/utils/encryption');
const plaid = require('../src/services/plaid.service');

async function main() {
  const apply = process.argv.includes('--apply');

  const { rows } = await pool.query(
    `SELECT DISTINCT ON (ba.plaid_item_id)
            ba.plaid_item_id, ba.plaid_access_token_encrypted, ba.purpose, u.email
       FROM bank_accounts ba
       LEFT JOIN users u ON u.id = ba.user_id
      WHERE ba.status <> 'revoked' AND ba.plaid_item_id IS NOT NULL
      ORDER BY ba.plaid_item_id, ba.created_at DESC`
  );

  if (rows.length === 0) {
    console.log('No Plaid items found.');
    return;
  }

  console.log(apply ? 'Mode: APPLY\n' : 'Mode: dry-run\n');

  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    const label = `${row.plaid_item_id} · ${row.purpose} · ${row.email || 'n/a'}`;
    if (!apply) {
      console.log('[dry-run]', label);
      continue;
    }
    try {
      const token = decrypt(row.plaid_access_token_encrypted);
      await plaid.prepareSignalForItem(token);
      console.log('[ok]', label);
      ok += 1;
    } catch (err) {
      console.log('[fail]', label, err.response?.data?.error_code || err.message);
      fail += 1;
    }
  }

  if (apply) console.log(`\nDone: ${ok} prepared, ${fail} failed.`);
  else console.log(`\nWould prepare ${rows.length} item(s). Re-run with --apply.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
