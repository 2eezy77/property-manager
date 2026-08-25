#!/usr/bin/env node
/**
 * Unit checks for shared email template helpers (escape / money / dates).
 * Run: node scripts/test-email-template-utils.js
 */
'use strict';

const {
  escapeHtml,
  formatMoney,
  formatDate,
  detailRow,
} = require('../src/services/email-templates/utils');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

check(escapeHtml('<b>x</b>') === '&lt;b&gt;x&lt;/b&gt;', 'escapeHtml escapes tags');
check(escapeHtml('A & "B"') === 'A &amp; &quot;B&quot;', 'escapeHtml escapes & and quotes');
check(escapeHtml(null) === '', 'escapeHtml null → empty');
check(escapeHtml(undefined) === '', 'escapeHtml undefined → empty');

check(formatMoney(900) === '$900.00', 'formatMoney whole dollars');
check(formatMoney('26.4') === '$26.40', 'formatMoney string cents');
check(formatMoney(0) === '$0.00', 'formatMoney zero');

check(formatDate(null) === 'this month', 'formatDate null → this month');
check(formatDate('') === 'this month', 'formatDate empty → this month');
check(formatDate('2026-08-15') === 'August 15, 2026', 'formatDate ISO date');
check(formatDate('not-a-date') === 'not-a-date', 'formatDate invalid keeps raw slice');

const row = detailRow('Note', '<script>x</script>');
check(row.includes('&lt;script&gt;x&lt;/script&gt;'), 'detailRow escapes value HTML');
check(!row.includes('<script>'), 'detailRow does not emit raw script tags');
check(row.includes('Note'), 'detailRow keeps label text');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll email-template-utils checks passed.');
