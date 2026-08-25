#!/usr/bin/env node
/**
 * Unit checks for email portal origin (never localhost in outbound links).
 * Run: node scripts/test-portal-origin.js
 */
'use strict';

const { resolvePortalOrigin } = require('../src/services/email-templates/brand');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const prev = process.env.CLIENT_ORIGIN;

process.env.CLIENT_ORIGIN = 'http://localhost:5173';
check(
  resolvePortalOrigin() === 'https://www.monterorentals.com',
  'localhost CLIENT_ORIGIN rewrites to production www'
);

process.env.CLIENT_ORIGIN = 'http://127.0.0.1:3000/';
check(
  resolvePortalOrigin() === 'https://www.monterorentals.com',
  'loopback CLIENT_ORIGIN rewrites to production www'
);

process.env.CLIENT_ORIGIN = 'https://staging.example.com/';
check(
  resolvePortalOrigin() === 'https://staging.example.com',
  'non-local origin kept with trailing slash stripped'
);

process.env.CLIENT_ORIGIN = 'https://www.monterorentals.com';
check(
  resolvePortalOrigin() === 'https://www.monterorentals.com',
  'production www preserved'
);

delete process.env.CLIENT_ORIGIN;
check(
  resolvePortalOrigin() === 'https://www.monterorentals.com',
  'missing CLIENT_ORIGIN defaults to production www'
);

if (prev === undefined) delete process.env.CLIENT_ORIGIN;
else process.env.CLIENT_ORIGIN = prev;

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll portal-origin checks passed.');
