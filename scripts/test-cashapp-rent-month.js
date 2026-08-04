/**
 * Quick unit checks for Cash App note → rent month allocation.
 */
const assert = require('assert');
const { rentYmFromPayment, allocateCalendarMonths } = require('../src/services/cashapp-import.service');

function pay(dateIso, notes, amount = 900) {
  return {
    dateIso,
    date: new Date(`${dateIso}T12:00:00`),
    amount,
    notes,
    transactionId: `tx-${dateIso}`,
    sender: 'Lily Fortman',
  };
}

assert.strictEqual(rentYmFromPayment(pay('2026-07-31', 'rent for August +$900')), '2026-08');
assert.strictEqual(rentYmFromPayment(pay('2026-07-31', 'August rent')), '2026-08');
assert.strictEqual(rentYmFromPayment(pay('2026-08-02', 'for July')), '2026-07');
assert.strictEqual(rentYmFromPayment(pay('2026-12-28', 'for January')), '2027-01');
assert.strictEqual(rentYmFromPayment(pay('2026-07-15', '')), '2026-07');

const { months } = allocateCalendarMonths(
  [pay('2026-07-31', 'rent for August +$900')],
  900
);
assert.strictEqual(months.length, 1);
assert.strictEqual(months[0].periodStart, '2026-08-01');
assert.strictEqual(months[0].periodLabel.includes('August'), true);

console.log('test-cashapp-rent-month: ok');
