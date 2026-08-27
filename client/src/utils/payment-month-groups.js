/**
 * Billing-month grouping for Manager Payments history.
 * Keep in sync with src/utils/payment-month.js (tested via scripts/test-rent-collection-stats.js).
 * Calendar year-month on the timestamp — not local getMonth() — so Aug 1 UTC stays August.
 */

export function calendarMonthKey(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const m = raw.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
  }
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function groupPaymentsByMonth(rows, now = new Date()) {
  const map = new Map();
  for (const p of rows || []) {
    const key = calendarMonthKey(p.period_start)
      || calendarMonthKey(p.paid_at)
      || calendarMonthKey(p.created_at)
      || 'unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  const current = currentMonthKey(now);
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, payments]) => {
      const succeeded = payments.filter((p) => p.status === 'succeeded');
      const collected = succeeded.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const rent = succeeded.filter((p) => p.payment_type === 'rent');
      const utility = succeeded.filter((p) => p.payment_type === 'utility');
      const rentCollected = rent.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const utilityCollected = utility.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      return {
        key,
        payments,
        count: payments.length,
        collected: Math.round(collected * 100) / 100,
        rentCollected: Math.round(rentCollected * 100) / 100,
        utilityCollected: Math.round(utilityCollected * 100) / 100,
        rentCount: rent.length,
        utilityCount: utility.length,
        isCurrent: key === current,
      };
    });
}

export function monthGroupSummary(month) {
  if (!month) return '';
  const count = month.count || 0;
  const rentCount = month.rentCount || 0;
  const utilityCount = month.utilityCount || 0;
  const otherCount = count - rentCount - utilityCount;

  if (utilityCount > 0 && rentCount === 0 && otherCount === 0) {
    return `${utilityCount} utility payment${utilityCount === 1 ? '' : 's'} · ${formatUsd(month.utilityCollected)} succeeded`;
  }
  if (rentCount > 0 && utilityCount === 0 && otherCount === 0) {
    return `${rentCount} rent payment${rentCount === 1 ? '' : 's'} · ${formatUsd(month.rentCollected)} succeeded`;
  }

  const parts = [`${count} payment${count === 1 ? '' : 's'}`];
  parts.push(`${formatUsd(month.collected)} succeeded`);
  if (rentCount) parts.push(`${formatUsd(month.rentCollected)} rent`);
  if (utilityCount) parts.push(`${formatUsd(month.utilityCollected)} utilities`);
  return parts.join(' · ');
}

export function monthLabelFromKey(key) {
  if (!key || key === 'unknown') return 'Unknown period';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Short month label from a DATE / ISO value without local-timezone rollback. */
export function formatPeriodMonth(raw) {
  const key = calendarMonthKey(raw);
  if (!key || key === 'unknown') return '—';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
