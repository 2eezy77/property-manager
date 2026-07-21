/**
 * Norfolk, VA (America/New_York) datetime helpers for inspection scheduling.
 */

const TZ = 'America/New_York';

const norfolkFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function partsFromDate(date) {
  const raw = Object.fromEntries(
    norfolkFmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  );
  const h = parseInt(raw.hour, 10);
  return {
    year: parseInt(raw.year, 10),
    month: parseInt(raw.month, 10),
    day: parseInt(raw.day, 10),
    hour: h === 24 ? 0 : h,
    minute: parseInt(raw.minute, 10),
  };
}

function norfolkPartsMatch(date, want) {
  const got = partsFromDate(date);
  return (
    got.year === want.year
    && got.month === want.month
    && got.day === want.day
    && got.hour === want.hour
    && got.minute === want.minute
  );
}

/** datetime-local value interpreted as Norfolk local → UTC Date */
function parseNorfolkLocal(localStr) {
  if (!localStr || typeof localStr !== 'string') return null;
  const m = localStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const want = {
    year: +m[1],
    month: +m[2],
    day: +m[3],
    hour: +m[4],
    minute: +m[5],
  };

  // EDT (UTC-4) and EST (UTC-5) — probe both, then minute-walk if DST edge case
  for (const offsetHours of [4, 5]) {
    const candidate = Date.UTC(want.year, want.month - 1, want.day, want.hour + offsetHours, want.minute);
    if (norfolkPartsMatch(new Date(candidate), want)) return new Date(candidate);
  }

  const base = Date.UTC(want.year, want.month - 1, want.day, want.hour + 4, want.minute);
  for (let delta = -240; delta <= 240; delta += 1) {
    const candidate = base + delta * 60 * 1000;
    if (norfolkPartsMatch(new Date(candidate), want)) return new Date(candidate);
  }

  return null;
}

function formatNorfolkDateTime(date) {
  if (!date) return '';
  return new Date(date).toLocaleString('en-US', {
    timeZone: TZ,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function norfolkDateKey(date) {
  const p = partsFromDate(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

const MS_24H = 24 * 60 * 60 * 1000;
const MS_30M = 30 * 60 * 1000;

function isAtLeast24HoursAhead(plannedAt, now = new Date()) {
  return plannedAt.getTime() - now.getTime() >= MS_24H;
}

/** Check-in opens 30 min before planned time, same Norfolk calendar day. */
function isWithinCheckInWindow(plannedAt, now = new Date()) {
  if (!plannedAt) return true;
  if (norfolkDateKey(plannedAt) !== norfolkDateKey(now)) {
    return false;
  }
  const open = plannedAt.getTime() - MS_30M;
  return now.getTime() >= open;
}

function minPlannedVisitLocalString(now = new Date()) {
  const earliest = new Date(now.getTime() + MS_24H + MS_30M);
  const p = partsFromDate(earliest);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Current Norfolk local time for datetime-local min (same-day visits). */
function norfolkNowLocalString(now = new Date()) {
  const p = partsFromDate(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Norfolk calendar year + month (1–12) for a given instant. */
function norfolkYearMonth(now = new Date()) {
  const p = partsFromDate(now);
  return { year: p.year, month: p.month };
}

/** UTC bounds for a Norfolk calendar month (start inclusive, end exclusive). */
function norfolkMonthWindow(year, month) {
  const startLocal = `${year}-${String(month).padStart(2, '0')}-01T00:00`;
  const endYear = month === 12 ? year + 1 : year;
  const endMonth = month === 12 ? 1 : month + 1;
  const endLocal = `${endYear}-${String(endMonth).padStart(2, '0')}-01T00:00`;
  return {
    start: parseNorfolkLocal(startLocal),
    end: parseNorfolkLocal(endLocal),
  };
}

module.exports = {
  TZ,
  parseNorfolkLocal,
  formatNorfolkDateTime,
  norfolkDateKey,
  norfolkYearMonth,
  norfolkMonthWindow,
  isAtLeast24HoursAhead,
  isWithinCheckInWindow,
  minPlannedVisitLocalString,
  norfolkNowLocalString,
  MS_24H,
};
