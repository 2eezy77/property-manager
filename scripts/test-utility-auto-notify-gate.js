#!/usr/bin/env node
/**
 * Auto-notify gate + draft hold rules (calendar phantoms / non-Current Charges).
 */
const assert = require('assert');
const {
  autoNotifyEnabled,
  draftAutoNotifyHoldReason,
} = require('../src/services/utility-comms.service');

const prev = process.env.UTILITIES_AUTO_NOTIFY_ENABLED;
try {
  delete process.env.UTILITIES_AUTO_NOTIFY_ENABLED;
  assert.strictEqual(autoNotifyEnabled(), false);

  process.env.UTILITIES_AUTO_NOTIFY_ENABLED = 'false';
  assert.strictEqual(autoNotifyEnabled(), false);

  process.env.UTILITIES_AUTO_NOTIFY_ENABLED = '1';
  assert.strictEqual(autoNotifyEnabled(), false, 'only exact true enables');

  process.env.UTILITIES_AUTO_NOTIFY_ENABLED = 'true';
  assert.strictEqual(autoNotifyEnabled(), true);
} finally {
  if (prev === undefined) delete process.env.UTILITIES_AUTO_NOTIFY_ENABLED;
  else process.env.UTILITIES_AUTO_NOTIFY_ENABLED = prev;
}

{
  const phantom = {
    id: 'aug',
    service_type: 'water',
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    amount_source: 'parsed_total',
  };
  assert.strictEqual(
    draftAutoNotifyHoldReason(phantom, { hasProviderOpenForService: true }),
    'calendar_phantom_with_provider_open'
  );
  assert.strictEqual(
    draftAutoNotifyHoldReason(phantom, { hasProviderOpenForService: false }),
    null,
    'phantom alone may notify when no provider cycle is open'
  );
}

{
  const electricFallback = {
    id: 'e1',
    service_type: 'electric',
    period_start: '2026-06-18',
    period_end: '2026-07-17',
    chargeable_after: '2020-01-01',
    amount_source: 'amount_due_fallback',
  };
  assert.strictEqual(
    draftAutoNotifyHoldReason(electricFallback, { hasProviderOpenForService: false }),
    'need_current_charges'
  );
}

{
  const providerWater = {
    id: 'hrsd',
    service_type: 'water',
    period_start: '2026-06-06',
    period_end: '2026-07-09',
    amount_source: 'parsed_total',
  };
  assert.strictEqual(
    draftAutoNotifyHoldReason(providerWater, { hasProviderOpenForService: true }),
    null
  );
}

{
  const futureElectric = {
    id: 'e2',
    service_type: 'electric',
    period_start: '2099-01-01',
    period_end: '2099-01-31',
    chargeable_after: '2099-01-31',
    amount_source: 'current_charges',
  };
  assert.strictEqual(
    draftAutoNotifyHoldReason(futureElectric, { hasProviderOpenForService: false }),
    'not_chargeable'
  );
}

console.log('test-utility-auto-notify-gate: ok');
