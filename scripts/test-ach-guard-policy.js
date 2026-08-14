#!/usr/bin/env node
/**
 * Regression: Plaid ACH Signal/Balance block vs allow policy.
 * Pure decision helper — no Plaid/Stripe network.
 *
 * Run: npm run test:ach-guard-policy
 */
'use strict';

const assert = require('assert');
const {
  blockedSignalResults,
  balanceBlocksCharge,
  isSignalEnabled,
  isBalanceCheckEnabled,
  evaluateAchGuardDecision,
} = require('../src/services/ach-guard-policy');

const baseEnv = {
  PLAID_SIGNAL_ENABLED: 'true',
  PLAID_BALANCE_CHECK_ENABLED: 'true',
};

assert.deepStrictEqual(
  [...blockedSignalResults({})].sort(),
  ['REROUTE', 'REVIEW']
);
assert.deepStrictEqual(
  [...blockedSignalResults({ PLAID_SIGNAL_BLOCK_RESULTS: 'REROUTE' })],
  ['REROUTE']
);

assert.strictEqual(balanceBlocksCharge({}), true);
assert.strictEqual(balanceBlocksCharge({ PLAID_BALANCE_BLOCK: 'false' }), false);
assert.strictEqual(isSignalEnabled({ PLAID_SIGNAL_ENABLED: '1' }), true);
assert.strictEqual(isSignalEnabled({}), false);
assert.strictEqual(isBalanceCheckEnabled({ PLAID_BALANCE_CHECK_ENABLED: 'true' }), true);

// Signal REVIEW / REROUTE block
{
  const d = evaluateAchGuardDecision({
    signalResult: 'REVIEW',
    amountCents: 90000,
    env: baseEnv,
  });
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.status, 402);
  assert.strictEqual(d.body.error, 'ACH_RISK_BLOCKED');
  assert.strictEqual(d.body.signalResult, 'REVIEW');
}
{
  const d = evaluateAchGuardDecision({
    signalResult: 'reroute',
    amountCents: 90000,
    env: baseEnv,
  });
  assert.strictEqual(d.ok, false);
  assert.ok(d.body.message.includes('elevated return risk'));
}

// ACCEPT / null does not block on Signal
{
  const d = evaluateAchGuardDecision({
    signalResult: 'ACCEPT',
    availableCents: 100000,
    amountCents: 90000,
    env: baseEnv,
  });
  assert.strictEqual(d.ok, true);
}
{
  const d = evaluateAchGuardDecision({
    signalResult: null,
    availableCents: 100000,
    amountCents: 90000,
    env: baseEnv,
  });
  assert.strictEqual(d.ok, true);
}

// Insufficient balance blocks when PLAID_BALANCE_BLOCK is on (default)
{
  const d = evaluateAchGuardDecision({
    signalResult: 'ACCEPT',
    availableCents: 5000,
    amountCents: 90000,
    env: baseEnv,
  });
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.body.error, 'INSUFFICIENT_BALANCE');
  assert.strictEqual(d.body.availableCents, 5000);
  assert.strictEqual(d.body.requiredCents, 90000);
}

// Insufficient balance warns but allows when PLAID_BALANCE_BLOCK=false
{
  const d = evaluateAchGuardDecision({
    signalResult: 'ACCEPT',
    availableCents: 5000,
    amountCents: 90000,
    env: { ...baseEnv, PLAID_BALANCE_BLOCK: 'false' },
  });
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.balanceWarning, true);
}

// Signal disabled → ignore REVIEW
{
  const d = evaluateAchGuardDecision({
    signalResult: 'REVIEW',
    availableCents: 100000,
    amountCents: 90000,
    env: { PLAID_SIGNAL_ENABLED: 'false', PLAID_BALANCE_CHECK_ENABLED: 'true' },
  });
  assert.strictEqual(d.ok, true);
}

// Balance check disabled → ignore shortfall
{
  const d = evaluateAchGuardDecision({
    signalResult: 'ACCEPT',
    availableCents: 1,
    amountCents: 90000,
    env: { PLAID_SIGNAL_ENABLED: 'true', PLAID_BALANCE_CHECK_ENABLED: 'false' },
  });
  assert.strictEqual(d.ok, true);
}

console.log('test-ach-guard-policy: OK');
