#!/usr/bin/env node
/**
 * Plaid link-token health failure fix copy (DTM use-case gate).
 * Run: node scripts/test-plaid-link-health.js
 */
const { plaidLinkTokenFailureFix } = require('../src/services/payments-health.service');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const dtm = plaidLinkTokenFailureFix('INVALID_LINK_CUSTOMIZATION');
assert(
  dtm.includes('dashboard.plaid.com/link/data-transparency-v5'),
  'DTM failure points at Data Transparency Dashboard'
);
assert(
  dtm.includes('publish at least one Data Transparency use case'),
  'DTM failure tells operator to publish a use case'
);

const other = plaidLinkTokenFailureFix('INVALID_API_KEYS');
assert(
  other.includes('PLAID_CLIENT_ID') && other.includes('PLAID_REDIRECT_URI'),
  'non-DTM failures point at credentials / redirect URI'
);
assert(
  !other.includes('data-transparency-v5'),
  'non-DTM failures do not send operators to DTM'
);

assert(
  plaidLinkTokenFailureFix(undefined).includes('PLAID_CLIENT_ID'),
  'missing error_code uses credential fix'
);

if (failed) {
  console.error(`\ntest-plaid-link-health: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\ntest-plaid-link-health: OK');
