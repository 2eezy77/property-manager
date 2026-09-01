#!/usr/bin/env node
/**
 * Scan org Gmail for owner-bill payment confirmations and check off
 * Owner Finance (Newrez, Vivint, T-Mobile, Dominion/HRSD).
 *
 *   node scripts/run-owner-bill-gmail-sync.js            # dry-run
 *   node scripts/run-owner-bill-gmail-sync.js --apply    # write checklist
 *   APPLY=1 node scripts/run-owner-bill-gmail-sync.js    # same as --apply
 *
 * Production: the API process schedules this (OWNER_BILL_GMAIL_SYNC_ENABLED
 * defaults on). Railway can also hit this script as a one-off:
 *   railway run npm run owner-bills:gmail-sync -- --apply
 */

require('../src/config/env');
const { runOwnerBillGmailSync } = require('../src/services/owner-bill-gmail-scheduler.service');
const { syncOwnerBillsFromGmail } = require('../src/services/owner-bill-gmail.service');
const pool = require('../src/db/client');

const args = process.argv.slice(2);
const apply = args.includes('--apply') || process.env.APPLY === '1';

async function resolveActor() {
  const { rows } = await pool.query(
    `SELECT u.id, u.role, t.org_id, t.gmail_address
       FROM gmail_oauth_tokens t
       JOIN users u ON u.org_id = t.org_id
        AND u.is_active = TRUE
        AND u.role IN ('owner', 'property_manager')
      WHERE t.refresh_token_encrypted IS NOT NULL
      ORDER BY CASE u.role WHEN 'owner' THEN 0 ELSE 1 END, u.created_at ASC
      LIMIT 1`
  );
  return rows[0] || null;
}

async function main() {
  if (apply && !args.includes('--dry-run')) {
    const result = await runOwnerBillGmailSync({ force: true });
    console.log(JSON.stringify(result, null, 2));
    if (result.error) process.exit(1);
    return;
  }

  const actor = await resolveActor();
  if (!actor) {
    console.error('No Gmail-connected owner/manager found.');
    process.exit(1);
  }

  const result = await syncOwnerBillsFromGmail(actor.id, actor.role, {
    apply: false,
    newerThanDays: Number(process.env.OWNER_BILL_GMAIL_SYNC_NEWER_DAYS ?? 120),
    maxMessages: 200,
  });

  console.log(
    `Dry-run org=${result.orgId} scanned=${result.scanned} ` +
      `wouldApply=${result.applied.length} skipped=${result.skipped.length}`
  );
  for (const row of result.applied) {
    console.log(
      `  ${row.category} ${row.confirmation || ''} ${row.postedOn || ''} ${row.id}`
    );
  }
  for (const row of result.skipped.slice(0, 20)) {
    console.log(`  skip ${row.reason} ${row.subject || row.id}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
