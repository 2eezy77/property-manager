/**
 * Recalculate utility splits using lease occupancy days (move-in proration).
 *
 *   node scripts/recalculate-utility-splits.js           # dry-run
 *   node scripts/recalculate-utility-splits.js --apply
 */
require('../src/config/env');
const pool = require('../src/db/client');
const { executeRecalculateSplits } = require('../src/use-cases/utilities/uc-recalculate-splits');

const APPLY = process.argv.includes('--apply');
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'josemontero2002@gmail.com';

async function main() {
  if (!APPLY) {
    console.log('Dry-run not supported — this script applies changes. Use Utilities → Calculate tenant shares, or pass --apply.');
    await pool.end();
    return;
  }

  const { rows: [owner] } = await pool.query(
    `SELECT id, role FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [OWNER_EMAIL]
  );
  if (!owner) {
    console.error(`Owner not found: ${OWNER_EMAIL}`);
    process.exit(1);
  }

  const result = await executeRecalculateSplits({ userId: owner.id, role: owner.role });
  for (const b of result.bills || []) {
    console.log(`\n${b.service_type} ${b.period_start} → ${b.period_end} ($${b.total_amount})`);
    for (const t of b.tenants || []) {
      const tag = t.prorated
        ? `prorated ${t.occupancy_days}/${t.bill_days}d from ${t.effective_start}`
        : 'full period';
      console.log(`  ${t.name}: $${t.amount} — ${tag}`);
    }
  }
  console.log('\nPolicy:', result.collectible_policy);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
