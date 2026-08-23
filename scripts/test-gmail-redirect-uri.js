#!/usr/bin/env node
/**
 * Gmail OAuth redirect URI hardening for production.
 * Run: node scripts/test-gmail-redirect-uri.js
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/test';

const assert = require('assert');
const { normalizeProductionRedirectUri } = require('../src/services/gmail.service');

const prevEnv = process.env.NODE_ENV;

process.env.NODE_ENV = 'development';
assert.strictEqual(
  normalizeProductionRedirectUri('http://monterorentals.com/api/utilities/gmail/callback'),
  'http://monterorentals.com/api/utilities/gmail/callback',
  'non-production leaves URI unchanged'
);

process.env.NODE_ENV = 'production';
assert.strictEqual(
  normalizeProductionRedirectUri('http://monterorentals.com/api/utilities/gmail/callback'),
  'https://www.monterorentals.com/api/utilities/gmail/callback',
  'production forces https + www'
);
assert.strictEqual(
  normalizeProductionRedirectUri('https://www.monterorentals.com/api/utilities/gmail/callback'),
  'https://www.monterorentals.com/api/utilities/gmail/callback',
  'already-correct production URI is unchanged'
);
assert.strictEqual(
  normalizeProductionRedirectUri('http://localhost:8080/api/utilities/gmail/callback'),
  'http://localhost:8080/api/utilities/gmail/callback',
  'localhost stays http even in production'
);
assert.strictEqual(
  normalizeProductionRedirectUri('http://127.0.0.1:8080/callback'),
  'http://127.0.0.1:8080/callback',
  'loopback stays unchanged'
);
assert.strictEqual(
  normalizeProductionRedirectUri(null),
  null,
  'null passthrough'
);
assert.strictEqual(
  normalizeProductionRedirectUri('not a url'),
  'not a url',
  'invalid URL passthrough'
);

if (prevEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = prevEnv;

console.log('All gmail-redirect-uri checks passed.');
