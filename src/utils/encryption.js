/**
 * encryption.js
 * AES-256-GCM authenticated encryption for Plaid access tokens.
 *
 * Each call to encrypt() produces a unique ciphertext even for identical inputs
 * because a fresh 12-byte IV is generated every time.
 *
 * Wire format (all base64-encoded together):
 *   [ IV (12 bytes) | AuthTag (16 bytes) | Ciphertext (variable) ]
 *
 * Required env var:
 *   ENCRYPTION_KEY  — 32-byte key, base64-encoded
 *   Generate with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function getKey() {
  const b64 = process.env.ENCRYPTION_KEY;
  if (!b64) throw new Error('ENCRYPTION_KEY env var is not set');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
}

/**
 * Encrypt a plaintext string.
 * @param {string} plaintext
 * @returns {string} base64-encoded ciphertext blob (IV + authTag + ciphertext)
 */
function encrypt(plaintext) {
  const key    = getKey();
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag(); // 16 bytes

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypt a ciphertext blob produced by encrypt().
 * @param {string} blob base64-encoded ciphertext
 * @returns {string} original plaintext
 */
function decrypt(blob) {
  const key      = getKey();
  const buf      = Buffer.from(blob, 'base64');
  const iv       = buf.subarray(0, 12);
  const authTag  = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encrypt, decrypt };
