#!/usr/bin/env node
/**
 * Regression: auto-notify flag + hold reasons (Dominion fallback / calendar phantoms).
 * Run: npm run test:utility-auto-notify
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  autoNotifyEnabled,
  draftAutoNotifyHoldReason,
} = require('../src/services/utility-comms.service');

const prev = process.env.UTILITIES_AUTO_NOTIFY_ENABLED;
try {
  delete process.env.UTILITIES_AUTO_NOTIFY_ENABLED;
  assert.strictEqual(autoNotifyEnabled(), false, 'default off');

  process.env.UTILITIES_AUTO_NOTIFY_ENABLED = 'false';
  assert.strictEqual(autoNotifyEnabled(), false);

  process.env.UTILITIES_AUTO_NOTIFY_ENABLED = 'true';
  assert.strictEqual(autoNotifyEnabled(), true);

  process.env.UTILITIES_AUTO_NOTIFY_ENABLED = 'TRUE';
  assert.strictEqual(autoNotifyEnabled(), false, 'strict === true only');
} finally {
  if (prev === undefined) delete process.env.UTILITIES_AUTO_NOTIFY_ENABLED;
  else process.env.UTILITIES_AUTO_NOTIFY_ENABLED = prev;
}

assert.strictEqual(
  draftAutoNotifyHoldReason({
    service_type: 'electric',
    amount_source: 'amount_due_fallback',
    period_start: '2026-07-15',
    period_end: '2026-08-14',
  }),
  'amount_source=amount_due_fallback'
);

assert.strictEqual(
  draftAutoNotifyHoldReason({
    service_type: 'electric',
    amount_source: 'parsed_total',
    period_start: '2026-07-15',
    period_end: '2026-08-14',
  }),
  'amount_source=parsed_total'
);

assert.strictEqual(
  draftAutoNotifyHoldReason({
    service_type: 'electric',
    amount_source: 'current_charges',
    period_start: '2026-07-15',
    period_end: '2026-08-14',
  }),
  null
);

assert.strictEqual(
  draftAutoNotifyHoldReason(
    {
      service_type: 'water',
      amount_source: null,
      period_start: '2026-08-01',
      period_end: '2026-08-31',
    },
    { hasProviderOpenForService: true }
  ),
  'calendar-month phantom while provider-period bill is open'
);

assert.strictEqual(
  draftAutoNotifyHoldReason(
    {
      service_type: 'water',
      period_start: '2026-06-06',
      period_end: '2026-07-09',
    },
    { hasProviderOpenForService: true }
  ),
  null,
  'provider-period water is not held'
);

assert.strictEqual(
  draftAutoNotifyHoldReason(
    {
      service_type: 'water',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
    },
    { hasProviderOpenForService: false }
  ),
  null,
  'calendar water alone may notify'
);

// In-app only: utility-comms must not send Gmail/email for tenant/staff utility alerts
{
  const src = fs.readFileSync(
    path.join(__dirname, '../src/services/utility-comms.service.js'),
    'utf8'
  );
  for (const banned of ['sendMail', 'sendEmail(', 'googleapis', 'gmail.users.messages.send']) {
    assert.ok(!src.includes(banned), `utility-comms must not use ${banned}`);
  }
  assert.ok(src.includes("channel: 'in_app'"), 'utility-comms must record in_app notifications');
}

console.log('test-utility-auto-notify: OK');
