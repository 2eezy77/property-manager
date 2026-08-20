#!/usr/bin/env node
/**
 * Utility use-case HTTP status mapping.
 * Run: node scripts/test-utility-http-status.js
 */
const { httpStatusForCode, useCaseError } = require('../src/use-cases/utilities/errors');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

assert(httpStatusForCode('MISSING_PARAMS') === 400, 'MISSING_PARAMS → 400');
assert(httpStatusForCode('MISSING_REASON') === 400, 'MISSING_REASON → 400');
assert(httpStatusForCode('INVALID_AMOUNT') === 400, 'INVALID_AMOUNT → 400');
assert(httpStatusForCode('NO_ACTIVE_LEASES') === 400, 'NO_ACTIVE_LEASES → 400');
assert(httpStatusForCode('NO_ORG') === 400, 'NO_ORG → 400');
assert(httpStatusForCode('NO_PROPERTIES') === 400, 'NO_PROPERTIES → 400');
assert(httpStatusForCode('NOT_CONNECTED') === 401, 'NOT_CONNECTED → 401');
assert(httpStatusForCode('FORBIDDEN') === 403, 'FORBIDDEN → 403');
assert(httpStatusForCode('NOT_FOUND') === 404, 'NOT_FOUND → 404');
assert(httpStatusForCode('INVALID_STATE') === 409, 'INVALID_STATE → 409');
assert(httpStatusForCode('DEADLINE_NOT_REACHED') === 409, 'DEADLINE_NOT_REACHED → 409');
assert(httpStatusForCode('DEADLINE_PASSED') === 409, 'DEADLINE_PASSED → 409');
assert(
  httpStatusForCode('BILLING_PERIOD_OPEN') === 409,
  'BILLING_PERIOD_OPEN → 409 (electric period / notify gate, not 500)'
);
assert(httpStatusForCode('NOT_CONFIGURED') === 503, 'NOT_CONFIGURED → 503');
assert(httpStatusForCode('IMPORT_FAILED') === 500, 'IMPORT_FAILED → 500');
assert(httpStatusForCode('SERVER_ERROR') === 500, 'SERVER_ERROR → 500');
assert(httpStatusForCode('TOTALLY_UNKNOWN') === 500, 'unknown codes fail closed to 500');
assert(httpStatusForCode(undefined) === 500, 'undefined code → 500');

const err = useCaseError('BILLING_PERIOD_OPEN', 'Electric period still open.');
assert(err.code === 'BILLING_PERIOD_OPEN', 'useCaseError sets code');
assert(err.message === 'Electric period still open.', 'useCaseError sets message');
assert(httpStatusForCode(err.code) === 409, 'UC06 billing-period errors map to conflict');

if (failed) {
  console.error(`\ntest-utility-http-status: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\ntest-utility-http-status: OK');
