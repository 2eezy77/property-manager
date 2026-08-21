#!/usr/bin/env node
/**
 * Regression: Norfolk local parse + site-visit check-in / 24h-ahead windows.
 * Pure timezone helpers — no DB.
 *
 * Run: npm run test:norfolk-time
 */
'use strict';

const assert = require('assert');
const {
  parseNorfolkLocal,
  norfolkDateKey,
  isAtLeast24HoursAhead,
  isWithinCheckInWindow,
  norfolkMonthWindow,
} = require('../src/utils/norfolk-time');

assert.strictEqual(parseNorfolkLocal(null), null);
assert.strictEqual(parseNorfolkLocal('not-a-date'), null);

// Summer EDT (UTC-4): 2026-08-14 15:30 Norfolk → 19:30Z
{
  const d = parseNorfolkLocal('2026-08-14T15:30');
  assert.ok(d);
  assert.strictEqual(d.toISOString(), '2026-08-14T19:30:00.000Z');
  assert.strictEqual(norfolkDateKey(d), '2026-08-14');
}

// Winter EST (UTC-5): 2026-01-15 09:00 Norfolk → 14:00Z
{
  const d = parseNorfolkLocal('2026-01-15T09:00');
  assert.ok(d);
  assert.strictEqual(d.toISOString(), '2026-01-15T14:00:00.000Z');
}

{
  const planned = parseNorfolkLocal('2026-08-20T10:00');
  const nowOk = new Date(planned.getTime() - 25 * 60 * 60 * 1000);
  const nowTooSoon = new Date(planned.getTime() - 23 * 60 * 60 * 1000);
  assert.strictEqual(isAtLeast24HoursAhead(planned, nowOk), true);
  assert.strictEqual(isAtLeast24HoursAhead(planned, nowTooSoon), false);
}

// Check-in opens 30 min before planned, same Norfolk calendar day only
{
  const planned = parseNorfolkLocal('2026-08-14T15:00');
  const atOpen = new Date(planned.getTime() - 30 * 60 * 1000);
  const beforeOpen = new Date(planned.getTime() - 31 * 60 * 1000);
  const nextDay = parseNorfolkLocal('2026-08-15T14:50');
  assert.strictEqual(isWithinCheckInWindow(planned, atOpen), true);
  assert.strictEqual(isWithinCheckInWindow(planned, planned), true);
  assert.strictEqual(isWithinCheckInWindow(planned, beforeOpen), false);
  assert.strictEqual(isWithinCheckInWindow(planned, nextDay), false);
}

{
  const { start, end } = norfolkMonthWindow(2026, 8);
  assert.strictEqual(norfolkDateKey(start), '2026-08-01');
  assert.strictEqual(norfolkDateKey(end), '2026-09-01');
}

console.log('test-norfolk-time: OK');
