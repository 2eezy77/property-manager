#!/usr/bin/env node
/**
 * Unit checks for client staff-impersonation role gates (history-only vs full).
 * Run: node scripts/test-client-impersonation-gates.js
 */
'use strict';

function mockSessionStorage() {
  const map = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
  return map;
}

async function main() {
  mockSessionStorage();
  const {
    readImpersonation,
    writeImpersonation,
    clearImpersonation,
    isImpersonating,
    isManagerImpersonation,
    isStaffImpersonation,
  } = await import('../client/src/utils/impersonation.js');

  let failed = 0;
  function check(cond, msg) {
    if (!cond) {
      console.error('FAIL:', msg);
      failed += 1;
    } else {
      console.log('ok:', msg);
    }
  }

  check(readImpersonation() === null, 'empty session → null');
  check(isImpersonating() === false, 'empty session → not impersonating');
  check(isManagerImpersonation() === false, 'empty session → not manager impersonation');
  check(isStaffImpersonation() === false, 'empty session → not staff impersonation');

  writeImpersonation({
    ownerUser: { id: 'm1', role: 'property_manager', email: 'mgr@x.com' },
    tenantUser: { id: 't1', role: 'tenant' },
  });
  check(isImpersonating() === true, 'written session → impersonating');
  check(isStaffImpersonation() === true, 'written session → staff impersonation');
  check(isManagerImpersonation() === true, 'property_manager ownerUser → manager gate');

  writeImpersonation({
    ownerUser: { id: 'o1', role: 'owner', email: 'owner@x.com' },
    tenantUser: { id: 't1', role: 'tenant' },
  });
  check(isManagerImpersonation() === false, 'owner preview is not manager gate');
  check(isStaffImpersonation() === true, 'owner preview still staff impersonation');

  writeImpersonation({
    ownerUser: { id: 's1', role: 'super_admin' },
    tenantUser: { id: 't1', role: 'tenant' },
  });
  check(isManagerImpersonation() === false, 'super_admin is not manager gate');

  clearImpersonation();
  check(readImpersonation() === null, 'clear removes session');
  check(isManagerImpersonation() === false, 'cleared → not manager impersonation');

  sessionStorage.setItem('pm_impersonation', '{not-json');
  check(readImpersonation() === null, 'corrupt JSON → null');
  check(isManagerImpersonation() === false, 'corrupt JSON → not manager impersonation');

  sessionStorage.setItem('pm_impersonation', JSON.stringify({ tenantUser: { id: 't1' } }));
  check(isManagerImpersonation() === false, 'missing ownerUser.role → not manager');

  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll client-impersonation-gates checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
