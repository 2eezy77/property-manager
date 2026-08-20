#!/usr/bin/env node
/**
 * Create-Lease unit picker: native rooms keep occupied; legacy hides them.
 * Run: node scripts/test-lease-unit-options.js
 */
async function main() {
  let failed = 0;
  function assert(cond, msg) {
    if (!cond) {
      console.error('FAIL:', msg);
      failed += 1;
    } else {
      console.log('ok:', msg);
    }
  }

  const { filterUnitsForLeasePath } = await import('../client/src/utils/leaseUnitOptions.js');

  const units = [
    { id: '1', unit_number: '1', is_occupied: true },
    { id: '2', unit_number: '2', is_occupied: false },
    { id: '3', unit_number: '3', is_occupied: true },
  ];

  const native = filterUnitsForLeasePath(units, 'native');
  assert(native.length === 3, 'native path lists occupied and vacant units');
  assert(native.some((u) => u.is_occupied), 'native path keeps occupied shared rooms');

  const legacy = filterUnitsForLeasePath(units, 'rocket_lawyer');
  assert(legacy.length === 1 && legacy[0].id === '2', 'legacy path hides occupied units');
  assert(legacy.every((u) => !u.is_occupied), 'legacy path only vacant');

  assert(filterUnitsForLeasePath(units, 'legacy').length === 1, 'any non-native path hides occupied');
  assert(filterUnitsForLeasePath(null, 'native').length === 0, 'null units → empty');
  assert(filterUnitsForLeasePath(undefined, 'native').length === 0, 'undefined units → empty');

  if (failed) {
    console.error(`\ntest-lease-unit-options: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log('\ntest-lease-unit-options: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
