#!/usr/bin/env node
/**
 * Sanity checks for tenant balance month math (paid → not overdue).
 * Run: node scripts/test-balance-paid-month.js
 */

function monthStartNY(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d).replace(/(\d{4})-(\d{2})-\d{2}/, (_, y, m) => `${y}-${m}-01`);
}

function nextDueAfter(monthStart) {
  const [y, m] = monthStart.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

function computeTotalDue(monthlyRent, paidThisMonth, lateFeeBalance) {
  const rentRemaining = Math.max(0, Math.round((monthlyRent - paidThisMonth) * 100) / 100);
  return Math.round((rentRemaining + lateFeeBalance) * 100) / 100;
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const ms = monthStartNY(new Date('2026-07-31T15:00:00Z'));
assert(ms === '2026-07-01', `July NY month start → ${ms}`);
assert(nextDueAfter('2026-07-01') === '2026-08-01', 'next due after July is Aug 1');
assert(nextDueAfter('2026-12-01') === '2027-01-01', 'next due after Dec rolls year');

assert(computeTotalDue(900, 900, 0) === 0, 'fully paid → $0 due');
assert(computeTotalDue(900, 0, 0) === 900, 'unpaid → full rent');
assert(computeTotalDue(900, 400, 50) === 550, 'partial + late fees');
assert(computeTotalDue(900, 900, 150) === 150, 'paid rent + late fees only');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll balance paid-month checks passed.');
