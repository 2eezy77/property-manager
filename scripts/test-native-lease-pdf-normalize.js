#!/usr/bin/env node
/**
 * Unit checks for native lease PDF normalize + filename sanitization.
 * Run: npm run test:native-lease-pdf-normalize
 */
'use strict';

const assert = require('assert');
const {
  normalizeLeaseData,
  safeFilePart,
  formatDate,
} = require('../src/services/lease-pdf.service');

const regular = normalizeLeaseData({
  leaseId: 'lease-abc',
  roomType: 'regular',
  tenantName: 'Test Tenant',
});
assert.strictEqual(regular.leaseId, 'lease-abc');
assert.strictEqual(regular.roomType, 'regular');
assert.strictEqual(regular.monthlyRent, 900);
assert.strictEqual(regular.securityDeposit, 900);
assert.strictEqual(regular.gracePeriodDays, 0);
assert.strictEqual(regular.lateFeeAmount, 150);
assert.strictEqual(regular.nsfFee, 50);
assert.strictEqual(regular.houseRules.smoking, false);
assert.strictEqual(regular.houseRules.guestNights, 7);
assert.ok(Array.isArray(regular.furnishings) && regular.furnishings.length > 0);
assert.ok(Array.isArray(regular.damageCharges) && regular.damageCharges.length > 0);

const master = normalizeLeaseData({
  leaseId: 'lease-master',
  roomType: 'MASTER',
  monthlyRent: 1250,
  houseRules: { pets: true, guestNights: 3 },
});
assert.strictEqual(master.roomType, 'master');
assert.strictEqual(master.monthlyRent, 1250, 'explicit rent must win over room defaults');
assert.strictEqual(master.securityDeposit, 1200, 'deposit falls back to master default');
assert.strictEqual(master.houseRules.pets, true);
assert.strictEqual(master.houseRules.guestNights, 3);
assert.strictEqual(master.houseRules.smoking, false, 'unset house rules keep defaults');

const zeroRent = normalizeLeaseData({
  leaseId: 'lease-zero',
  roomType: 'regular',
  monthlyRent: 0,
  securityDeposit: 0,
});
assert.strictEqual(zeroRent.monthlyRent, 0, '0 rent must not coalesce to room default');
assert.strictEqual(zeroRent.securityDeposit, 0, '0 deposit must not coalesce to room default');

assert.strictEqual(safeFilePart('lease_abc-123.pdf'), 'lease_abc-123.pdf');
assert.strictEqual(safeFilePart('../etc/passwd'), '..-etc-passwd');
assert.strictEqual(safeFilePart('a/b\\c:d*e?f'), 'a-b-c-d-e-f');
assert.match(safeFilePart(''), /^\d+$/, 'empty input falls back to numeric timestamp');
assert.match(safeFilePart(null), /^\d+$/, 'null input falls back to numeric timestamp');

assert.strictEqual(formatDate('2026-08-15'), 'August 15, 2026');
assert.strictEqual(formatDate(new Date(Date.UTC(2026, 0, 5))), 'January 5, 2026');
assert.strictEqual(formatDate(null), '_______________');
assert.strictEqual(formatDate('not-a-date'), 'not-a-date');

console.log('OK native lease PDF normalize + safeFilePart');
