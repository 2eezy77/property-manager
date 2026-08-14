#!/usr/bin/env node
/**
 * Site-archived users must be excluded from live list SQL filters.
 * Run: npm run test:site-visibility
 */
const assert = require('assert');
const {
  notSiteArchivedWhere,
  isSiteArchivedUser,
} = require('../src/utils/site-visibility');

assert.strictEqual(notSiteArchivedWhere(), 'u.site_archived_at IS NULL');
assert.strictEqual(notSiteArchivedWhere('usr'), 'usr.site_archived_at IS NULL');
assert.strictEqual(isSiteArchivedUser({ site_archived_at: '2026-06-01' }), true);
assert.strictEqual(isSiteArchivedUser({ site_archived_at: null }), false);
assert.strictEqual(isSiteArchivedUser(null), false);

console.log('test-site-visibility: OK');
