/**
 * Manager Payments month grouping + method labels.
 * Prefer billing period_start so rent lands in the right month section.
 */

const METHOD_LABEL = {
  cash_app: 'Cash App',
  check: 'Check',
  zelle: 'Zelle',
  venmo: 'Venmo',
  wire: 'Wire',
  cash: 'Cash',
  other: 'Other',
};

export function monthKeyFromDate(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function currentMonthKey(now = new Date()) {
  return monthKeyFromDate(now);
}

export function monthLabelFromKey(key) {
  if (!key || key === 'unknown') return 'Unknown period';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Prefer billing period_start so rent lands in the right month section. */
export function paymentMonthKey(p) {
  return (
    monthKeyFromDate(p?.period_start)
    || monthKeyFromDate(p?.paid_at)
    || monthKeyFromDate(p?.created_at)
    || 'unknown'
  );
}

export function groupPaymentsByMonth(rows, { now = new Date() } = {}) {
  const current = currentMonthKey(now);
  const map = new Map();
  for (const p of rows || []) {
    const key = paymentMonthKey(p);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, payments]) => {
      const succeeded = payments.filter((row) => row.status === 'succeeded');
      const collected = succeeded.reduce((s, row) => s + (Number(row.amount) || 0), 0);
      return {
        key,
        label: monthLabelFromKey(key),
        payments,
        count: payments.length,
        collected,
        isCurrent: key === current,
      };
    });
}

/**
 * Prefer source so Stripe card is never mislabeled as ACH
 * when payment_method is missing / generic.
 */
export function paymentMethodLabel(p) {
  if (p?.source === 'stripe_card' || p?.payment_method === 'card') {
    return p.partial_rent === 'true' ? 'Card (partial)' : 'Card';
  }
  if (p?.source === 'stripe_cashapp') return 'Cash App Pay';
  if (p?.source === 'cash_app_import') {
    return p.partial_rent === 'true' ? 'Cash App (off-site, partial)' : 'Cash App (archived off-app)';
  }
  if (p?.payment_method) {
    const base = METHOD_LABEL[p.payment_method] || p.payment_method;
    return p.partial_rent === 'true' ? `${base} (partial)` : base;
  }
  if (p?.stripe_payment_intent_id) return 'Bank (ACH)';
  if (p?.status === 'succeeded') return 'ACH';
  return '—';
}
