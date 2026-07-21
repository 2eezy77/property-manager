#!/usr/bin/env node
/**
 * Import Cash App rent from CSV or org Gmail into payment history.
 *
 *   node scripts/import-cashapp-payments.js              # dry-run CSV (default)
 *   node scripts/import-cashapp-payments.js --apply      # write CSV plan to DB
 *   node scripts/import-cashapp-payments.js --gmail        # dry-run Gmail
 *   node scripts/import-cashapp-payments.js --gmail --apply
 *   node scripts/import-cashapp-payments.js --csv path
 */

require('../src/config/env');
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/client');
const {
  buildImportPlan,
  load743CashAppTenants,
  applyCashAppImportPlan,
} = require('../src/services/cashapp-import.service');
const { syncCashAppFromGmail } = require('../src/services/cashapp-gmail.service');

const DEFAULT_CSV = path.join(
  process.env.USERPROFILE || '',
  'OneDrive',
  'finance',
  'rental',
  '743-a-ave-2025',
  'cash_app_report_1775524236052.csv'
);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const useGmail = args.includes('--gmail');

function argAfter(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

const csvPath = argAfter('--csv') || DEFAULT_CSV;
const stoneCsvPath = argAfter('--stone-csv');
const isaiahCsvPath = argAfter('--isaiah-csv');
const usePerTenantCsv = Boolean(stoneCsvPath || isaiahCsvPath);

function fmtMoney(n) {
  return `$${Number(n).toFixed(2)}`;
}

function printPlan(plan, sourceLabel) {
  console.log(`\nCash App import plan (${sourceLabel})\n`);
  console.log(`${sourceLabel}\n`);

  if (plan.warnings.length) {
    console.log('Warnings:');
    plan.warnings.forEach((w) => console.log(`  ! ${w}`));
    console.log('');
  }

  for (const t of plan.tenants) {
    console.log(`── ${t.name}  (${fmtMoney(t.monthlyRent)}/mo) ──`);
    console.log(`   Raw Cash App lines: ${t.rawPayments.length}  (${fmtMoney(t.rawPayments.reduce((s, p) => s + p.amount, 0))} total)`);

    for (const m of t.months) {
      const partSummary = m.parts
        .map((p) => `${p.dateIso} ${fmtMoney(p.amount)} ${p.transactionId}`)
        .join('; ');
      console.log(`   ✓ ${m.periodLabel}: ${fmtMoney(m.amount)} paid ${m.paidAt}`);
      console.log(`     ${partSummary}`);
    }

    if (t.unallocated.length) {
      console.log('   Partial / prepayment:');
      for (const u of t.unallocated) {
        if (u.type === 'partial_month') {
          const parts = u.parts.map((p) => `${p.dateIso} ${fmtMoney(p.amount)} ${p.transactionId}`).join('; ');
          console.log(`     • ${u.month}: ${fmtMoney(u.amount)} toward ${fmtMoney(u.expected)} rent`);
          console.log(`       ${parts}`);
        }
      }
    }

    if (t.depositCredits?.length) {
      const depTotal = t.depositCredits.reduce((s, p) => s + p.amount, 0);
      console.log(`   Security deposit credits: ${fmtMoney(depTotal)}`);
      for (const d of t.depositCredits) {
        console.log(`     • ${d.dateIso} ${fmtMoney(d.amount)} ${d.transactionId} — ${d.notes || 'deposit'}`);
      }
    }
    console.log('');
  }
}

function buildFullPlan(tenants) {
  if (usePerTenantCsv) {
    const plan = { tenants: [], warnings: [] };
    const paths = { stone: stoneCsvPath, isaiah: isaiahCsvPath };

    for (const key of ['stone', 'isaiah']) {
      const filePath = paths[key];
      if (!filePath) {
        plan.warnings.push(`Missing --${key}-csv (skipping ${key})`);
        continue;
      }
      if (!fs.existsSync(filePath)) {
        plan.warnings.push(`CSV not found: ${filePath}`);
        continue;
      }
      const tenant = tenants.find((t) => t.cashAppKey === key);
      if (!tenant) {
        plan.warnings.push(`No active lease for Cash App key "${key}"`);
        continue;
      }
      const sub = buildImportPlan({ csvPath: filePath, tenants: [tenant], senderKeys: [key] });
      plan.tenants.push(...sub.tenants);
      plan.warnings.push(...sub.warnings);
    }
    return plan;
  }

  return buildImportPlan({ csvPath, tenants });
}

async function ownerForGmail() {
  const { rows } = await pool.query(
    `SELECT id, role FROM users WHERE email = 'josemontero2002@gmail.com' LIMIT 1`
  );
  if (!rows[0]) throw new Error('Owner account not found for Gmail sync');
  return rows[0];
}

async function main() {
  if (useGmail) {
    const owner = await ownerForGmail();
    const result = await syncCashAppFromGmail(owner.id, owner.role, { apply });
    printPlan(result.plan, `Gmail (${result.paymentCount} payment emails)`);
    if (result.unparsed?.length) {
      console.log(`Unparsed emails: ${result.unparsed.length}`);
    }
    if (!apply) {
      console.log('Dry run only. Re-run with --gmail --apply to import.\n');
      await pool.end();
      return;
    }
    console.log(
      `\nDone: ${result.inserted} imported, ${result.synced} synced, ${result.skipped} skipped, ${result.cleared} cleared.`
    );
    if (result.depositApplied) {
      console.log(`Deposit credits applied: $${Number(result.depositApplied).toFixed(2)}`);
      for (const d of result.depositResults || []) {
        console.log(
          `  ${d.name}: applied $${Number(d.applied || 0).toFixed(2)}` +
            (d.remaining != null ? ` · still owed $${Number(d.remaining).toFixed(2)}` : '') +
            (d.warning ? ` (${d.warning})` : '')
        );
      }
    }
    console.log('');
    await pool.end();
    return;
  }

  if (!usePerTenantCsv && !fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    console.error('Use --gmail to pull from org Gmail instead.');
    process.exit(1);
  }

  const tenants = await load743CashAppTenants(pool);
  if (!tenants.length) {
    console.error('No active 743 tenants with Cash App name mapping.');
    process.exit(1);
  }

  const plan = buildFullPlan(tenants);
  if (!plan.tenants.length) {
    console.error('No import plan built — check CSV paths and warnings.');
    process.exit(1);
  }
  printPlan(plan, usePerTenantCsv ? 'per-tenant CSV' : `CSV: ${csvPath}`);

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to import.\n');
    await pool.end();
    return;
  }

  const result = await applyCashAppImportPlan(pool, plan);
  console.log(
    `\nDone: ${result.inserted} imported, ${result.synced} synced, ${result.skipped} skipped, ${result.cleared} cleared.\n`
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
