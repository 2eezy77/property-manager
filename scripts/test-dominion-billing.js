#!/usr/bin/env node
/** Unit checks for dominion-billing.service.js */
const {
  parseDominionAmounts,
  resolveElectricChargeAmount,
  computeChargeableAfter,
  periodFromDominionStatement,
  isElectricBillChargeable,
  validateElectricAmount,
} = require('../src/services/dominion-billing.service');

let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`, detail ?? '');
  }
}

const both = parseDominionAmounts(
  'Current Charges: $184.64. Amount Due: $744.21. Total account balance $744.21'
);
assert('prefers current charges', both.tenant_charge_amount === 184.64);
assert('statement balance', both.statement_balance === 744.21);
assert('source current_charges', both.amount_source === 'current_charges');

const fallback = parseDominionAmounts('Amount Due: 744.21');
assert('amount due fallback', fallback.tenant_charge_amount === 744.21);
assert('fallback source', fallback.amount_source === 'amount_due_fallback');
assert('fallback warns', fallback.warnings.length > 0);

assert(
  'resolve from parsed',
  resolveElectricChargeAmount({ tenant_charge_amount: 184.64 }) === 184.64
);
assert(
  'resolve from bill total',
  resolveElectricChargeAmount({ total_amount: 100 }) === 100
);

assert('chargeable after period end', computeChargeableAfter('2026-05-14') === '2026-05-14');

{
  const cycle = periodFromDominionStatement({ statementDate: '2026-07-17', billingDays: 30 });
  assert('Dominion 30-day period_end is statement', cycle.period_end === '2026-07-17');
  assert('Dominion 30-day period_start', cycle.period_start === '2026-06-18', cycle);
}
{
  const bad = periodFromDominionStatement({ statementDate: '2026-07-17', billingDays: 0 });
  assert('invalid billingDays keeps null start', bad.period_start == null && bad.period_end === '2026-07-17');
}
{
  const fromDate = periodFromDominionStatement({
    statementDate: new Date('2026-08-14T15:00:00Z'),
    billingDays: 31,
  });
  assert('Date object statementDate', fromDate.period_end === '2026-08-14' && fromDate.period_start === '2026-07-15', fromDate);
}

assert(
  'chargeable when period ended',
  isElectricBillChargeable({ service_type: 'electric', chargeable_after: '2020-01-01' })
);
assert(
  'not chargeable future period',
  !isElectricBillChargeable({ service_type: 'electric', chargeable_after: '2099-12-31' })
);
assert(
  'water always chargeable',
  isElectricBillChargeable({ service_type: 'water', chargeable_after: '2099-12-31' })
);

const valWarn = validateElectricAmount({
  tenant_charge_amount: 744.21,
  statement_balance: 744.21,
});
assert('validate balance match warns', valWarn.length >= 1);

process.exit(failed ? 1 : 0);
