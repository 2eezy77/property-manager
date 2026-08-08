#!/usr/bin/env node
/**
 * Site-archived users must be excluded from live list SQL and UI helpers.
 */
const assert = require('assert');
const {
  notSiteArchivedWhere,
  isSiteArchivedUser,
} = require('../src/utils/site-visibility');

assert.strictEqual(notSiteArchivedWhere(), 'u.site_archived_at IS NULL');
assert.strictEqual(notSiteArchivedWhere('ten'), 'ten.site_archived_at IS NULL');

assert.strictEqual(isSiteArchivedUser(null), false);
assert.strictEqual(isSiteArchivedUser({}), false);
assert.strictEqual(isSiteArchivedUser({ site_archived_at: null }), false);
assert.strictEqual(isSiteArchivedUser({ site_archived_at: '2026-08-07T00:00:00Z' }), true);

console.log('test-site-visibility: ok');
