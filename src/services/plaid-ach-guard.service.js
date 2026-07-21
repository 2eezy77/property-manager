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
}) {
  if (isSignalEnabled()) {
    const signal = await plaid.evaluateAchRisk(accessToken, accountId, amountCents, {
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
  }

  if (isBalanceCheckEnabled()) {
    const balance = await plaid.getAvailableBalance(accessToken, accountId);
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
  }

  return { ok: true };
}

module.exports = {
  assertAchDebitAllowed,
  isSignalEnabled,
  isBalanceCheckEnabled,
};
