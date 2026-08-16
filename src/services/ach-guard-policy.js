/**
 * Pure ACH pre-debit policy (Signal + Balance).
 * Money still moves via Stripe; this only decides block vs allow.
 */

'use strict';

function envFlag(name, defaultFalse = false, env = process.env) {
  const v = env[name];
  if (v == null || v === '') return defaultFalse;
  return v === '1' || String(v).toLowerCase() === 'true';
}

function isSignalEnabled(env = process.env) {
  return envFlag('PLAID_SIGNAL_ENABLED', false, env);
}

function isBalanceCheckEnabled(env = process.env) {
  return envFlag('PLAID_BALANCE_CHECK_ENABLED', false, env);
}

function balanceBlocksCharge(env = process.env) {
  return env.PLAID_BALANCE_BLOCK !== 'false';
}

function blockedSignalResults(env = process.env) {
  const raw = env.PLAID_SIGNAL_BLOCK_RESULTS || 'REVIEW,REROUTE';
  return new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
}

/**
 * Decide ACH allow/block from already-fetched Signal + Balance inputs.
 * @returns {{ ok: true } | { ok: false, status: number, body: object, kind: string }}
 */
function evaluateAchGuardDecision({
  signalResult = null,
  availableCents = null,
  amountCents,
  env = process.env,
} = {}) {
  if (isSignalEnabled(env)) {
    const result = signalResult != null ? String(signalResult).toUpperCase() : null;
    const blockSet = blockedSignalResults(env);
    if (result && blockSet.has(result)) {
      return {
        ok: false,
        status: 402,
        kind: 'signal',
        body: {
          error: 'ACH_RISK_BLOCKED',
          message: result === 'REROUTE'
            ? 'This bank account cannot be debited right now due to elevated return risk. Try another account or payment method.'
            : 'This payment needs additional review before we can debit your account. Contact your property manager or try again later.',
          signalResult: result,
        },
      };
    }
  }

  if (isBalanceCheckEnabled(env)) {
    const requiredCents = amountCents;
    if (availableCents != null && availableCents < requiredCents) {
      const msg = `Insufficient available balance (${(availableCents / 100).toFixed(2)} available, ${(requiredCents / 100).toFixed(2)} required).`;
      if (balanceBlocksCharge(env)) {
        return {
          ok: false,
          status: 402,
          kind: 'balance',
          body: {
            error: 'INSUFFICIENT_BALANCE',
            message: msg,
            availableCents,
            requiredCents,
          },
        };
      }
      return { ok: true, balanceWarning: true, availableCents, requiredCents };
    }
  }

  return { ok: true };
}

module.exports = {
  envFlag,
  isSignalEnabled,
  isBalanceCheckEnabled,
  balanceBlocksCharge,
  blockedSignalResults,
  evaluateAchGuardDecision,
};
