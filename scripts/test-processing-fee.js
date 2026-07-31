#!/usr/bin/env node
/**
 * Unit checks for Card/Cash App processing fee helper.
 * Run: node scripts/test-processing-fee.js
 */
const {
  computeCardCashAppFee,
  feeMetadata,
  RATE,
  FIXED_CENTS,
} = require('../src/services/payment-processing-fee.service');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const fifty = computeCardCashAppFee(50);
assert(fifty.feeCents === Math.round(50 * 0.029) + 30, '50¢ fee is round(2.9%)+$0.30');
assert(fifty.feeCents === 31, '50¢ → $0.31 fee');
assert(fifty.totalCents === 81, '50¢ → charge 81¢');

const rent = computeCardCashAppFee(90000);
assert(rent.feeCents === Math.round(90000 * 0.029) + 30, '$900 fee formula');
assert(rent.feeCents === 2640, '$900 → $26.40 fee');
assert(rent.totalCents === 92640, '$900 → charge $926.40');
assert(rent.baseAmount === 900, 'baseAmount dollars');
assert(rent.totalAmount === 926.4, 'totalAmount dollars');

const meta = feeMetadata(rent);
assert(meta.processing_fee === '26.40', 'metadata processing_fee');
assert(meta.base_amount === '900.00', 'metadata base_amount');
assert(meta.charged_total === '926.40', 'metadata charged_total');

assert(RATE === 0.029 && FIXED_CENTS === 30, 'constants');

let threw = false;
try {
  computeCardCashAppFee(-1);
} catch {
  threw = true;
}
assert(threw, 'rejects negative base');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll processing-fee checks passed.');
