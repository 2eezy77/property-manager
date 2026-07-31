// src/services/identity-pii-crypto.service.js
const crypto = require('crypto');
const KEY_ID = 'v1';
function getKey() {
  const raw = process.env.IDENTITY_PII_ENCRYPTION_KEY;
  if (!raw) throw Object.assign(new Error('IDENTITY_PII_ENCRYPTION_KEY missing'), { code: 'IDENTITY_KEY_MISSING' });
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('IDENTITY_PII_ENCRYPTION_KEY must be 32 bytes base64');
  return key;
}
function encryptSsn(ssn) {
  const digits = String(ssn).replace(/\D/g, '');
  if (digits.length !== 9) throw new Error('SSN must be 9 digits');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([iv, tag, enc]).toString('base64'), keyId: KEY_ID };
}
function decryptSsn(ciphertext) {
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
function ssnLast4(ssn) {
  const digits = String(ssn).replace(/\D/g, '');
  return digits.slice(-4);
}
module.exports = { encryptSsn, decryptSsn, ssnLast4, KEY_ID };
