/**
 * Pre-ACH debit checks: Plaid Signal risk + optional Balance.
 * Money still moves via Stripe PaymentIntents only.
 */

const plaid = require('./plaid.service');
const {
  isSignalEnabled,
  isBalanceCheckEnabled,
  balanceBlocksCharge,
  evaluateAchGuardDecision,
} = require('./ach-guard-policy');

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
  let signalResult = null;
  let signal = null;
  let availableCents = null;

  if (isSignalEnabled()) {
    signal = await plaid.evaluateAchRisk(accessToken, accountId, amountCents, {
      userId,
      userPresent,
      clientTransactionId: clientTransactionId || `${context}-${Date.now()}`,
    });
    signalResult = signal.rulesetResult?.toUpperCase?.() || null;
  }

  if (isBalanceCheckEnabled()) {
    const balance = await plaid.getAvailableBalance(accessToken, accountId);
    availableCents = balance.availableCents;
  }

  const decision = evaluateAchGuardDecision({
    signalResult,
    availableCents,
    amountCents,
  });

  if (!decision.ok) {
    if (decision.kind === 'signal') {
      console.warn('[plaid-ach-guard] Signal blocked charge', {
        context,
        userId,
        accountId,
        amountCents,
        rulesetResult: signalResult,
        score: signal?.customerReturnRiskScore,
      });
    } else if (decision.kind === 'balance') {
      console.warn('[plaid-ach-guard] Balance blocked charge', {
        context,
        userId,
        accountId,
        amountCents,
        availableCents,
      });
    }
    return { ok: false, status: decision.status, body: decision.body };
  }

  if (decision.balanceWarning) {
    console.warn('[plaid-ach-guard] Balance warning (charge allowed)', {
      context,
      userId,
      accountId,
      amountCents,
      availableCents: decision.availableCents,
    });
  }

  const ok = { ok: true };
  if (signal) ok.signal = signal;
  if (availableCents != null) ok.balanceCents = availableCents;
  return ok;
}

module.exports = {
  assertAchDebitAllowed,
  isSignalEnabled,
  isBalanceCheckEnabled,
  balanceBlocksCharge,
  evaluateAchGuardDecision,
};
