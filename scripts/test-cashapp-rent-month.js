#!/usr/bin/env node
/**
 * Unit checks for Cash App note → rent month allocation,
 * calendar overages, chronological roll-forward, and deposit split.
 */
const assert = require('assert');
const {
  rentYmFromPayment,
  allocateCalendarMonths,
  allocateRentMonths,
  isDepositPayment,
  splitRentAndDepositRows,
} = require('../src/services/cashapp-import.service');

function pay(dateIso, notes, amount = 900, transactionId) {
  return {
    dateIso,
    date: new Date(`${dateIso}T12:00:00`),
    amount,
    notes,
    transactionId: transactionId || `tx-${dateIso}-${amount}`,
    sender: 'Lily Fortman',
  };
}

assert.strictEqual(rentYmFromPayment(pay('2026-07-31', 'rent for August +$900')), '2026-08');
assert.strictEqual(rentYmFromPayment(pay('2026-07-31', 'August rent')), '2026-08');
assert.strictEqual(rentYmFromPayment(pay('2026-08-02', 'for July')), '2026-07');
assert.strictEqual(rentYmFromPayment(pay('2026-12-28', 'for January')), '2027-01');
assert.strictEqual(rentYmFromPayment(pay('2026-07-15', '')), '2026-07');

{
  const { months } = allocateCalendarMonths(
    [pay('2026-07-31', 'rent for August +$900')],
    900
  );
  assert.strictEqual(months.length, 1);
  assert.strictEqual(months[0].periodStart, '2026-08-01');
  assert.strictEqual(months[0].periodLabel.includes('August'), true);
}

{
  // Excess in a calendar month is reported, not rolled forward.
  const { months, overages, unallocated } = allocateCalendarMonths(
    [
      pay('2026-08-01', 'August rent', 900, 'a'),
      pay('2026-08-15', 'extra August', 50, 'b'),
    ],
    900
  );
  assert.strictEqual(months.length, 1);
  assert.strictEqual(months[0].amount, 900);
  assert.strictEqual(overages.length, 1);
  assert.strictEqual(overages[0].ym, '2026-08');
  assert.strictEqual(overages[0].excess, 50);
  assert.strictEqual(unallocated.length, 0);
}

{
  const { months, overages, unallocated } = allocateCalendarMonths(
    [pay('2026-08-10', 'August rent', 450)],
    900
  );
  assert.strictEqual(months.length, 0);
  assert.strictEqual(overages.length, 0);
  assert.strictEqual(unallocated.length, 1);
  assert.strictEqual(unallocated[0].type, 'partial_month');
  assert.strictEqual(unallocated[0].shortfall, 450);
}

{
  // Chronological allocator rolls overflow into the next month.
  const { months, unallocated } = allocateRentMonths(
    [pay('2026-06-05', 'biweekly', 1350, 'big')],
    900
  );
  assert.strictEqual(months.length, 1);
  assert.strictEqual(months[0].periodStart, '2026-06-01');
  assert.strictEqual(months[0].amount, 900);
  assert.strictEqual(unallocated.length, 1);
  assert.strictEqual(unallocated[0].amount, 450);
  assert.strictEqual(unallocated[0].periodStart, '2026-07-01');
}

{
  const { months, unallocated } = allocateRentMonths(
    [
      pay('2026-06-01', 'half', 450, 'a'),
      pay('2026-06-15', 'half', 450, 'b'),
    ],
    900
  );
  assert.strictEqual(months.length, 1);
  assert.strictEqual(months[0].parts.length, 2);
  assert.strictEqual(unallocated.length, 0);
}

assert.strictEqual(isDepositPayment({ notes: 'security deposit' }), true);
assert.strictEqual(isDepositPayment({ notes: 'towards the deposit' }), true);
assert.strictEqual(isDepositPayment({ notes: 'sec dep' }), true);
assert.strictEqual(isDepositPayment({ notes: 'deposit + rent' }), false);
assert.strictEqual(isDepositPayment({ notes: 'August rent' }), false);

{
  const { rentRows, depositRows } = splitRentAndDepositRows([
    pay('2026-07-01', 'security deposit', 900, 'dep'),
    pay('2026-07-02', 'August rent', 900, 'rent'),
  ]);
  assert.strictEqual(depositRows.length, 1);
  assert.strictEqual(rentRows.length, 1);
  assert.strictEqual(depositRows[0].transactionId, 'dep');
  assert.strictEqual(rentRows[0].transactionId, 'rent');
}

console.log('test-cashapp-rent-month: ok');
