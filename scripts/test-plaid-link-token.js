#!/usr/bin/env node
/**
 * Unit checks for Plaid Link token request building + error copy.
 * Run: node scripts/test-plaid-link-token.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Products } = require('plaid');
const { buildLinkTokenRequest } = require('../src/services/plaid.service');
const { linkTokenCreateErrorMessage } = require('../src/utils/plaid-errors');

const prev = {
  PLAID_SIGNAL_ENABLED: process.env.PLAID_SIGNAL_ENABLED,
  PLAID_REDIRECT_URI: process.env.PLAID_REDIRECT_URI,
  PLAID_WEBHOOK_URL: process.env.PLAID_WEBHOOK_URL,
  PLAID_LINK_CUSTOMIZATION_NAME: process.env.PLAID_LINK_CUSTOMIZATION_NAME,
  PLAID_ENV: process.env.PLAID_ENV,
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function withEnv(overrides, fn) {
  const snapshot = {};
  for (const key of Object.keys(overrides)) snapshot[key] = process.env[key];
  Object.assign(process.env, overrides);
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

try {
  withEnv({
    PLAID_SIGNAL_ENABLED: 'true',
    PLAID_REDIRECT_URI: 'https://www.monterorentals.com/oauth-return',
    PLAID_WEBHOOK_URL: 'https://www.monterorentals.com/webhooks/plaid',
    PLAID_LINK_CUSTOMIZATION_NAME: '',
    PLAID_ENV: 'production',
    CLIENT_ORIGIN: 'https://www.monterorentals.com',
  }, () => {
    const req = buildLinkTokenRequest('user-1');
    check(req.user.client_user_id === 'user-1', 'client_user_id is the caller');
    check(Array.isArray(req.products) && req.products.includes(Products.Auth), 'Auth is always requested');
    check(req.products.includes(Products.Signal), 'Signal is requested when enabled');
    check(req.redirect_uri === 'https://www.monterorentals.com/oauth-return', 'redirect_uri from env');
    check(req.webhook === 'https://www.monterorentals.com/webhooks/plaid', 'webhook from env');
    check(!req.link_customization_name, 'no customization name when unset');
  });

  withEnv({
    PLAID_SIGNAL_ENABLED: 'false',
    PLAID_REDIRECT_URI: '',
    PLAID_WEBHOOK_URL: '',
    PLAID_LINK_CUSTOMIZATION_NAME: 'montero-rent',
    PLAID_ENV: 'sandbox',
    CLIENT_ORIGIN: 'http://localhost:5173',
  }, () => {
    const req = buildLinkTokenRequest('user-2');
    check(!req.products.includes(Products.Signal), 'Signal omitted when disabled');
    check(!req.redirect_uri, 'no redirect_uri in sandbox without PLAID_REDIRECT_URI');
    check(req.link_customization_name === 'montero-rent', 'named Link customization is passed through');
  });

  withEnv({
    PLAID_SIGNAL_ENABLED: 'true',
    PLAID_REDIRECT_URI: 'https://www.monterorentals.com/oauth-return',
    PLAID_WEBHOOK_URL: 'https://www.monterorentals.com/webhooks/plaid',
    PLAID_LINK_CUSTOMIZATION_NAME: '',
    PLAID_ENV: 'production',
    CLIENT_ORIGIN: 'https://www.monterorentals.com',
  }, () => {
    const updateReq = buildLinkTokenRequest('user-3', {
      updateMode: true,
      accessToken: 'access-sandbox-relink',
    });
    check(updateReq.access_token === 'access-sandbox-relink', 'update mode passes access_token');
    check(!updateReq.products, 'update mode omits products (re-auth existing Item)');
    check(!updateReq.account_filters, 'update mode omits account_filters');
    check(
      updateReq.redirect_uri === 'https://www.monterorentals.com/oauth-return',
      'update mode still sets redirect_uri'
    );

    const noToken = buildLinkTokenRequest('user-3', { updateMode: true });
    check(Array.isArray(noToken.products), 'updateMode without accessToken falls back to new-link products');
    check(!noToken.access_token, 'updateMode without accessToken does not set access_token');
  });

  const bankLinkSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/plaid-bank-link.service.js'),
    'utf8'
  );
  check(
    bankLinkSrc.includes("err.code = 'NOT_FOUND'")
      && bankLinkSrc.includes('createUpdateLinkTokenForAccount'),
    'bank-link update token throws NOT_FOUND when account missing'
  );
  check(
    /scope === 'owner_property'/.test(bankLinkSrc)
      && /scope === 'manager_payout'/.test(bankLinkSrc),
    'bank-link update scopes owner_property and manager_payout separately from tenant'
  );

  const dtmErr = {
    response: {
      data: {
        error_type: 'INVALID_INPUT',
        error_code: 'INVALID_LINK_CUSTOMIZATION',
        error_message: 'At least one Data Transparency Messaging use case is required to be configured.',
      },
    },
  };
  const dtmMsg = linkTokenCreateErrorMessage(dtmErr, 'Could not create Plaid Link token.');
  check(
    dtmMsg.includes('Data Transparency') && dtmMsg.includes('dashboard.plaid.com/link/data-transparency-v5'),
    'DTM customization error maps to a Dashboard use-case message'
  );
  check(!dtmMsg.includes('At least one Data Transparency Messaging use case is required'), 'raw Plaid DTM text is replaced');

  const generic = linkTokenCreateErrorMessage(
    { response: { data: { error_message: 'redirect_uri is not allowlisted' } } },
    'fallback'
  );
  check(generic === 'redirect_uri is not allowlisted', 'other Plaid errors keep partner text');

  const ownerSrc = fs.readFileSync(path.join(__dirname, '../src/routes/owner-finance.routes.js'), 'utf8');
  check(ownerSrc.includes('linkTokenCreateErrorMessage'), 'owner finance surfaces mapped Plaid errors');

  const siteSrc = fs.readFileSync(path.join(__dirname, '../src/routes/site-visits.routes.js'), 'utf8');
  check(siteSrc.includes('linkTokenCreateErrorMessage'), 'site-visits surfaces mapped Plaid errors');

  const paySrc = fs.readFileSync(path.join(__dirname, '../src/routes/payments.routes.js'), 'utf8');
  check(paySrc.includes('linkTokenCreateErrorMessage'), 'payments surfaces mapped Plaid errors');

  const hookSrc = fs.readFileSync(path.join(__dirname, '../client/src/hooks/usePlaidLink.js'), 'utf8');
  check(hookSrc.includes('skipGlobalError: true'), 'Link token fetch does not toast a global 500');

  const financeSrc = fs.readFileSync(path.join(__dirname, '../client/src/pages/admin/OwnerFinance.jsx'), 'utf8');
  check(
    /enabled:\s*!loading\s*&&\s*!account/.test(financeSrc),
    'Owner Finance waits until the property bank load finishes before requesting a token'
  );

  const visitsSrc = fs.readFileSync(path.join(__dirname, '../client/src/pages/SiteVisits.jsx'), 'utf8');
  check(
    visitsSrc.includes('enabled: !loading && accounts.length === 0 && !updateLinkToken'),
    'Site Visits does not fetch a new-link token when payout accounts already exist'
  );
} finally {
  restoreEnv();
}

if (failed) {
  console.error(`\ntest-plaid-link-token: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\ntest-plaid-link-token: OK');
