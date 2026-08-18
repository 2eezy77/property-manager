/**
 * Client copy of src/utils/site-visit-months.js — keep grouping rules in sync.
 */

const MS_24H = 24 * 60 * 60 * 1000;
const UPCOMING_STATUSES = new Set(['approved', 'pending_approval']);

export function norfolkMonthValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
}

export function monthLabelFromKey(key) {
  if (!key || key === 'unknown') return 'Unknown month';
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function visitMonthKey(visit) {
  const iso = visit?.plannedVisitAt || visit?.visitedAt || visit?.approvedAt || visit?.createdAt;
  if (!iso) return 'unknown';
  return norfolkMonthValue(new Date(iso));
}

export function visitNeedsShortNoticeWarning(visit, now = Date.now()) {
  if (!visit?.plannedVisitAt) return false;
  const needs24h = (visit.roomTargets || []).some(
    (t) => t.tenantId && t.roomPurpose !== 'vacant_showing'
  );
  if (!needs24h) return false;
  const msLeft = new Date(visit.plannedVisitAt).getTime() - now;
  return msLeft > 0 && msLeft < MS_24H;
}

export function visitIsLeftover(visit, now = Date.now(), currentMonth = norfolkMonthValue()) {
  if (!UPCOMING_STATUSES.has(visit?.status)) return false;
  const monthKey = visitMonthKey(visit);
  if (monthKey !== 'unknown' && monthKey < currentMonth) return true;
  if (!visit?.plannedVisitAt) return false;
  return new Date(visit.plannedVisitAt).getTime() < now;
}

export function splitUpcomingVisits(visits, currentMonth = norfolkMonthValue(), now = Date.now()) {
  const upcoming = (visits || []).filter((v) => UPCOMING_STATUSES.has(v.status));
  return {
    upcomingNow: upcoming.filter((v) => !visitIsLeftover(v, now, currentMonth)),
    upcomingPast: upcoming.filter((v) => visitIsLeftover(v, now, currentMonth)),
  };
}

function monthIsPaid(key, rows, paidMonths = {}) {
  if (paidMonths[key]) return true;
  return rows.length > 0 && rows.every((v) => v.payoutId);
}

export function groupVisitsByMonth(visits, { currentMonth = norfolkMonthValue(), paidMonths = {} } = {}) {
  const map = new Map();
  for (const visit of visits || []) {
    const key = visitMonthKey(visit);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(visit);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, rows]) => {
      const leftoverCount = rows.filter((v) => UPCOMING_STATUSES.has(v.status)).length;
      const isPaid = monthIsPaid(key, rows, paidMonths);
      return {
        key,
        label: monthLabelFromKey(key),
        visits: rows,
        count: rows.length,
        leftoverCount,
        isCurrent: key === currentMonth,
        isPast: key !== 'unknown' && key < currentMonth,
        isPaid,
      };
    });
}

export function earlierMonthsCaption(groups) {
  if (!groups?.length) return '';
  if (groups.every((g) => g.isPaid)) {
    return 'Already paid. Tap a month if you need to check.';
  }
  return 'Closed leftovers. Tap a month if you need to check.';
}
