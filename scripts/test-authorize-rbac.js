#!/usr/bin/env node
/**
 * Unit checks for RBAC authorize middleware helpers.
 * Run: node scripts/test-authorize-rbac.js
 */
const {
  authorize,
  authorizeMin,
  authorizeSelfOrRole,
  Guards,
} = require('../src/middleware/authorize');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

function mockRes() {
  return {
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
  };
}

function run(mw, req) {
  const res = mockRes();
  let nextCalled = false;
  mw(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

// authorize exact roles
{
  const mw = authorize('owner', 'property_manager');
  let r = run(mw, {});
  assert(r.res.statusCode === 401 && !r.nextCalled, 'authorize: no user → 401');
  r = run(mw, { user: { role: 'tenant' } });
  assert(r.res.statusCode === 403 && r.res.body.error === 'FORBIDDEN', 'authorize: tenant blocked');
  r = run(mw, { user: { role: 'owner' } });
  assert(r.nextCalled === true, 'authorize: owner allowed');
  r = run(mw, { user: { role: 'property_manager' } });
  assert(r.nextCalled === true, 'authorize: property_manager allowed');
}

// authorizeMin hierarchy
{
  const mw = authorizeMin('property_manager');
  let r = run(mw, { user: { role: 'tenant' } });
  assert(r.res.statusCode === 403, 'authorizeMin: tenant below staff');
  r = run(mw, { user: { role: 'property_manager' } });
  assert(r.nextCalled, 'authorizeMin: property_manager ok');
  r = run(mw, { user: { role: 'owner' } });
  assert(r.nextCalled, 'authorizeMin: owner ok');
  r = run(mw, { user: { role: 'super_admin' } });
  assert(r.nextCalled, 'authorizeMin: super_admin ok');
  r = run(mw, { user: { role: 'unknown_role' } });
  assert(r.res.statusCode === 403, 'authorizeMin: unknown role rank 0 blocked');
}

let threw = false;
try {
  authorizeMin('not_a_role');
} catch {
  threw = true;
}
assert(threw, 'authorizeMin throws on unknown minRole at factory time');

// authorizeSelfOrRole
{
  const mw = authorizeSelfOrRole('tenantId', 'property_manager');
  let r = run(mw, {
    user: { id: 'u1', role: 'tenant' },
    params: { tenantId: 'u1' },
  });
  assert(r.nextCalled, 'self access allowed for tenant');
  r = run(mw, {
    user: { id: 'u1', role: 'tenant' },
    params: { tenantId: 'other' },
  });
  assert(r.res.statusCode === 403, 'tenant cannot access other id');
  r = run(mw, {
    user: { id: 'mgr', role: 'property_manager' },
    params: { tenantId: 'other' },
  });
  assert(r.nextCalled, 'staff bypasses self check');
  r = run(mw, {
    user: { id: 'own', role: 'owner' },
    params: { tenantId: 'other' },
  });
  assert(r.nextCalled, 'owner rank bypasses self check');
}

assert(typeof Guards.staffOnly === 'function', 'Guards.staffOnly exported');
assert(typeof Guards.tenantOnly === 'function', 'Guards.tenantOnly exported');
{
  const r = run(Guards.tenantOnly, { user: { role: 'owner' } });
  assert(r.res.statusCode === 403, 'Guards.tenantOnly blocks owner');
}
{
  const r = run(Guards.staffOnly, { user: { role: 'tenant' } });
  assert(r.res.statusCode === 403, 'Guards.staffOnly blocks tenant');
}
{
  const r = run(Guards.ownerAndAbove, { user: { role: 'property_manager' } });
  assert(r.res.statusCode === 403, 'Guards.ownerAndAbove blocks manager');
}
{
  const r = run(Guards.ownerAndAbove, { user: { role: 'owner' } });
  assert(r.nextCalled, 'Guards.ownerAndAbove allows owner');
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll authorize-rbac checks passed.');
