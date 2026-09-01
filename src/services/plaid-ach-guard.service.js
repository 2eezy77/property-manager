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

function blockedSignalResults() {
  const raw = process.env.PLAID_SIGNAL_BLOCK_RESULTS || 'REVIEW,REROUTE';
  return new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
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

      if (result && blockSet.has(result)) {
        console.warn('[plaid-ach-guard] Signal blocked charge', {
          context,
          userId,
          accountId,
          amountCents,
          rulesetResult: result,
          score: signal.customerReturnRiskScore,
        });
        return {
          ok: false,
          status: 402,
          body: {
            error: 'ACH_RISK_BLOCKED',
            message: result === 'REROUTE'
              ? 'This bank account cannot be debited right now due to elevated return risk. Try another account or payment method.'
              : 'This payment needs additional review before we can debit your account. Contact your property manager or try again later.',
            signalResult: result,
          },
        };
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
};
