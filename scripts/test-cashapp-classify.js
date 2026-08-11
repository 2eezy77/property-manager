#!/usr/bin/env node
/**
 * Cash App import classification: deposit vs rent notes, sender keys.
 * Mis-classifying a deposit as rent (or the reverse) corrupts ledgers.
 * Run: npm run test:cashapp-classify
 */
const assert = require('assert');
const {
  isDepositPayment,
  splitRentAndDepositRows,
  normalizeSender,
  deriveCashAppKey,
} = require('../src/services/cashapp-import.service');

assert.strictEqual(isDepositPayment({ notes: 'security deposit' }), true);
assert.strictEqual(isDepositPayment({ notes: 'Sec Dep +$450' }), true);
assert.strictEqual(isDepositPayment({ notes: 'towards the deposit' }), true);
assert.strictEqual(isDepositPayment({ notes: 'deposit' }), true);

// Rent mention wins — do not treat as deposit
assert.strictEqual(isDepositPayment({ notes: 'rent + deposit' }), false);
assert.strictEqual(isDepositPayment({ notes: 'August rent' }), false);
assert.strictEqual(isDepositPayment({ notes: '' }), false);
assert.strictEqual(isDepositPayment({ notes: null }), false);

const { rentRows, depositRows } = splitRentAndDepositRows([
  { notes: 'August rent', amount: 900 },
  { notes: 'security deposit', amount: 450 },
  { notes: 'for July', amount: 450 },
  { notes: 'towards deposit', amount: 200 },
]);
assert.strictEqual(rentRows.length, 2);
assert.strictEqual(depositRows.length, 2);
assert.strictEqual(depositRows[0].amount, 450);
assert.strictEqual(rentRows[1].notes, 'for July');

assert.strictEqual(normalizeSender('Isaiah Reese'), 'isaiah');
assert.strictEqual(normalizeSender('Stone Buckley'), 'stone');
assert.strictEqual(normalizeSender('Buckley Stone'), 'stone');
assert.strictEqual(normalizeSender('Lily Fortman'), 'lily');
assert.strictEqual(normalizeSender('Unknown Person'), 'unknown person');

assert.strictEqual(deriveCashAppKey('stone@example.com', 'Buckley', 'Stone'), 'stone');
assert.strictEqual(deriveCashAppKey('x@y.com', 'Isaiah', 'Reese'), 'isaiah');
assert.strictEqual(deriveCashAppKey('lily.fortman@x.com', 'L', 'F'), 'lily');
assert.strictEqual(deriveCashAppKey('other@x.com', 'Pat', 'Lee'), null);

console.log('test-cashapp-classify: ok');
