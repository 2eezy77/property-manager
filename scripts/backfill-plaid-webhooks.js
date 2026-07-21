/**
 * Register PLAID_WEBHOOK_URL on existing linked Items (one Plaid call per item_id).
 *
 *   node scripts/backfill-plaid-webhooks.js           # dry-run
 *   node scripts/backfill-plaid-webhooks.js --apply   # call Plaid item/webhook/update
 */
require('../src/config/env');
const pool = require('../src/db/client');
const { decrypt } = require('../src/utils/encryption');
const plaid = require('../src/services/plaid.service');

async function main() {
  const apply = process.argv.includes('--apply');
  const webhookUrl = plaid.getPlaidWebhookUrl();
  if (!webhookUrl) {
    console.error('Set PLAID_WEBHOOK_URL (e.g. https://www.monterorentals.com/webhooks/plaid)');
    process.exit(1);
  }

  console.log('PLAID_ENV:', process.env.PLAID_ENV || '(unset)');
  console.log('Webhook URL:', webhookUrl);
  console.log(apply ? 'Mode: APPLY\n' : 'Mode: dry-run (pass --apply to update)\n');

  const { rows } = await pool.query(
    `SELECT DISTINCT ON (ba.plaid_item_id)
            ba.plaid_item_id,
            ba.plaid_access_token_encrypted,
            ba.institution_name,
            ba.account_mask,
            ba.purpose,
            u.email
       FROM bank_accounts ba
       LEFT JOIN users u ON u.id = ba.user_id
      WHERE ba.status <> 'revoked'
        AND ba.plaid_item_id IS NOT NULL
      ORDER BY ba.plaid_item_id, ba.created_at DESC`
  );

  if (rows.length === 0) {
    console.log('No Plaid-linked bank accounts found.');
    return;
  }

  let ok = 0;
  let fail = 0;

  for (const row of rows) {
    const label = `${row.plaid_item_id} · ${row.institution_name || '?'} ····${row.account_mask || '?'} · ${row.email || row.purpose || 'n/a'}`;
    if (!apply) {
      console.log('[dry-run]', label);
      continue;
    }
    try {
      const token = decrypt(row.plaid_access_token_encrypted);
      await plaid.updateItemWebhook(token, webhookUrl);
      console.log('[ok]', label);
      ok += 1;
    } catch (err) {
      const msg = err.response?.data?.error_message || err.message;
      console.error('[fail]', label, '—', msg);
      fail += 1;
    }
  }

  if (apply) {
    console.log(`\nDone: ${ok} updated, ${fail} failed (${rows.length} item(s)).`);
  } else {
    console.log(`\nWould update ${rows.length} item(s). Re-run with --apply.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
