#!/usr/bin/env node
/**
 * Shared portal sign-in block used by launch / credential / reset emails.
 * Run: node scripts/test-login-credentials-block.js
 */
'use strict';

const {
  loginUrl,
  renderLoginCredentialsBlock,
} = require('../src/services/email-templates/loginCredentials');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const bare = loginUrl();
check(/\/login$/.test(bare), `bare loginUrl ends with /login, got ${bare}`);
check(!/\?/.test(bare), 'bare loginUrl has no query');

const plus = loginUrl('x+y@example.com');
check(
  plus.includes('email=x%2By%40example.com'),
  `plus-address email is URI-encoded, got ${plus}`
);

const empty = renderLoginCredentialsBlock({});
check(empty.html === '', 'missing password+email yields empty html');
check(empty.text === '', 'missing password+email yields empty text');
check(/\/login/.test(empty.signInUrl), 'empty block still exposes sign-in URL');
check(empty.ctaLabel === 'Sign in to portal', 'empty block keeps CTA label');

const noPw = renderLoginCredentialsBlock({ loginEmail: 'a@b.com' });
check(noPw.html === '' && noPw.text === '', 'email without password stays empty');

const full = renderLoginCredentialsBlock({
  loginEmail: 'tenant@example.com',
  temporaryPassword: 'TempPass!23',
});
check(/tenant@example\.com/.test(full.text), 'full block includes email in text');
check(/TempPass!23/.test(full.text), 'full block includes temporary password in text');
check(/tenant@example\.com/.test(full.html), 'full block includes email in html');
check(/TempPass!23/.test(full.html), 'full block includes temporary password in html');
check(
  full.signInUrl.includes('email=tenant%40example.com'),
  `full signInUrl pre-fills email, got ${full.signInUrl}`
);
check(/Account settings/.test(full.text), 'full text mentions Account settings');

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll login-credentials block checks passed.');
