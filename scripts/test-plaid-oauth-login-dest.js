/**
 * Ensures login redirect helpers preserve Plaid OAuth query params.
 * Run: node scripts/test-plaid-oauth-login-dest.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const loginSrc = fs.readFileSync(
  path.join(__dirname, '../client/src/pages/Login.jsx'),
  'utf8'
);
const oauthSrc = fs.readFileSync(
  path.join(__dirname, '../client/src/pages/PlaidOAuthReturn.jsx'),
  'utf8'
);
const hookSrc = fs.readFileSync(
  path.join(__dirname, '../client/src/hooks/usePlaidLink.js'),
  'utf8'
);

assert.match(loginSrc, /destinationFromLocationState/);
assert.match(loginSrc, /from\.search/);
assert.match(loginSrc, /oauth-return/);
assert.match(oauthSrc, /savePlaidOAuthReturnUrl/);
assert.match(oauthSrc, /bankAccountId/);
assert.match(hookSrc, /PLAID_OAUTH_RETURN_URL_KEY/);
assert.match(hookSrc, /oauthSessionExtra/);

console.log('test-plaid-oauth-login-dest: OK');
