#!/usr/bin/env node
/**
 * Regression: no-gmail sync path must gate reminders on auto-notify flag.
 * Run: npm run test:utilities-scheduler-reminders
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  autoNotifyEnabled,
  remindersWhenNotifyDisabled,
} = require('../src/services/utility-comms.service');

assert.deepStrictEqual(remindersWhenNotifyDisabled(), {
  reminded3: 0,
  reminded7: 0,
  overdueStaff: 0,
  disabled: true,
});

const prev = process.env.UTILITIES_AUTO_NOTIFY_ENABLED;
try {
  process.env.UTILITIES_AUTO_NOTIFY_ENABLED = 'false';
  assert.strictEqual(autoNotifyEnabled(), false);
  process.env.UTILITIES_AUTO_NOTIFY_ENABLED = 'true';
  assert.strictEqual(autoNotifyEnabled(), true);
} finally {
  if (prev === undefined) delete process.env.UTILITIES_AUTO_NOTIFY_ENABLED;
  else process.env.UTILITIES_AUTO_NOTIFY_ENABLED = prev;
}

const src = fs.readFileSync(
  path.join(__dirname, '../src/services/utilities-scheduler.service.js'),
  'utf8'
);

// no_gmail branch must consult the flag before sending reminders
assert.ok(src.includes("reason: 'no_gmail'"), 'scheduler has no_gmail path');
assert.ok(src.includes('!autoNotifyEnabled()'), 'no_gmail path gates on autoNotifyEnabled()');
assert.ok(
  src.includes('remindersWhenNotifyDisabled()'),
  'scheduler must use shared disabled-reminders summary'
);
assert.ok(
  src.includes('notify.disabled'),
  'gmail path must skip reminders when notify is disabled'
);

console.log('test-utilities-scheduler-reminders: OK');
