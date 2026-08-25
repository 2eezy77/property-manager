#!/usr/bin/env node
/**
 * Unit checks for owner-oversight manager display name helper.
 * Run: node scripts/test-owner-oversight-display.js
 */
'use strict';

const { managerDisplayName, MANAGER_EMAIL } = require('../src/services/owner-oversight.service');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

check(managerDisplayName(null) === 'Property manager', 'null row → fallback label');
check(managerDisplayName(undefined) === 'Property manager', 'undefined row → fallback label');
check(
  managerDisplayName({ first_name: 'Konstantin', last_name: 'Hazlett', email: MANAGER_EMAIL }) ===
    'Konstantin Hazlett',
  'joins first + last name'
);
check(
  managerDisplayName({ first_name: 'Konstantin', last_name: null, email: 'k@example.com' }) ===
    'Konstantin',
  'uses first name alone when last is missing'
);
check(
  managerDisplayName({ first_name: '', last_name: '', email: 'manager@example.com' }) ===
    'manager@example.com',
  'falls back to email when names are empty'
);
check(
  managerDisplayName({ first_name: null, last_name: null }) === undefined,
  'empty names without email returns undefined (caller can substitute)'
);
check(typeof MANAGER_EMAIL === 'string' && MANAGER_EMAIL.includes('@'), 'MANAGER_EMAIL is configured');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll owner-oversight-display checks passed.');
