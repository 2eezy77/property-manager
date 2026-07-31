// scripts/test-identity-crypto.js
process.env.IDENTITY_PII_ENCRYPTION_KEY =
  process.env.IDENTITY_PII_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');
const { encryptSsn, decryptSsn, ssnLast4 } = require('../src/services/identity-pii-crypto.service');
const enc = encryptSsn('123456789');
if (enc.ciphertext.includes('123456789')) throw new Error('plaintext leaked');
if (decryptSsn(enc.ciphertext) !== '123456789') throw new Error('roundtrip fail');
if (ssnLast4('123456789') !== '6789') throw new Error('last4');
console.log('OK identity crypto');
