/**
 * Pre-ACH debit checks: Plaid Signal risk + optional Balance.
 * Money still moves via Stripe PaymentIntents only.
 */

const plaid = require('./plaid.service');

function envFlag(name, defaultFalse = false) {
  const v = process.env[name];
  if (v == null || v === '') return defaultFalse;
  return v === '1' || v.toLowerCase() === 'true';
}

function isSignalEnabled() {
  return envFlag('PLAID_SIGNAL_ENABLED');
}

function isBalanceCheckEnabled() {
  return envFlag('PLAID_BALANCE_CHECK_ENABLED');
}

function balanceBlocksCharge() {
  return process.env.PLAID_BALANCE_BLOCK !== 'false';
}

function signalHardBlockEnabled() {
  return envFlag('PLAID_SIGNAL_HARD_BLOCK');
}

function blockedSignalResults() {
  const raw = process.env.PLAID_SIGNAL_BLOCK_RESULTS || 'DENY,BLOCK';
  return new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
}

function isSoftSignalAllow(result, score) {
  if (!result || result === 'ACCEPT' || result === 'REROUTE' || result === 'REVIEW') {
    return true;
  }
  return score == null || Number.isNaN(Number(score));
}

/**
 * Run Signal + Balance gates before Stripe ACH debit.
 * @returns {Promise<{ ok: true, signal?: object, balanceCents?: number } | { ok: false, status: number, body: object }>}
 */
async function assertAchDebitAllowed({
  accessToken,
  accountId,
  amountCents,
  userId,
  userPresent = true,
  clientTransactionId,
  context = 'ach_debit',
} = {}, deps = {}) {
  const evaluateAchRisk = deps.evaluateAchRisk || plaid.evaluateAchRisk;
  const getAvailableBalance = deps.getAvailableBalance || plaid.getAvailableBalance;

  if (isSignalEnabled()) {
    try {
      const signal = await evaluateAchRisk(accessToken, accountId, amountCents, {
        userId,
        userPresent,
        clientTransactionId: clientTransactionId || `${context}-${Date.now()}`,
      });

      const result = signal.rulesetResult?.toUpperCase?.() || null;
      const blockSet = blockedSignalResults();

      if (result && result !== 'ACCEPT') {
        const score = signal.customerReturnRiskScore;
        // Live Lily rent: REROUTE + score null must log and still charge.
        if (
          signalHardBlockEnabled()
          && blockSet.has(result)
          && !isSoftSignalAllow(result, score)
        ) {
          console.warn('[plaid-ach-guard] Signal blocked charge', {
            context,
            userId,
            accountId,
            amountCents,
            rulesetResult: result,
            score,
          });
          return {
            ok: false,
            status: 402,
            body: {
              error: 'ACH_RISK_BLOCKED',
              message: 'This payment needs additional review before we can debit your account. Contact your property manager or try again later.',
              signalResult: result,
            },
          };
        }
        console.warn('[plaid-ach-guard] Signal flagged charge; allowing Stripe (fail-open)', {
          context,
          userId,
          accountId,
          amountCents,
          rulesetResult: result,
          score,
        });
      }
    } catch (err) {
      const plaidErr = err.response?.data || {};
      console.warn('[plaid-ach-guard] Signal check failed; allowing charge to reach Stripe', {
        context,
        userId,
        accountId,
        errorType: plaidErr.error_type || err.code,
        errorCode: plaidErr.error_code,
        errorMessage: plaidErr.error_message || err.message,
      });
    }
  }

  if (isBalanceCheckEnabled()) {
    try {
      const balance = await getAvailableBalance(accessToken, accountId);
      const requiredCents = amountCents;

      if (balance.availableCents != null && balance.availableCents < requiredCents) {
        const msg = `Insufficient available balance (${(balance.availableCents / 100).toFixed(2)} available, ${(requiredCents / 100).toFixed(2)} required).`;

        if (balanceBlocksCharge()) {
          console.warn('[plaid-ach-guard] Balance blocked charge', {
            context,
            userId,
            accountId,
            amountCents,
            availableCents: balance.availableCents,
          });
          return {
            ok: false,
            status: 402,
            body: {
              error: 'INSUFFICIENT_BALANCE',
              message: msg,
              availableCents: balance.availableCents,
              requiredCents,
            },
          };
        }

        console.warn('[plaid-ach-guard] Balance warning (charge allowed)', {
          context,
          userId,
          accountId,
          amountCents,
          availableCents: balance.availableCents,
        });
      }
    } catch (err) {
      const plaidErr = err.response?.data || {};
      console.warn('[plaid-ach-guard] Balance check failed; allowing charge to reach Stripe', {
        context,
        userId,
        accountId,
        errorType: plaidErr.error_type || err.code,
        errorCode: plaidErr.error_code,
        errorMessage: plaidErr.error_message || err.message,
      });
    }
  }

  return { ok: true };
}

module.exports = {
  assertAchDebitAllowed,
  isSignalEnabled,
  isBalanceCheckEnabled,
  signalHardBlockEnabled,
};
