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

/** Amount match for Gmail calendar-default merge into an open provider bill. */
function amountsNearlyEqual(a, b, epsilon = 0.02) {
  const left = Number(a);
  const right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < epsilon;
}

/**
 * Prefer an open provider-period bill with the same amount (±epsilon) over creating
 * a calendar-month phantom from a Gmail import that lacked period_parsed.
 */
function pickMatchingOpenProviderBill(bills, amount, epsilon = 0.02) {
  return (
    (bills || []).find((b) => {
      if (isCalendarMonthPeriod(b.period_start, b.period_end)) return false;
      const billAmt = Number(b.tenant_charge_amount ?? b.total_amount);
      return amountsNearlyEqual(billAmt, amount, epsilon);
    }) || null
  );
}

/**
 * Period bounds when merging a parsed Gmail row into an existing draft.
 * Never let a calendar-default import overwrite a mid-month provider period.
 */
function resolveMergedBillingPeriods({ existing, parsed, bounds }) {
  const existingStart = dayOnly(existing.period_start);
  const existingEnd = dayOnly(existing.period_end);
  const existingIsProvider = !isCalendarMonthPeriod(existingStart, existingEnd);

  if (parsed.period_parsed && parsed.period_start && parsed.period_end) {
    const parsedStart = dayOnly(parsed.period_start);
    const parsedEnd = dayOnly(parsed.period_end);
    return {
      periodStart: existingStart <= parsedStart ? existingStart : parsedStart,
      periodEnd: existingEnd >= parsedEnd ? existingEnd : parsedEnd,
    };
  }
  if (existingIsProvider) {
    return { periodStart: existingStart, periodEnd: existingEnd };
  }
  return {
    periodStart: bounds?.start || (existingStart <= dayOnly(parsed.period_start)
      ? existingStart
      : dayOnly(parsed.period_start)),
    periodEnd: bounds?.end || (existingEnd >= dayOnly(parsed.period_end)
      ? existingEnd
      : dayOnly(parsed.period_end)),
  };
}

/**
 * Hold auto-notify for calendar-month phantoms while a real provider cycle is open
 * for the same property + service.
 */
function shouldHoldAutoNotifyForCalendarPhantom(bill, openBills) {
  if (!bill || !isCalendarMonthPeriod(bill.period_start, bill.period_end)) return false;
  return (openBills || []).some(
    (b) =>
      b.property_id === bill.property_id &&
      String(b.service_type) === String(bill.service_type) &&
      !isCalendarMonthPeriod(b.period_start, b.period_end)
  );
}

/**
 * Hold electric notify until amount is trusted Current Charges (not balance fallback).
 */
function shouldHoldAutoNotifyForElectricAmountSource(bill) {
  if (!bill || bill.service_type !== 'electric') return false;
  return (
    bill.amount_source === 'amount_due_fallback' || bill.amount_source === 'parsed_total'
  );
}

module.exports = {
  dayOnly,
  isCalendarMonthPeriod,
  groupHasProviderPeriod,
  rankCollectibleBills,
  pickLatestCollectibleBill,
  amountsNearlyEqual,
  pickMatchingOpenProviderBill,
  resolveMergedBillingPeriods,
  shouldHoldAutoNotifyForCalendarPhantom,
  shouldHoldAutoNotifyForElectricAmountSource,
};
