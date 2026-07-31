#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { generateRoomLeasePdf } = require('../src/services/lease-pdf.service');

(async () => {
  const result = await generateRoomLeasePdf({
    leaseId: '00000000-0000-4000-8000-000000000099',
    tenantName: 'Test Tenant',
    roomType: 'regular',
    unitNumber: 'A',
    startDate: '2026-08-01',
    endDate: '2027-07-31',
    monthlyRent: 900,
    securityDeposit: 900,
    gracePeriodDays: 0,
    lateFeeAmount: 150,
    nsfFee: 50,
    houseRules: { smoking: false, pets: false, quietHours: '10pm-8am', guestNights: 7 },
  });
  assert.ok(result.filepath);
  assert.ok(fs.existsSync(result.filepath));
  const buf = fs.readFileSync(result.filepath);
  assert.ok(buf.slice(0, 4).toString() === '%PDF');
  assert.ok(buf.length > 2000);
  // cleanup test artifact
  fs.unlinkSync(result.filepath);
  console.log('OK room lease PDF');
})().catch((e) => { console.error(e); process.exit(1); });
