#!/usr/bin/env node
/**
 * Regression: Stripe Identity fee base + 72h paid grace window.
 * Pure helpers — no DB/Stripe.
 *
 * Run: npm run test:identity-fee-grace
 */
const assert = require('assert');
const { computeCardCashAppFee } = require('../src/services/payment-processing-fee.service');
const {
  IDENTITY_FEE_BASE_CENTS,
  IDENTITY_FEE_GRACE_HOURS,
  isWithinGrace,
} = require('../src/services/tenant-identity.service');

assert.strictEqual(IDENTITY_FEE_BASE_CENTS, 150, 'identity fee base is $1.50');
assert.strictEqual(IDENTITY_FEE_GRACE_HOURS, 72);

const fee = computeCardCashAppFee(IDENTITY_FEE_BASE_CENTS);
assert.strictEqual(fee.baseAmount, 1.5);
// 2.9% of $1.50 + $0.30 = round(4.35¢) + 30 = 34¢ → total $1.84
assert.strictEqual(fee.feeCents, 34);
assert.strictEqual(fee.totalCents, 184);
assert.strictEqual(fee.totalAmount, 1.84);

const now = new Date('2026-08-10T12:00:00.000Z');
assert.strictEqual(isWithinGrace(null, now), false);
assert.strictEqual(isWithinGrace('not-a-date', now), false);

const paidJustNow = new Date(now.getTime() - 60 * 1000);
assert.strictEqual(isWithinGrace(paidJustNow, now), true);
assert.strictEqual(isWithinGrace(paidJustNow.toISOString(), now), true);

const paidAtGraceEdge = new Date(now.getTime() - IDENTITY_FEE_GRACE_HOURS * 60 * 60 * 1000);
assert.strictEqual(isWithinGrace(paidAtGraceEdge, now), true, 'exact 72h still within grace');

const paidJustPastGrace = new Date(paidAtGraceEdge.getTime() - 1);
assert.strictEqual(isWithinGrace(paidJustPastGrace, now), false, 'past 72h requires new fee');

console.log('test-identity-fee-grace: OK');
