/**
 * Shared utility billing period helpers.
 */

const { billingMonthKey, monthBounds } = require('./house-cover');

function dayOnly(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s.slice(0, 10);
}

/** True when period exactly matches the calendar month of period_end. */
function isCalendarMonthPeriod(periodStart, periodEnd) {
  const end = dayOnly(periodEnd);
  const start = dayOnly(periodStart);
  const ym = billingMonthKey(end);
  if (!ym || !start || !end) return false;
  const bounds = monthBounds(ym);
  if (!bounds) return false;
  return start === bounds.start && end === bounds.end;
}

function groupHasProviderPeriod(bills) {
  return (bills || []).some((b) => !isCalendarMonthPeriod(b.period_start, b.period_end));
}

/**
 * Prefer real provider cycles (mid-month HRSD/Dominion) over calendar-month
 * phantoms created when Gmail lacked a billing period.
 * Then newest period_end wins.
 */
function rankCollectibleBills(bills) {
  return [...(bills || [])].sort((a, b) => {
    const aProv = isCalendarMonthPeriod(a.period_start, a.period_end) ? 0 : 1;
    const bProv = isCalendarMonthPeriod(b.period_start, b.period_end) ? 0 : 1;
    if (bProv !== aProv) return bProv - aProv;
    const aEnd = dayOnly(a.period_end);
    const bEnd = dayOnly(b.period_end);
    if (aEnd !== bEnd) return aEnd < bEnd ? 1 : -1;
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

function pickLatestCollectibleBill(bills) {
  const ranked = rankCollectibleBills(bills);
  return ranked[0] || null;
}

module.exports = {
  dayOnly,
  isCalendarMonthPeriod,
  groupHasProviderPeriod,
  rankCollectibleBills,
  pickLatestCollectibleBill,
};
