/**
 * Unit checks for Stripe Dashboard-readable payer labels.
 */
const assert = require('assert');
const {
  personDisplayName,
  withPayerLabel,
  payerMetadata,
  toStripeMetadata,
} = require('../src/services/stripe.service');

assert.strictEqual(
  personDisplayName({ firstName: 'Lily', lastName: 'Fortman', email: 'l@x.com' }),
  'Lily Fortman'
);
assert.strictEqual(
  personDisplayName({ email: 'only@x.com' }),
  'only@x.com'
);

assert.strictEqual(
  withPayerLabel('Rent — August 2026 (incl. processing fee)', {
    name: 'Lily Fortman',
    propertyLabel: '743 A Ave U4',
  }),
  'Rent — August 2026 (incl. processing fee) — Lily Fortman · 743 A Ave U4'
);

const meta = payerMetadata({
  name: 'Isaiah Reese',
  email: 'isaiah@x.com',
  userId: 'eeeeeeee-0000-0000-0000-000000000002',
  propertyLabel: '743 A Ave U2',
});
assert.strictEqual(meta.tenant_name, 'Isaiah Reese');
assert.strictEqual(meta.tenant_email, 'isaiah@x.com');
assert.strictEqual(meta.property_label, '743 A Ave U2');

assert.strictEqual(
  require('../src/services/stripe.service').formatPropertyLabel('743 A Ave', 'Room 4'),
  '743 A Ave · Room 4'
);
assert.strictEqual(
  require('../src/services/stripe.service').formatPropertyLabel('743 A Ave', '2'),
  '743 A Ave U2'
);

{
  const stripeMeta = toStripeMetadata({
    payment_type: 'utility',
    portal_utility: true,
    utility_split_ids: ['s1', 's2'],
    utility_bill_ids: ['b1', 'b2'],
    skip: null,
    empty: '',
  });
  assert.strictEqual(stripeMeta.portal_utility, 'true');
  assert.strictEqual(stripeMeta.utility_split_ids, 's1,s2');
  assert.strictEqual(stripeMeta.utility_bill_ids, 'b1,b2');
  assert.strictEqual(stripeMeta.skip, undefined);
  assert.strictEqual(stripeMeta.empty, undefined);
}

{
  // Nested objects + truncation — Stripe metadata values must be strings ≤500 chars.
  const longKey = `k${'x'.repeat(50)}`;
  const longVal = 'v'.repeat(600);
  const stripeMeta = toStripeMetadata({
    nested: { a: 1, b: ['x'] },
    [longKey]: 'ok',
    bulky: longVal,
    zero: 0,
    flag: false,
  });
  assert.strictEqual(stripeMeta.nested, JSON.stringify({ a: 1, b: ['x'] }));
  assert.strictEqual(Object.keys(stripeMeta).find((k) => k.startsWith('kx')), 'k' + 'x'.repeat(39));
  assert.strictEqual(stripeMeta.bulky.length, 500);
  assert.strictEqual(stripeMeta.zero, '0');
  assert.strictEqual(stripeMeta.flag, 'false');
}

console.log('test-stripe-payer-labels: ok');
