#!/usr/bin/env node
/**
 * Unit checks for production CORS canonical origin + allowlist expansion.
 * Run: node scripts/test-cors-origins.js
 */
'use strict';

const {
  productionCanonicalOrigin,
  corsOrigins,
} = require('../src/utils/cors-origins');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

check(
  productionCanonicalOrigin({
    clientOrigin: 'http://monterorentals.com',
    nodeEnv: 'development',
  }) === null,
  'non-production → null canonical'
);

check(
  productionCanonicalOrigin({
    clientOrigin: 'http://localhost:5173',
    nodeEnv: 'production',
  }) === null,
  'production localhost CLIENT_ORIGIN → null'
);

check(
  productionCanonicalOrigin({
    clientOrigin: 'http://127.0.0.1:5173',
    nodeEnv: 'production',
  }) === null,
  'production loopback CLIENT_ORIGIN → null'
);

check(
  productionCanonicalOrigin({
    clientOrigin: 'http://monterorentals.com',
    nodeEnv: 'production',
  }) === 'https://www.monterorentals.com',
  'production bare http → https+www'
);

check(
  productionCanonicalOrigin({
    clientOrigin: 'https://www.monterorentals.com/',
    nodeEnv: 'production',
  }) === 'https://www.monterorentals.com',
  'already-www https stays canonical origin'
);

check(
  productionCanonicalOrigin({
    clientOrigin: 'not a url',
    nodeEnv: 'production',
  }) === null,
  'invalid CLIENT_ORIGIN → null'
);

check(
  productionCanonicalOrigin({
    clientOrigin: undefined,
    nodeEnv: 'production',
  }) === null,
  'missing CLIENT_ORIGIN → null'
);

const set = corsOrigins({ clientOrigin: 'http://monterorentals.com' });
check(set.has('http://monterorentals.com'), 'cors includes base');
check(set.has('http://www.monterorentals.com'), 'cors adds www http');
check(set.has('https://monterorentals.com'), 'cors adds https bare');
check(set.has('https://www.monterorentals.com'), 'cors adds https www');

const wwwBase = corsOrigins({ clientOrigin: 'https://www.monterorentals.com' });
check(wwwBase.has('https://monterorentals.com'), 'www base also allows bare https');
check(wwwBase.has('https://www.monterorentals.com'), 'www base keeps www https');

const local = corsOrigins({ clientOrigin: undefined });
check(local.has('http://localhost:5173'), 'default cors origin is Vite localhost');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll cors-origins checks passed.');
