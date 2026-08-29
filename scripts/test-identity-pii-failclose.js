#!/usr/bin/env node
/**
 * Identity PII crypto fail-close: missing/wrong-length key and non-9-digit SSN
 * must throw before ciphertext is stored. Stripe TEST often redacts digits —
 * encrypt must not accept partial/redacted values.
 *
 * Run: npm run test:identity-pii-failclose
 */
'use strict';

const assert = require('assert');

const KEY = Buffer.alloc(32, 7).toString('base64');
const SHORT_KEY = Buffer.alloc(16, 1).toString('base64');

const {
  encryptSsn,
  decryptSsn,
  ssnLast4,
  assertIdentityPiiKeyConfigured,
  KEY_ID,
} = require('../src/services/identity-pii-crypto.service');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

function withEnv(overrides, fn) {
  const snapshot = {};
  for (const key of Object.keys(overrides)) snapshot[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function throwsWith(fn, match, msg) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  check(!!err, `${msg}: expected throw`);
  if (!err) return;
  if (typeof match === 'string') {
    check(err.message.includes(match) || err.code === match, `${msg}: ${err.message}`);
  } else if (match && match.code) {
    check(err.code === match.code, `${msg}: code ${err.code}`);
  }
}

withEnv({ IDENTITY_PII_ENCRYPTION_KEY: undefined }, () => {
  throwsWith(
    () => assertIdentityPiiKeyConfigured(),
    'IDENTITY_KEY_MISSING',
    'assertIdentityPiiKeyConfigured without key'
  );
  throwsWith(() => encryptSsn('123456789'), 'IDENTITY_KEY_MISSING', 'encrypt without key');
});

withEnv({ IDENTITY_PII_ENCRYPTION_KEY: SHORT_KEY }, () => {
  throwsWith(
    () => assertIdentityPiiKeyConfigured(),
    '32 bytes',
    'assertIdentityPiiKeyConfigured rejects short key'
  );
  throwsWith(() => encryptSsn('123456789'), '32 bytes', 'encrypt rejects short key');
});

withEnv({ IDENTITY_PII_ENCRYPTION_KEY: KEY }, () => {
  assertIdentityPiiKeyConfigured();
  check(true, 'assertIdentityPiiKeyConfigured accepts 32-byte key');

  throwsWith(() => encryptSsn('*****6789'), '9 digits', 'redacted TEST SSN rejected');
  throwsWith(() => encryptSsn('12345'), '9 digits', 'short SSN rejected');
  throwsWith(() => encryptSsn('1234567890'), '9 digits', '10-digit value rejected');
  throwsWith(() => encryptSsn(''), '9 digits', 'empty SSN rejected');
  throwsWith(() => encryptSsn(null), '9 digits', 'null SSN rejected');

  const formatted = encryptSsn('123-45-6789');
  check(typeof formatted.ciphertext === 'string' && formatted.ciphertext.length > 0, 'formatted 9-digit encrypts');
  check(formatted.keyId === KEY_ID, 'encrypt returns keyId v1');
  check(decryptSsn(formatted.ciphertext) === '123456789', 'formatted SSN roundtrips to digits');
  check(!formatted.ciphertext.includes('123456789'), 'ciphertext does not contain plaintext');

  check(ssnLast4('123-45-6789') === '6789', 'ssnLast4 strips punctuation');
  check(ssnLast4('*****6789') === '6789', 'ssnLast4 keeps trailing 4 from redacted');
  check(ssnLast4('12') === '12', 'ssnLast4 short input returns available digits');
});

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll identity-pii-failclose checks passed.');
