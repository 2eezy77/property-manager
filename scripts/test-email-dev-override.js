#!/usr/bin/env node
/**
 * EMAIL_DEV_OVERRIDE recipient routing (To/Cc override; BCC keep real).
 * Run: node scripts/test-email-dev-override.js
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/pm_test_stub';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  || Buffer.alloc(32, 7).toString('base64');

const assert = require('assert');
const { resolveRecipients } = require('../src/services/email.service');

const prev = process.env.EMAIL_DEV_OVERRIDE;

try {
  delete process.env.EMAIL_DEV_OVERRIDE;
  assert.deepStrictEqual(
    resolveRecipients(['a@example.com', 'b@example.com', 'a@example.com']),
    ['a@example.com', 'b@example.com'],
    'dedupe without override'
  );
  assert.deepStrictEqual(
    resolveRecipients([{ email: 'c@example.com' }, null, '']),
    ['c@example.com']
  );

  process.env.EMAIL_DEV_OVERRIDE = '  override@example.com  ';
  assert.deepStrictEqual(
    resolveRecipients(['a@example.com', 'b@example.com']),
    ['override@example.com'],
    'To/Cc redirect to override'
  );
  assert.deepStrictEqual(
    resolveRecipients(['staff@example.com', 'owner@example.com'], { allowOverride: false }),
    ['staff@example.com', 'owner@example.com'],
    'BCC keeps real recipients when allowOverride is false'
  );
  assert.deepStrictEqual(
    resolveRecipients(['x@example.com', 'x@example.com'], { allowOverride: false }),
    ['x@example.com'],
    'BCC still dedupes'
  );
} finally {
  if (prev == null) delete process.env.EMAIL_DEV_OVERRIDE;
  else process.env.EMAIL_DEV_OVERRIDE = prev;
}

console.log('ok: email-dev-override');
