#!/usr/bin/env node
/**
 * Unit checks for Cash App CSV line splitting and statement date parse.
 * Run: node scripts/test-cashapp-csv-parse.js
 */
const {
  parseCashAppDate,
  parseCsvLine,
} = require('../src/utils/cashapp-csv-parse');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

assert(
  JSON.stringify(parseCsvLine('a,b,c')) === JSON.stringify(['a', 'b', 'c']),
  'simple CSV splits on commas'
);
assert(
  JSON.stringify(parseCsvLine('"a,b",c')) === JSON.stringify(['a,b', 'c']),
  'quoted field keeps embedded comma'
);
assert(
  JSON.stringify(parseCsvLine('"$450.00","COMPLETE","Isaiah Reese"')) ===
    JSON.stringify(['$450.00', 'COMPLETE', 'Isaiah Reese']),
  'quoted money + status + name'
);
assert(
  JSON.stringify(parseCsvLine('alone')) === JSON.stringify(['alone']),
  'single column'
);
assert(
  JSON.stringify(parseCsvLine('a,,c')) === JSON.stringify(['a', '', 'c']),
  'empty middle field preserved'
);

const good = parseCashAppDate('2026-08-15 12:34:56 EDT');
assert(good.dateIso === '2026-08-15', 'ISO date from Cash App timestamp prefix');
assert(good.date instanceof Date && !Number.isNaN(good.date.getTime()), 'date object valid');
assert(good.date.getHours() === 12, 'noon local anchor avoids TZ day shift');

const bare = parseCashAppDate('2026-01-02');
assert(bare.dateIso === '2026-01-02', 'bare YYYY-MM-DD accepted');

assert(parseCashAppDate('08/15/2026').date === null, 'US slash date rejected');
assert(parseCashAppDate('').dateIso === null, 'empty date → null');
assert(parseCashAppDate(null).date === null, 'null date → null');
assert(parseCashAppDate('not-a-date').dateIso === null, 'garbage date → null');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll cashapp-csv-parse checks passed.');
