#!/usr/bin/env node
require('../src/config/env');
const assert = require('assert');
const { defaultTermsForRoomType, ROOM_DEFAULTS } = require('../src/services/native-lease.constants');

const regular = defaultTermsForRoomType('regular');
assert.strictEqual(regular.monthlyRent, 900);
assert.strictEqual(regular.securityDeposit, 900);
assert.strictEqual(regular.gracePeriodDays, 0);
assert.strictEqual(regular.lateFeeAmount, 150);
assert.strictEqual(regular.nsfFee, 50);

const master = defaultTermsForRoomType('master');
assert.strictEqual(master.monthlyRent, 1200);
assert.strictEqual(master.securityDeposit, 1200);

assert.throws(() => defaultTermsForRoomType('suite'), /room type/i);
console.log('OK native lease defaults');
