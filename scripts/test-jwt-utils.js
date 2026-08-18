#!/usr/bin/env node
/**
 * Unit checks for JWT duration parsing + impersonation claims.
 * Run: node scripts/test-jwt-utils.js
 */
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || 'test-access-secret-for-unit-tests-only';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-for-unit-tests-only';
process.env.JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
process.env.JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

const {
  parseDuration,
  signAccessToken,
  signImpersonationToken,
  verifyAccessToken,
  hashRefreshToken,
  generateRefreshToken,
} = require('../src/utils/jwt.utils');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

assert(parseDuration('15m') === 15 * 60 * 1000, '15m → ms');
assert(parseDuration('1h') === 3600000, '1h → ms');
assert(parseDuration('30d') === 30 * 86400000, '30d → ms');
assert(parseDuration('45s') === 45000, '45s → ms');

let threw = false;
try {
  parseDuration('30days');
} catch {
  threw = true;
}
assert(threw, 'rejects invalid duration');

threw = false;
try {
  parseDuration('');
} catch {
  threw = true;
}
assert(threw, 'rejects empty duration');

const plain = signAccessToken({ id: 'user-1', role: 'tenant' });
const plainClaims = verifyAccessToken(plain);
assert(plainClaims.sub === 'user-1' && plainClaims.role === 'tenant', 'access token sub/role');
assert(plainClaims.imp !== true && !plainClaims.actor, 'normal token has no imp/actor');

const imp = signImpersonationToken(
  { id: 'tenant-9', role: 'tenant' },
  { id: 'owner-1', role: 'owner' }
);
const impClaims = verifyAccessToken(imp);
assert(impClaims.sub === 'tenant-9', 'impersonation sub is tenant');
assert(impClaims.role === 'tenant', 'impersonation role is tenant');
assert(impClaims.imp === true, 'impersonation sets imp=true');
assert(impClaims.actor === 'owner-1', 'impersonation sets actor');
assert(impClaims.actorRole === 'owner', 'impersonation sets actorRole');
assert(impClaims.exp - impClaims.iat === 3600, 'impersonation expires in 1h');

const hashed = hashRefreshToken('abc');
assert(hashed === hashRefreshToken('abc'), 'hashRefreshToken deterministic');
assert(hashed !== hashRefreshToken('abd'), 'hashRefreshToken changes with input');

const rt = generateRefreshToken();
assert(typeof rt.raw === 'string' && rt.raw.length === 96, 'refresh raw is 48-byte hex');
assert(rt.hash === hashRefreshToken(rt.raw), 'refresh hash matches hashRefreshToken');
assert(rt.expiresAt instanceof Date && rt.expiresAt.getTime() > Date.now(), 'refresh expires in future');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll jwt-utils checks passed.');
