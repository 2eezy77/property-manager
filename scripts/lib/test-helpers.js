/**
 * Shared helpers for local QA scripts (smoke-test, test-comms, test-late-fees).
 *
 * Env:
 *   API_URL — default http://localhost:8080
 *   SMOKE_TEST_PASSWORD — owner/staff default
 *   SMOKE_TEST_MANAGER_PASSWORD — manager (defaults to staff PW)
 *   SMOKE_TEST_TENANT_PASSWORD — tenants (defaults to staff PW)
 */

require('../../src/config/env');

const BASE = process.env.API_URL || 'http://localhost:8080';
const httpMod = BASE.startsWith('https') ? require('https') : require('http');


const PW = process.env.SMOKE_TEST_PASSWORD;
if (!PW) {
  console.error('Set SMOKE_TEST_PASSWORD before running smoke/QA scripts.');
  process.exit(1);
}
const MANAGER_PW = process.env.SMOKE_TEST_MANAGER_PASSWORD || PW;
const TENANT_PW = process.env.SMOKE_TEST_TENANT_PASSWORD || PW;

const ACCOUNTS = {
  owner:   { email: 'josemontero2002@gmail.com',           pw: PW },
  manager: { email: 'konstantinhazlett@yahoo.com',         pw: MANAGER_PW },
  tenant1: { email: 'buckleystone1@gmail.com',             pw: TENANT_PW },
  tenant2: { email: 'isaiahreese13@outlook.com',          pw: TENANT_PW },
  tenant3: { email: 'davontayegara95@gmail.com',          pw: TENANT_PW },
};

function createReporter() {
  const state = { passed: 0, failed: 0, skipped: 0, failures: [] };

  function ok(label) {
    state.passed++;
    console.log(`  ✓ ${label}`);
  }

  function fail(label, detail) {
    state.failed++;
    state.failures.push({ label, detail });
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }

  function skip(label, reason) {
    state.skipped++;
    console.log(`  ○ ${label} (${reason})`);
  }

  function printSummary(title = 'RESULTS') {
    const line = `${state.passed} passed · ${state.failed} failed` +
      (state.skipped ? ` · ${state.skipped} skipped` : '');
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log(`║  ${title}: ${line}`.padEnd(55) + '║');
    console.log('╚══════════════════════════════════════════════════════╝');
    if (state.failures.length) {
      console.log('\nFailures:');
      state.failures.forEach((f, i) => {
        console.log(`  ${i + 1}. ${f.label}: ${f.detail || ''}`);
      });
      process.exit(1);
    }
  }

  return { ok, fail, skip, printSummary, get failures() { return state.failures; } };
}

function req(method, path, body, token) {
  const url = new URL(path, BASE);
  const data = body ? JSON.stringify(body) : null;
  const headers = { 'Content-Type': 'application/json' };
  if (data) headers['Content-Length'] = Buffer.byteLength(data);
  if (token) headers.Authorization = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    const r = httpMod.request(
      {
        hostname: url.hostname,
        port: url.port || (BASE.startsWith('https') ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, body: d }); }
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function login(email, password = PW) {
  const r = await req('POST', '/auth/login', { email, password });
  if (r.status !== 200) throw new Error(`Login failed for ${email}: ${JSON.stringify(r.body)}`);
  await new Promise((res) => setTimeout(res, 120));
  return r.body.accessToken;
}

async function section(title, fn) {
  console.log(`\n── ${title} ──`);
  await fn();
}

module.exports = {
  BASE,
  PW,
  TENANT_PW,
  MANAGER_PW,
  ACCOUNTS,
  createReporter,
  req,
  login,
  section,
};
