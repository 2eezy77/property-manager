#!/usr/bin/env node
/**
 * Site-archive visibility helpers (former tenants hidden from live lists).
 * Run: npm run test:site-visibility
 */
const {
  notSiteArchivedWhere,
  isSiteArchivedUser,
} = require('../src/utils/site-visibility');

let failed = 0;
function assert(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name}`, detail ?? '');
  }
}

assert('default alias', notSiteArchivedWhere() === 'u.site_archived_at IS NULL');
assert('custom alias', notSiteArchivedWhere('t') === 't.site_archived_at IS NULL');
assert('active user not archived', isSiteArchivedUser({ site_archived_at: null }) === false);
assert('archived user detected', isSiteArchivedUser({ site_archived_at: '2026-06-01T00:00:00Z' }) === true);
assert('missing user safe', isSiteArchivedUser(null) === false);

process.exit(failed ? 1 : 0);
