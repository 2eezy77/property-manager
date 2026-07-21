#!/usr/bin/env node
/**
 * Payments stack health check — Stripe, Plaid, webhooks, tenant readiness.
 *
 *   npm run payments:health
 *   npm run payments:health -- --json
 *   npm run payments:health -- --skip-stripe   # env + DB only (offline)
 */
require('../src/config/env');
const pool = require('../src/db/client');
const { runPaymentsHealth } = require('../src/services/payments-health.service');

const JSON_OUT = process.argv.includes('--json');
const SKIP_STRIPE = process.argv.includes('--skip-stripe');
const SKIP_PLAID = process.argv.includes('--skip-plaid');
const SKIP_DB = process.argv.includes('--skip-db');

function printHuman(report) {
  const icon = { pass: '✓', warn: '⚠', fail: '✗' };
  console.log(`\nPayments health — ${report.ok ? 'OK' : 'ISSUES FOUND'}`);
  console.log(`Checked: ${report.checkedAt}`);
  console.log(`Pass ${report.summary.pass} · Warn ${report.summary.warn} · Fail ${report.summary.fail}\n`);

  let lastCat = '';
  for (const c of report.checks) {
    if (c.category !== lastCat) {
      console.log(`[${c.category.toUpperCase()}]`);
      lastCat = c.category;
    }
    console.log(`  ${icon[c.status] || '?'} ${c.message}`);
    if (c.fix) console.log(`      → ${c.fix}`);
    if (c.tenants?.length) {
      for (const t of c.tenants.slice(0, 8)) {
        const label = typeof t === 'string' ? t : `${t.email || t.name} (${t.unit || ''})`.trim();
        console.log(`      · ${label}`);
      }
    }
    if (c.endpoints?.length) {
      for (const url of c.endpoints) console.log(`      · ${url}`);
    }
  }
  console.log('');
}

async function main() {
  const report = await runPaymentsHealth({
    skipStripeProbe: SKIP_STRIPE,
    skipPlaidProbe: SKIP_PLAID,
    skipDatabase: SKIP_DB,
  });

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }

  await pool.end();
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
