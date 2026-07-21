/**
 * Local QA runner — smoke-test → test-comms → test-late-fees sequentially.
 *
 * Reads test passwords from env (see qa-bootstrap-local for a copy-paste block).
 * Clears /auth rate limit before running unless --skip-reset-auth is passed.
 *
 * Usage:
 *   npm run qa:local
 *   npm run qa:local -- --skip-reset-auth
 *   SMOKE_TEST_PASSWORD=YOUR_GENERATED_PASSWORD npm run qa:local
 *
 * Env (defaults shown):
 *   API_URL=http://localhost:8080
 *   SMOKE_TEST_PASSWORD / SMOKE_TEST_MANAGER_PASSWORD / SMOKE_TEST_TENANT_PASSWORD
 *   DEV_TOOLS_SECRET (optional, for rate-limit reset)
 */

require('../src/config/env');

const { spawnSync } = require('child_process');
const path = require('path');

const BASE = process.env.API_URL || 'http://localhost:8080';
const skipReset = process.argv.includes('--skip-reset-auth');

const SUITES = [
  { name: 'smoke-test', file: 'smoke-test.js' },
  { name: 'test-comms', file: 'test-comms.js' },
  { name: 'test-late-fees', file: 'test-late-fees.js' },
];

function isProductionUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.includes('monterorentals.com') || u.hostname.includes('railway.app');
  } catch {
    return false;
  }
}

function runNodeScript(filename) {
  const scriptPath = path.join(__dirname, filename);
  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    env: { ...process.env, API_URL: BASE },
  });
  return result.status ?? 1;
}

function main() {
  if (isProductionUrl(BASE)) {
    console.error('Refusing to run local QA against production URL:', BASE);
    console.error('Unset API_URL or set it to http://localhost:8080');
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  LOCAL QA RUNNER                                     ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  API_URL: ${BASE}`);
  console.log(`  Staff PW: ${process.env.SMOKE_TEST_PASSWORD || '(default from scripts)'}`);
  console.log(`  Tenant PW: ${process.env.SMOKE_TEST_TENANT_PASSWORD || '(default from scripts)'}`);
  console.log('');

  if (!skipReset) {
    console.log('── Reset auth rate limit ──');
    const resetStatus = runNodeScript('dev-reset-auth-limit.js');
    if (resetStatus !== 0) {
      console.warn('  (rate limit reset skipped or failed — continuing anyway)\n');
    } else {
      console.log('');
    }
  } else {
    console.log('── Skipping auth rate limit reset (--skip-reset-auth) ──\n');
  }

  const results = [];

  for (const suite of SUITES) {
    console.log(`\n══════════════════════════════════════════════════════`);
    console.log(`  Running ${suite.name}`);
    console.log('══════════════════════════════════════════════════════');
    const code = runNodeScript(suite.file);
    results.push({ name: suite.name, code });
  }

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  QA SUMMARY                                          ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  let allPassed = true;
  for (const { name, code } of results) {
    const ok = code === 0;
    if (!ok) allPassed = false;
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` (exit ${code})`}`);
  }

  console.log('');
  process.exit(allPassed ? 0 : 1);
}

main();
