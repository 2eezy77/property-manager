/**
 * Align local QA passwords and print a PowerShell env block for smoke tests.
 * Never targets production URLs.
 *
 * Usage:
 *   node scripts/qa-bootstrap-local.js              (list accounts + env block)
 *   node scripts/qa-bootstrap-local.js --apply        (set passwords, then print block)
 *   node scripts/qa-bootstrap-local.js --apply --staff-pw YOUR_GENERATED_PASSWORD
 *
 * --apply sets owner + manager only (never tenants unless --include-tenants).
 * Tenants: use Owner -> View as in the portal, or ALLOW_DB_PASSWORD_RESET=1 with --include-tenants.
 * Requires SMOKE_TEST_PASSWORD or --staff-pw (no hardcoded fallback).
 */

require('../src/config/env');

const { spawnSync } = require('child_process');
const path = require('path');

const OWNER = 'josemontero2002@gmail.com';
const MANAGER = 'konstantinhazlett@yahoo.com';
const TENANTS = [
  'buckleystone1@gmail.com',
  'isaiahreese13@outlook.com',
  'davontayegara95@gmail.com',
];
const TENANT_PW = process.env.SMOKE_TEST_TENANT_PASSWORD || 'YOUR_TENANT_PASSWORD';

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const includeTenants = args.includes('--include-tenants');
  const pwIdx = args.indexOf('--staff-pw');
  let staffPw = process.env.SMOKE_TEST_PASSWORD;
  if (pwIdx !== -1 && args[pwIdx + 1]) staffPw = args[pwIdx + 1];
  if (!staffPw) {
    console.error('Set SMOKE_TEST_PASSWORD or pass --staff-pw YOUR_GENERATED_PASSWORD');
    process.exit(1);
  }
  return { apply, includeTenants, staffPw };
}

function runResetPassword(email, password) {
  const script = path.join(__dirname, '../src/db/reset-password.js');
  const result = spawnSync(process.execPath, [script, email, password], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(`Failed to reset ${email}:`, result.stderr || result.stdout);
    return false;
  }
  return true;
}

function printEnvBlock(staffPw, tenantPw) {
  const port = process.env.PORT || '8080';
  console.log('\nAdd to .env.local (Vite auto-login + smoke tests):\n');
  console.log(`PORT=${port}`);
  console.log(`VITE_DEV_LOGIN_EMAIL=${OWNER}`);
  console.log(`VITE_DEV_LOGIN_PASSWORD=${staffPw}`);
  console.log('\nCopy into PowerShell before npm run qa:local or npm run smoke:test:\n');
  console.log(`$env:API_URL='http://localhost:${port}'`);
  console.log(`$env:SMOKE_TEST_PASSWORD='${staffPw}'`);
  console.log(`$env:SMOKE_TEST_MANAGER_PASSWORD='${staffPw}'`);
  console.log(`$env:SMOKE_TEST_TENANT_PASSWORD='${tenantPw}'`);
  console.log('');
}

function main() {
  const { apply, includeTenants, staffPw } = parseArgs();

  if (process.env.API_URL && /monterorentals|railway\.app/i.test(process.env.API_URL)) {
    console.error('Unset production API_URL before running qa-bootstrap-local.');
    process.exit(1);
  }

  if (apply && includeTenants && !process.env.ALLOW_DB_PASSWORD_RESET) {
    console.error(
      'Refusing to reset tenant passwords. Use Owner -> View as instead,\n'
      + 'or: $env:ALLOW_DB_PASSWORD_RESET=1; npm run qa:bootstrap -- --apply --include-tenants'
    );
    process.exit(1);
  }

  console.log('\n── Current accounts (npm run db:reset-password list) ──\n');
  spawnSync(process.execPath, [path.join(__dirname, '../src/db/reset-password.js'), 'list'], {
    stdio: 'inherit',
  });

  if (apply) {
    console.log('\n── Applying local QA passwords ──');
    console.log(`  Staff (owner + manager): ${staffPw}`);
    if (includeTenants) console.log(`  Tenants: ${TENANT_PW}`);
    else console.log('  Tenants: skipped (use --include-tenants to override)');

    let ok = true;
    for (const email of [OWNER, MANAGER]) {
      if (!runResetPassword(email, staffPw)) ok = false;
      else console.log(`  ✓ ${email}`);
    }
    if (includeTenants) {
      for (const email of TENANTS) {
        if (!runResetPassword(email, TENANT_PW)) ok = false;
        else console.log(`  ✓ ${email}`);
      }
    }
    if (!ok) process.exit(1);
  } else {
    console.log('\nDry run — pass --apply to set staff passwords (tenants skipped).');
    console.log(`  Would set staff → ${staffPw}`);
    console.log('  Tenants: use View as, or --apply --include-tenants with ALLOW_DB_PASSWORD_RESET=1');
  }

  printEnvBlock(staffPw, includeTenants ? TENANT_PW : '(use View as — no tenant password)');
}

main();
