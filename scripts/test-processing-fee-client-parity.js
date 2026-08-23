#!/usr/bin/env node
/**
 * Client Card/Cash App fee estimate must match server computeCardCashAppFee.
 * Run: node scripts/test-processing-fee-client-parity.js
 */
'use strict';

const assert = require('assert');
const {
  computeCardCashAppFee,
  RATE,
  FIXED_CENTS,
} = require('../src/services/payment-processing-fee.service');

async function main() {
  const {
    estimateCardCashAppTotal,
    RATE: clientRate,
    FIXED_CENTS: clientFixed,
  } = await import('../client/src/utils/processingFeeEstimate.js');

  assert.strictEqual(clientRate, RATE, 'client RATE matches server');
  assert.strictEqual(clientFixed, FIXED_CENTS, 'client FIXED_CENTS matches server');

  const samples = [0, 0.5, 1.5, 50, 100, 450, 900, 1200.55, 294.12];
  for (const dollars of samples) {
    const client = estimateCardCashAppTotal(dollars);
    const server = computeCardCashAppFee(Math.round(dollars * 100));
    assert.strictEqual(
      client.processingFee,
      server.processingFee,
      `processingFee parity at $${dollars}`
    );
    assert.strictEqual(
      client.totalAmount,
      server.totalAmount,
      `totalAmount parity at $${dollars}`
    );
    assert.strictEqual(
      client.baseAmount,
      server.baseAmount,
      `baseAmount parity at $${dollars}`
    );
  }

  // Identity verification base ($1.50) + card fee — Lease.jsx path
  const identity = estimateCardCashAppTotal(1.5);
  const identityServer = computeCardCashAppFee(150);
  assert.strictEqual(identity.processingFee, identityServer.processingFee);
  assert.strictEqual(identity.totalAmount, identityServer.totalAmount);

  // Soft client guard: invalid → zeros; null/undefined coerce like Number(null)=0
  assert.deepStrictEqual(estimateCardCashAppTotal(-1), {
    baseAmount: 0,
    processingFee: 0,
    totalAmount: 0,
  });
  assert.deepStrictEqual(estimateCardCashAppTotal(NaN), {
    baseAmount: 0,
    processingFee: 0,
    totalAmount: 0,
  });
  const zeroFee = computeCardCashAppFee(0);
  // Number(null)===0 → same as $0 base (still charges $0.30 fixed fee)
  assert.strictEqual(estimateCardCashAppTotal(null).processingFee, zeroFee.processingFee);
  assert.strictEqual(estimateCardCashAppTotal(0).totalAmount, zeroFee.totalAmount);
  // Number(undefined)===NaN → soft zero (UI has no amount yet)
  assert.deepStrictEqual(estimateCardCashAppTotal(undefined), {
    baseAmount: 0,
    processingFee: 0,
    totalAmount: 0,
  });

  // Cent rounding: $900.005 → same Math.round(dollars*100) path as server
  const odd = estimateCardCashAppTotal(900.005);
  const oddServer = computeCardCashAppFee(Math.round(900.005 * 100));
  assert.strictEqual(odd.processingFee, oddServer.processingFee);
  assert.strictEqual(odd.totalAmount, oddServer.totalAmount);

  console.log('test-processing-fee-client-parity: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
