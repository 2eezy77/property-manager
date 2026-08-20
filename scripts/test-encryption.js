#!/usr/bin/env node
/**
 * Plaid/token AES-256-GCM encrypt/decrypt roundtrip + key validation.
 * Run: npm run test:encryption
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');

const prev = process.env.ENCRYPTION_KEY;
delete process.env.ENCRYPTION_KEY;

// Fresh require after clearing env so getKey() sees our test key.
delete require.cache[require.resolve('../src/utils/encryption')];

{
  let threw = null;
  try {
    require('../src/utils/encryption').encrypt('x');
  } catch (err) {
    threw = err;
  }
  assert.ok(threw);
  assert.match(threw.message, /ENCRYPTION_KEY env var is not set/);
}

process.env.ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
delete require.cache[require.resolve('../src/utils/encryption')];
{
  let threw = null;
  try {
    require('../src/utils/encryption').encrypt('x');
  } catch (err) {
    threw = err;
  }
  assert.ok(threw);
  assert.match(threw.message, /exactly 32 bytes/);
}

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
delete require.cache[require.resolve('../src/utils/encryption')];
const { encrypt, decrypt } = require('../src/utils/encryption');

const token = 'access-sandbox-unit-test-token-abc123';
const a = encrypt(token);
const b = encrypt(token);
assert.notStrictEqual(a, b, 'identical plaintext must yield unique ciphertext (fresh IV)');
assert.strictEqual(decrypt(a), token);
assert.strictEqual(decrypt(b), token);
assert.ok(!a.includes(token));
assert.ok(!Buffer.from(a, 'base64').toString('utf8').includes(token));

{
  let threw = null;
  try {
    decrypt(a.slice(0, 20));
  } catch (err) {
    threw = err;
  }
  assert.ok(threw, 'truncated/corrupt blob must fail closed');
}

if (prev === undefined) delete process.env.ENCRYPTION_KEY;
else process.env.ENCRYPTION_KEY = prev;

console.log('test-encryption: OK');
