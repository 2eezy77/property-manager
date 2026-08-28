#!/usr/bin/env node
/**
 * Auth middleware 401 taxonomy + impersonation payload on req.user.
 * Run: node scripts/test-authenticate-middleware.js
 */
'use strict';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret-coverage';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-coverage';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgres://test:test@127.0.0.1:5432/property_manager_test';

const jwt = require('jsonwebtoken');
const { signAccessToken, signImpersonationToken } = require('../src/utils/jwt.utils');
const authenticate = require('../src/middleware/authenticate');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    on() {
      return this;
    },
  };
  return res;
}

function run(authHeader, extras = {}) {
  const req = {
    headers: { authorization: authHeader },
    method: 'GET',
    originalUrl: '/api/tenants',
    ...extras,
  };
  const res = mockRes();
  let nextCalled = false;
  authenticate(req, res, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
}

{
  const { res, nextCalled } = run(undefined);
  check(res.statusCode === 401, 'missing header → 401');
  check(res.body?.error === 'MISSING_TOKEN', 'missing header → MISSING_TOKEN');
  check(!nextCalled, 'missing header does not call next');
}

{
  const { res, nextCalled } = run('Token abc');
  check(res.body?.error === 'MISSING_TOKEN', 'non-Bearer scheme → MISSING_TOKEN');
  check(!nextCalled, 'non-Bearer does not call next');
}

{
  const { res, nextCalled } = run('Bearer not-a-jwt');
  check(res.statusCode === 401, 'garbage token → 401');
  check(res.body?.error === 'INVALID_TOKEN', 'garbage token → INVALID_TOKEN');
  check(!nextCalled, 'garbage token does not call next');
}

{
  const expired = jwt.sign(
    { sub: 'u-exp', role: 'tenant' },
    process.env.JWT_ACCESS_SECRET,
    { algorithm: 'HS256', expiresIn: -10 }
  );
  const { res, nextCalled } = run(`Bearer ${expired}`);
  check(res.statusCode === 401, 'expired token → 401');
  check(res.body?.error === 'TOKEN_EXPIRED', `expired token → TOKEN_EXPIRED, got ${res.body?.error}`);
  check(!nextCalled, 'expired token does not call next');
}

{
  const tok = signAccessToken({ id: 'u1', role: 'manager' });
  const { req, res, nextCalled } = run(`Bearer ${tok}`);
  check(nextCalled, 'valid token calls next');
  check(res.statusCode == null, 'valid token does not write 401');
  check(req.user?.id === 'u1' && req.user?.role === 'manager', 'valid token sets id/role');
  check(req.user?.impersonatedBy == null, 'normal token has no impersonatedBy');
  check(req.user?.impersonatorRole == null, 'normal token has no impersonatorRole');
}

{
  const imp = signImpersonationToken(
    { id: 'tenant-1', role: 'tenant' },
    { id: 'owner-1', role: 'owner' }
  );
  const { req, nextCalled } = run(`Bearer ${imp}`);
  check(nextCalled, 'impersonation token calls next');
  check(req.user?.id === 'tenant-1', 'impersonation sub is the tenant');
  check(req.user?.impersonatedBy === 'owner-1', 'impersonatedBy is the actor');
  check(req.user?.impersonatorRole === 'owner', 'impersonatorRole is actor role');
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll authenticate-middleware checks passed.');
