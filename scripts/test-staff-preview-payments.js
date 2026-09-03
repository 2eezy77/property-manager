#!/usr/bin/env node
/**
 * Staff "view as tenant" preview must not start payments or leak bank details.
 * Covers the expand from manager-only → any staff actor (owners included).
 *
 * Run: npm run test:staff-preview-payments
 */
'use strict';

const assert = require('assert');
const {
  isManagerImpersonation,
  isStaffImpersonation,
  blockStaffPaymentAccess,
  blockManagerPaymentAccess,
  redactPaymentHistoryRow,
} = require('../src/middleware/impersonation');

function mockRes() {
  const out = { statusCode: null, body: null };
  return {
    out,
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(body) {
      out.body = body;
      return this;
    },
  };
}

// --- detection ---
assert.strictEqual(isStaffImpersonation({ user: {} }), false, 'plain tenant session');
assert.strictEqual(
  isStaffImpersonation({ user: { impersonatedBy: 'staff-1' } }),
  true,
  'any impersonatedBy marks staff preview'
);
assert.strictEqual(
  isManagerImpersonation({
    user: { impersonatedBy: 'mgr-1', impersonatorRole: 'property_manager' },
  }),
  true,
  'manager role flag'
);
assert.strictEqual(
  isManagerImpersonation({
    user: { impersonatedBy: 'owner-1', impersonatorRole: 'owner' },
  }),
  false,
  'owner preview is staff but not manager-role'
);

// --- payment block (any staff) ---
{
  const res = mockRes();
  const blocked = blockStaffPaymentAccess(
    { user: { impersonatedBy: 'owner-1', impersonatorRole: 'owner' } },
    res
  );
  assert.strictEqual(blocked, true, 'owner preview blocks payments');
  assert.strictEqual(res.out.statusCode, 403);
  assert.strictEqual(res.out.body.error, 'PREVIEW_NO_PAYMENTS');
  assert.match(res.out.body.message, /previewing a tenant portal/i);
}

{
  const res = mockRes();
  const blocked = blockStaffPaymentAccess(
    { user: { impersonatedBy: 'mgr-1', impersonatorRole: 'property_manager' } },
    res
  );
  assert.strictEqual(blocked, true, 'manager preview blocks payments');
  assert.strictEqual(res.out.body.error, 'PREVIEW_NO_PAYMENTS');
}

{
  const res = mockRes();
  const blocked = blockStaffPaymentAccess({ user: { id: 'tenant-1' } }, res);
  assert.strictEqual(blocked, false, 'real tenant session is allowed');
  assert.strictEqual(res.out.statusCode, null, 'no response written');
}

{
  const res = mockRes();
  const blocked = blockManagerPaymentAccess(
    { user: { impersonatedBy: 'owner-1', impersonatorRole: 'owner' } },
    res
  );
  assert.strictEqual(blocked, true, 'legacy alias also blocks owner preview');
  assert.strictEqual(res.out.body.error, 'PREVIEW_NO_PAYMENTS');
}

// --- history redaction ---
{
  const redacted = redactPaymentHistoryRow({
    id: 'p1',
    amount: 900,
    institution_name: 'Chase',
    account_mask: '1234',
    payment_method: 'ach',
  });
  assert.strictEqual(redacted.institution_name, undefined, 'strips institution');
  assert.strictEqual(redacted.account_mask, undefined, 'strips mask');
  assert.strictEqual(redacted.amount, 900, 'keeps amount');
  assert.strictEqual(redacted.payment_method, 'ach', 'keeps method');
}

{
  const redacted = redactPaymentHistoryRow({
    id: 'p2',
    amount: 50,
    institution_name: 'Chime',
    account_mask: '9999',
  });
  assert.strictEqual(redacted.payment_method, 'ach', 'defaults missing method to ach');
  assert.ok(!('institution_name' in redacted));
  assert.ok(!('account_mask' in redacted));
}

console.log('All staff-preview-payments checks passed.');
