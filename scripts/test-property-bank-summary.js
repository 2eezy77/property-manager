#!/usr/bin/env node
/**
 * Unit checks for property operating bank JSON shaping (no Plaid/Stripe calls).
 * Run: node scripts/test-property-bank-summary.js
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://coverage:coverage@127.0.0.1:5432/coverage';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  || Buffer.alloc(32, 7).toString('base64');

const assert = require('assert');
const {
  bankAccountToJson,
  bankSummary,
} = require('../src/services/property-bank.service');

assert.strictEqual(bankAccountToJson(null), null);
assert.deepStrictEqual(bankSummary(null), { linked: false });

const row = {
  id: 'ba-1',
  institution_name: 'Navy Federal',
  account_name: 'Operating',
  account_mask: '4321',
  account_type: 'depository',
  status: 'verified',
  link_status: 'linked',
  is_default: true,
  verified_at: '2026-08-01T12:00:00.000Z',
  created_at: '2026-07-01T12:00:00.000Z',
  linked_by_name: '  Jose Montero  ',
  linked_by_email: 'jose@example.com',
};

const json = bankAccountToJson(row);
assert.strictEqual(json.id, 'ba-1');
assert.strictEqual(json.institutionName, 'Navy Federal');
assert.strictEqual(json.accountMask, '4321');
assert.strictEqual(json.linkedByName, 'Jose Montero', 'trims linked-by display name');
assert.strictEqual(json.linkedByEmail, 'jose@example.com');
assert.strictEqual(json.isDefault, true);

const summary = bankSummary(row);
assert.strictEqual(summary.linked, true);
assert.strictEqual(summary.institutionName, 'Navy Federal');
assert.strictEqual(summary.accountMask, '4321');
assert.strictEqual(summary.linkedByName, 'Jose Montero');
assert.strictEqual(summary.status, 'verified');
assert.strictEqual(summary.linkStatus, 'linked');
assert.strictEqual(summary.id, undefined, 'summary omits internal bank account id');

console.log('test-property-bank-summary: ok');
