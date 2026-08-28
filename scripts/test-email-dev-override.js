#!/usr/bin/env node
/**
 * EMAIL_DEV_OVERRIDE must redirect To/Cc in dev but never rewrite BCC.
 * Run: node scripts/test-email-dev-override.js
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgres://test:test@127.0.0.1:5432/property_manager_test';
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
}

const { resolveRecipients } = require('../src/services/email.service');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const prevOverride = process.env.EMAIL_DEV_OVERRIDE;
delete process.env.EMAIL_DEV_OVERRIDE;

try {
  check(
    JSON.stringify(resolveRecipients(['a@b.com', 'a@b.com', 'c@d.com']))
      === JSON.stringify(['a@b.com', 'c@d.com']),
    'dedupes string recipients without override'
  );
  check(
    JSON.stringify(resolveRecipients([{ email: 'one@x.com' }, { email: 'two@x.com' }, null]))
      === JSON.stringify(['one@x.com', 'two@x.com']),
    'accepts {email} objects and drops empties'
  );
  check(
    JSON.stringify(resolveRecipients('solo@x.com')) === JSON.stringify(['solo@x.com']),
    'single string becomes a one-element list'
  );

  process.env.EMAIL_DEV_OVERRIDE = '  dev@montero.test  ';
  check(
    JSON.stringify(resolveRecipients(['tenant@example.com', 'other@example.com']))
      === JSON.stringify(['dev@montero.test']),
    'override replaces To recipients (trimmed)'
  );
  check(
    JSON.stringify(resolveRecipients(['tenant@example.com'], { allowOverride: true }))
      === JSON.stringify(['dev@montero.test']),
    'allowOverride true still applies override'
  );
  check(
    JSON.stringify(resolveRecipients(['bcc@example.com', 'bcc@example.com'], { allowOverride: false }))
      === JSON.stringify(['bcc@example.com']),
    'BCC path (allowOverride false) keeps real addresses and dedupes'
  );
  check(
    JSON.stringify(resolveRecipients([{ email: 'staff@example.com' }], { allowOverride: false }))
      === JSON.stringify(['staff@example.com']),
    'BCC object recipients are not redirected to the override'
  );
} finally {
  if (prevOverride === undefined) delete process.env.EMAIL_DEV_OVERRIDE;
  else process.env.EMAIL_DEV_OVERRIDE = prevOverride;
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll email-dev-override checks passed.');
