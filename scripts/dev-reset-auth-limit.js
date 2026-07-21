/**
 * Reset in-memory /auth rate limit on the running local dev server.
 * The limiter lives in the API process — this script calls POST /dev/reset-auth-rate-limit.
 *
 * Usage:
 *   npm run dev:reset-auth-limit
 *   node scripts/dev-reset-auth-limit.js
 *   DEV_TOOLS_SECRET=secret node scripts/dev-reset-auth-limit.js
 *
 * Requires: API server running (npm run dev). Blocked when NODE_ENV=production on the server.
 */

require('../src/config/env');

const http = require('http');
const https = require('https');

const BASE = process.env.API_URL || `http://localhost:${process.env.PORT || 8080}`;

function isProductionUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.includes('monterorentals.com') || u.hostname.includes('railway.app');
  } catch {
    return false;
  }
}

function postReset() {
  const url = new URL('/dev/reset-auth-rate-limit', BASE);
  const body = JSON.stringify({});
  const secret = process.env.DEV_TOOLS_SECRET;
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };
  if (secret) headers['x-dev-tools-secret'] = secret;

  const lib = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  if (isProductionUrl(BASE)) {
    console.error('Refusing to reset rate limit on production URL:', BASE);
    process.exit(1);
  }

  console.log(`POST ${BASE}/dev/reset-auth-rate-limit`);

  try {
    const r = await postReset();
    if (r.status === 200 && r.body?.ok) {
      console.log('✓', r.body.message);
      process.exit(0);
    }
    if (r.status === 404) {
      console.error('✗ Endpoint not found — is the API running with NODE_ENV !== production?');
      console.error('  Start: npm run dev');
      process.exit(1);
    }
    console.error('✗ Reset failed:', r.status, r.body);
    process.exit(1);
  } catch (err) {
    console.error('✗ Could not reach API at', BASE);
    console.error('  Start the server: npm run dev');
    console.error('  Detail:', err.message);
    process.exit(1);
  }
}

main();
