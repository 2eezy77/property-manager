#!/usr/bin/env node
/**
 * Staff preview must never start bank link / pay actions (owners included).
 * Covers the Osanin-era widening from manager-only → any staff impersonation.
 *
 * Run: node scripts/test-impersonation-payment-gates.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  isManagerImpersonation,
  isStaffImpersonation,
  blockStaffPaymentAccess,
  blockManagerPaymentAccess,
  redactPaymentHistoryRow,
} = require('../src/middleware/impersonation');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
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

// ── Pure helpers ────────────────────────────────────────────────────────────
assert.strictEqual(isStaffImpersonation({ user: {} }), false);
assert.strictEqual(isStaffImpersonation({ user: { impersonatedBy: null } }), false);
assert.strictEqual(
  isStaffImpersonation({ user: { impersonatedBy: 'owner-1', impersonatorRole: 'owner' } }),
  true,
  'owner preview is staff impersonation'
);
assert.strictEqual(
  isStaffImpersonation({
    user: { impersonatedBy: 'mgr-1', impersonatorRole: 'property_manager' },
  }),
  true
);

assert.strictEqual(
  isManagerImpersonation({ user: { impersonatorRole: 'owner', impersonatedBy: 'o1' } }),
  false,
  'owner preview is not manager-only flag'
);
assert.strictEqual(
  isManagerImpersonation({
    user: { impersonatorRole: 'property_manager', impersonatedBy: 'm1' },
  }),
  true
);

{
  const res = mockRes();
  assert.strictEqual(
    blockStaffPaymentAccess({ user: { id: 'tenant', role: 'tenant' } }, res),
    false,
    'real tenant session is not blocked'
  );
  assert.strictEqual(res.statusCode, null);
}

{
  const res = mockRes();
  const blocked = blockStaffPaymentAccess(
    { user: { id: 'tenant', impersonatedBy: 'owner-1', impersonatorRole: 'owner' } },
    res
  );
  assert.strictEqual(blocked, true, 'owner preview is blocked from pay/bank');
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.error, 'PREVIEW_NO_PAYMENTS');
  assert.match(String(res.body.message), /previewing a tenant portal/i);
}

{
  const res = mockRes();
  assert.strictEqual(
    blockManagerPaymentAccess(
      { user: { id: 'tenant', impersonatedBy: 'owner-1', impersonatorRole: 'owner' } },
      res
    ),
    true,
    'deprecated alias still blocks all staff (not manager-only)'
  );
  assert.strictEqual(res.body.error, 'PREVIEW_NO_PAYMENTS');
}

{
  const res = mockRes();
  assert.strictEqual(
    blockStaffPaymentAccess(
      {
        user: {
          id: 'tenant',
          impersonatedBy: 'mgr-1',
          impersonatorRole: 'property_manager',
        },
      },
      res
    ),
    true
  );
}

{
  const redacted = redactPaymentHistoryRow({
    id: 'p1',
    amount: 450,
    institution_name: 'Chime',
    account_mask: '1234',
  });
  assert.strictEqual(redacted.institution_name, undefined);
  assert.strictEqual(redacted.account_mask, undefined);
  assert.strictEqual(redacted.payment_method, 'ach');
  assert.strictEqual(redacted.amount, 450);
}

{
  const redacted = redactPaymentHistoryRow({
    id: 'p2',
    payment_method: 'card',
    institution_name: 'Bank',
    account_mask: '9999',
  });
  assert.strictEqual(redacted.payment_method, 'card');
  assert.strictEqual(redacted.institution_name, undefined);
}

// ── Route + UI wiring ───────────────────────────────────────────────────────
const routes = read('src/routes/payments.routes.js');
assert.match(routes, /blockManagerPaymentAccess/, 'payments routes call the payment block');
assert.match(
  routes,
  /isStaffImpersonation\(req\)[\s\S]*redactPaymentHistoryRow/,
  'history redacts bank details under staff preview'
);

const blockCallCount = (routes.match(/if \(blockManagerPaymentAccess\(req, res\)\) return;/g) || [])
  .length;
assert.ok(
  blockCallCount >= 8,
  `expected many charge/link endpoints gated, found ${blockCallCount}`
);

const paymentsPage = read('client/src/pages/tenant/Payments.jsx');
assert.match(paymentsPage, /isStaffImpersonation/);
assert.match(
  paymentsPage,
  /staffPreview|isStaffImpersonation\(\)/,
  'tenant Payments gates UI on staff preview'
);
assert.match(
  paymentsPage,
  /Preview only — history is visible; bank linking and pay actions are disabled for all staff previews/
);

const dashboard = read('client/src/pages/tenant/Dashboard.jsx');
assert.match(dashboard, /isStaffImpersonation/);

const clientUtil = read('client/src/utils/impersonation.js');
assert.match(
  clientUtil,
  /export function isStaffImpersonation\(\)\s*\{\s*return isImpersonating\(\);/,
  'client staff preview = any impersonation session (owners included)'
);

const apiErrors = read('client/src/utils/apiErrorMessage.js');
assert.match(apiErrors, /PREVIEW_NO_PAYMENTS:/);

console.log('test-impersonation-payment-gates: OK');
