/**
 * Owner Boots-on-site pay preview: unpaid visits and optional other-work
 * can be one charge. Keep in sync with resolvePayrollCharge on the server.
 */

export function parseOtherWorkAmount(raw) {
  if (raw == null || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0.5) return 0;
  return Math.round(n * 100) / 100;
}

export function formatPayDollars(cents) {
  const n = (Number(cents) || 0) / 100;
  if (Number.isInteger(n)) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

export const OWNER_PAY_METHOD_COPY = {
  cash_app: {
    label: 'Cash App Pay',
    speed: '~30 min',
    detail: 'Associate pay — confirm in Cash App and Instant Payout usually hits his bank in about 30 minutes.',
  },
  ach: {
    label: 'Bank transfer',
    speed: '3–5 days',
    detail: 'Fallback only when Cash App is unavailable. Instant Payout waits until ACH settles (3–5 business days).',
  },
};

export function payActionLabel(preview, method = 'cash_app') {
  if (!preview || preview.primaryAction === 'none') return 'Pay';
  const amount = preview.primaryAction === 'combined'
    ? formatPayDollars(preview.combinedCents)
    : preview.primaryAction === 'other'
      ? formatPayDollars(preview.otherCents)
      : formatPayDollars(preview.dueVisitCents);
  if (method === 'cash_app') {
    return preview.primaryAction === 'visits'
      ? `Pay visits ${amount} in Cash App`
      : `Pay ${amount} in Cash App`;
  }
  if (method === 'ach') {
    return preview.primaryAction === 'visits'
      ? `Pay visits ${amount} by bank transfer`
      : `Pay ${amount} by bank transfer`;
  }
  return preview.primaryLabel;
}

export function payoutKindLabel(payout) {
  const kind = payout?.payoutKind;
  const n = Number(payout?.visitCount) || 0;
  if (kind === 'custom') return 'other work';
  if (kind === 'mixed') return `${n} visit${n === 1 ? '' : 's'} + other work`;
  return `${n} visit${n === 1 ? '' : 's'}`;
}

export function buildSiteVisitPayPreview({
  visitCount = 0,
  visitCents = 0,
  outstandingCount = 0,
  outstandingCents = 0,
  otherWorkAmount = '',
  monthLabel = '',
} = {}) {
  const otherDollars = parseOtherWorkAmount(otherWorkAmount);
  const otherCents = Math.round(otherDollars * 100);
  const hasPeriodVisits = visitCount > 0 && visitCents > 0;
  const hasOutstandingOnly = !hasPeriodVisits && outstandingCount > 0 && outstandingCents > 0;
  const dueVisitCents = hasPeriodVisits ? visitCents : (hasOutstandingOnly ? outstandingCents : 0);
  const dueVisitCount = hasPeriodVisits ? visitCount : (hasOutstandingOnly ? outstandingCount : 0);
  const combinedCents = dueVisitCents + otherCents;
  const canCombine = dueVisitCents > 0 && otherCents >= 50;
  const visitWord = `unpaid visit${dueVisitCount === 1 ? '' : 's'}`;

  let headlineCents = dueVisitCents;
  let headline;
  if (canCombine) {
    headlineCents = combinedCents;
    headline = `${dueVisitCount} ${visitWord} + other work`;
  } else if (hasPeriodVisits) {
    headline = `${dueVisitCount} ${visitWord} · ${monthLabel}`.trim();
  } else if (hasOutstandingOnly) {
    headline = `${dueVisitCount} ${visitWord} from other months`;
  } else if (otherCents >= 50) {
    headlineCents = otherCents;
    headline = monthLabel ? `Other work · ${monthLabel}` : 'Other work';
  } else {
    headline = monthLabel ? `Nothing unpaid · ${monthLabel}` : 'Nothing unpaid';
  }

  let primaryAction = 'none';
  if (canCombine) primaryAction = 'combined';
  else if (hasPeriodVisits || hasOutstandingOnly) primaryAction = 'visits';
  else if (otherCents >= 50) primaryAction = 'other';

  const primaryLabel = primaryAction === 'combined'
    ? `Pay ${formatPayDollars(combinedCents)}`
    : primaryAction === 'visits'
      ? `Pay visits ${formatPayDollars(dueVisitCents)}`
      : primaryAction === 'other'
        ? `Pay ${formatPayDollars(otherCents)} for other work`
        : 'Pay';

  return {
    otherDollars,
    otherCents,
    dueVisitCents,
    dueVisitCount,
    combinedCents,
    canCombine,
    hasPeriodVisits,
    hasOutstandingOnly,
    headlineCents,
    headline,
    primaryAction,
    primaryLabel,
    combinedDetail: canCombine
      ? `${dueVisitCount} ${visitWord} (${formatPayDollars(dueVisitCents)}) + other work (${formatPayDollars(otherCents)})`
      : '',
  };
}

/**
 * Owner dashboard Boots-on-site pay nag.
 * Prefer this month's unpaid visits; otherwise fall back to leftover months.
 * Hide while a charge is processing so paid months do not keep nags up.
 */
export function buildOwnerVisitPayNag(visitPayroll, { loading = false } = {}) {
  const unpaidVisitCount = visitPayroll?.visitCount > 0
    ? visitPayroll.visitCount
    : (visitPayroll?.outstandingCount || 0);
  const unpaidVisitCents = visitPayroll?.visitCount > 0
    ? (visitPayroll.totalCents || 0)
    : (visitPayroll?.outstandingCents || 0);
  const show = !loading
    && unpaidVisitCount > 0
    && !visitPayroll?.processing;
  return {
    unpaidVisitCount,
    unpaidVisitCents,
    show,
    fromEarlierMonths: !(visitPayroll?.visitCount > 0) && unpaidVisitCount > 0,
  };
}
