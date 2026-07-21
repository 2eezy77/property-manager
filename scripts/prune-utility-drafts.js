#!/usr/bin/env node
/** Remove duplicate draft utility bills. Usage: node scripts/prune-utility-drafts.js [--apply] */
require('../src/config/env');
const pool = require('../src/db/client');
const {
  executePruneDuplicateDrafts,
  executePruneStaleDrafts,
} = require('../src/use-cases/utilities/uc-delete-draft-bill');

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'josemontero2002@gmail.com';
const APPLY = process.argv.includes('--apply');

async function main() {
  const { rows: [owner] } = await pool.query(
    `SELECT id, role FROM users WHERE LOWER(email) = LOWER($1)`,
    [OWNER_EMAIL]
  );
  if (!owner) {
    console.error('Owner not found');
    process.exit(1);
  }

  const { rows: before } = await pool.query(
    `SELECT id, service_type, period_start, period_end, total_amount, status
       FROM utility_bills ORDER BY period_end DESC`
  );
  console.log(`Bills before: ${before.length}`);
  before.forEach((b) => {
    console.log(`  ${b.status} ${b.service_type} ${b.period_start}..${b.period_end} $${b.total_amount}`);
  });

  if (!APPLY) {
    console.log('\nDry run — pass --apply to delete duplicate drafts.');
    await pool.end();
    return;
  }

  const dupes = await executePruneDuplicateDrafts({ userId: owner.id, role: owner.role });
  const stale = await executePruneStaleDrafts({ userId: owner.id, role: owner.role });
  console.log('\nPrune result:', { duplicates: dupes.removed, stale: stale.removed });

  const { rows: after } = await pool.query(
    `SELECT id, service_type, period_start, period_end, total_amount, status
       FROM utility_bills ORDER BY period_end DESC`
  );
  console.log(`Bills after: ${after.length}`);
  after.forEach((b) => {
    console.log(`  ${b.status} ${b.service_type} ${b.period_start}..${b.period_end} $${b.total_amount}`);
  });

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
