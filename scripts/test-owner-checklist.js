#!/usr/bin/env node
/**
 * Unit checks for owner payment checklist defaults + patch update builder.
 * Run: node scripts/test-owner-checklist.js
 */
'use strict';

const {
  DEFAULT_ITEMS,
  CHECKLIST_PATCH_KEYS,
  buildChecklistUpdate,
} = require('../src/services/owner-checklist.service');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

assert(Array.isArray(DEFAULT_ITEMS) && DEFAULT_ITEMS.length >= 4, 'DEFAULT_ITEMS has seed rows');
const cats = DEFAULT_ITEMS.map((i) => i.category);
assert(new Set(cats).size === cats.length, 'DEFAULT_ITEMS categories are unique (ON CONFLICT key)');
assert(cats.includes('mortgage') && cats.includes('utilities'), 'mortgage + utilities categories present');

for (const item of DEFAULT_ITEMS) {
  assert(typeof item.label === 'string' && item.label.length > 0, `label set for ${item.category}`);
  assert(Number.isInteger(item.sort_order) && item.sort_order > 0, `sort_order for ${item.category}`);
  assert(
    item.payment_method == null || typeof item.payment_method === 'string',
    `payment_method type for ${item.category}`
  );
  if (item.amount_estimate != null) {
    assert(typeof item.amount_estimate === 'number' && item.amount_estimate >= 0, `amount for ${item.category}`);
  }
  if (item.due_day != null) {
    assert(item.due_day >= 1 && item.due_day <= 31, `due_day for ${item.category}`);
  }
}

const mortgage = DEFAULT_ITEMS.find((i) => i.category === 'mortgage');
assert(mortgage.due_day === 1 && mortgage.amount_estimate === 2265.37, 'mortgage seed amount/due_day');

assert(
  CHECKLIST_PATCH_KEYS.includes('last_paid_at') && CHECKLIST_PATCH_KEYS.includes('label'),
  'patch allowlist includes paid stamp + label'
);

const built = buildChecklistUpdate(
  { label: 'Mortgage', amount_estimate: 2300, ignored: true },
  { ownerId: 'owner-1', itemId: 'item-9' }
);
assert(built.vals[0] === 'owner-1' && built.vals[1] === 'item-9', 'vals start with ownerId, itemId');
assert(built.sets.includes('label = $3'), 'label uses $3');
assert(built.sets.includes('amount_estimate = $4'), 'amount_estimate uses $4');
assert(built.vals[2] === 'Mortgage' && built.vals[3] === 2300, 'patch values appended in key order');
assert(!built.sets.some((s) => s.startsWith('ignored')), 'unknown keys ignored');

let threw = false;
try {
  buildChecklistUpdate({ unknown: 1 }, { ownerId: 'o', itemId: 'i' });
} catch (err) {
  threw = err.code === 'VALIDATION';
}
assert(threw, 'empty/unknown-only patch → VALIDATION');

threw = false;
try {
  buildChecklistUpdate({}, { ownerId: 'o', itemId: 'i' });
} catch (err) {
  threw = err.code === 'VALIDATION';
}
assert(threw, 'empty patch → VALIDATION');

const nullOk = buildChecklistUpdate(
  { notes: null, due_day: null },
  { ownerId: 'o', itemId: 'i' }
);
assert(nullOk.sets.length === 2 && nullOk.vals.includes(null), 'explicit null clears notes/due_day');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll owner-checklist checks passed.');
