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
