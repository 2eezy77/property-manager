#!/usr/bin/env node
/**
 * Unit checks for boots-on-site inspection common-area catalog rules.
 * Run: node scripts/test-site-visits-catalog.js
 */
'use strict';

const assert = require('assert');
const {
  COMMON_AREAS,
  VALID_COMMON_KEYS,
  mandatoryCommonAreas,
  normalizeCommonAreas,
} = require('../src/services/site-visits-catalog');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const expected = ['kitchen_living', 'parking', 'lawn_porch'];

check(COMMON_AREAS.length === 3, 'catalog has three common areas');
check(
  COMMON_AREAS.every((a) => a.key && a.label),
  'each common area has key + label'
);
check(
  expected.every((k) => VALID_COMMON_KEYS.has(k)),
  'VALID_COMMON_KEYS includes all mandatory keys'
);
check(!VALID_COMMON_KEYS.has('bedroom'), 'bedroom is not a common-area key');

assert.deepStrictEqual(mandatoryCommonAreas(), expected);
check(true, 'mandatoryCommonAreas returns all three keys in order');

assert.deepStrictEqual(normalizeCommonAreas([]), expected);
check(true, 'normalize ignores empty input and returns mandatory set');

assert.deepStrictEqual(normalizeCommonAreas(['parking']), expected);
check(true, 'normalize ignores partial picks — all commons stay required');

assert.deepStrictEqual(normalizeCommonAreas(['bedroom', 'extra']), expected);
check(true, 'normalize ignores invalid keys — cannot drop commons');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll site-visits-catalog checks passed.');
