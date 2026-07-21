/**
 * jwt.utils.js
 * Helpers for issuing and verifying access tokens (short-lived JWT)
 * and opaque refresh tokens (long-lived, stored hashed in DB).
 *
 * Access token payload:
 *   { sub: userId, role: user_role, iat, exp }
 *
 * Refresh token:
 *   Random 48-byte hex string. Only the SHA-256 hash is stored in DB.
 */

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');

const {
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES_IN  = '15m',
  JWT_REFRESH_EXPIRES_IN = '30d',
} = process.env;

if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in env');
}

// ── Access token ──────────────────────────────────────────────────────────────

/**
 * Issue a signed access token.
 * @param {{ id: string, role: string }} user
 * @param {{ expiresIn?: string, actorId?: string }} [opts]
 * @returns {string} signed JWT
 */
function signAccessToken(user, opts = {}) {
  const payload = { sub: user.id, role: user.role };
  if (opts.actorId) {
    payload.imp = true;
    payload.actor = opts.actorId;
    if (opts.actorRole) payload.actorRole = opts.actorRole;
  }
  return jwt.sign(
    payload,
    JWT_ACCESS_SECRET,
    { expiresIn: opts.expiresIn ?? JWT_ACCESS_EXPIRES_IN, algorithm: 'HS256' }
  );
}

/**
 * Short-lived token for owner viewing a tenant portal (no refresh token issued).
 * @param {{ id: string, role: string }} tenant
 * @param {{ id: string, role: string }} actor — staff user issuing the preview token
 */
function signImpersonationToken(tenant, actor) {
  return signAccessToken(tenant, {
    actorId: actor.id,
    actorRole: actor.role,
    expiresIn: '1h',
  });
}

/**
 * Verify and decode an access token.
 * Throws JsonWebTokenError or TokenExpiredError on failure.
 * @param {string} token
 * @returns {{ sub: string, role: string, iat: number, exp: number }}
 */
function verifyAccessToken(token) {
  return jwt.verify(token, JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
}

// ── Refresh token ─────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random opaque refresh token.
 * Returns both the raw token (sent to client) and its SHA-256 hash (stored in DB).
 * @returns {{ raw: string, hash: string, expiresAt: Date }}
 */
function generateRefreshToken() {
  const raw      = crypto.randomBytes(48).toString('hex');
  const hash     = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + parseDuration(JWT_REFRESH_EXPIRES_IN));
  return { raw, hash, expiresAt };
}

/**
 * Hash a raw refresh token for DB lookup.
 * @param {string} raw
 * @returns {string}
 */
function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a duration string like '30d', '15m', '1h' into milliseconds.
 */
function parseDuration(str) {
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const match = /^(\d+)([smhd])$/.exec(str);
  if (!match) throw new Error(`Invalid duration: ${str}`);
  return parseInt(match[1], 10) * units[match[2]];
}

module.exports = {
  signAccessToken,
  signImpersonationToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
};
