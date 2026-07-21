#!/usr/bin/env node
/**
 * Print Stripe Connect status for manager payroll (site visits + lease signing fees).
 *
 *   npm run stripe:connect:status
 *   node scripts/stripe-connect-status.js --json
 *
 * Uses manager_payout bank row from DB, or --account acct_xxx to inspect directly.
 */
require('../src/config/env');
const pool = require('../src/db/client');
const stripe = require('../src/services/stripe.service');

const JSON_OUT = process.argv.includes('--json');
const accountArgIdx = process.argv.indexOf('--account');
const ACCOUNT_OVERRIDE = accountArgIdx >= 0 ? process.argv[accountArgIdx + 1] : null;

async function loadManagerPayoutBank() {
  const { rows } = await pool.query(
    `SELECT ba.id, ba.stripe_connect_account_id, ba.institution_name, ba.account_mask,
            ba.status, ba.is_default, ba.updated_at,
            u.id AS user_id, u.email, u.first_name, u.last_name
       FROM bank_accounts ba
       JOIN users u ON u.id = ba.user_id
      WHERE ba.purpose = 'manager_payout'
        AND ba.status <> 'revoked'
      ORDER BY ba.is_default DESC, ba.updated_at DESC`
  );
  return rows;
}

function printAccount(label, summary, bank = null) {
  console.log(`\n${label}`);
  if (bank) {
    console.log(`  Manager: ${[bank.first_name, bank.last_name].filter(Boolean).join(' ') || bank.email}`);
    console.log(`  Bank:    ${bank.institution_name || '—'} ····${bank.account_mask || '????'}`);
  }
  console.log(`  Account: ${summary.id}`);
  console.log(`  Email:   ${summary.email || '—'}`);
  console.log(`  transfers:      ${summary.transfers}${summary.transfersActive ? ' ✓' : ''}`);
  console.log(`  card_payments:  ${summary.cardPayments}`);
  console.log(`  details_submitted: ${summary.detailsSubmitted}`);
  console.log(`  payouts_enabled:   ${summary.payoutsEnabled}`);
  if (summary.disabledReason) console.log(`  disabled_reason:   ${summary.disabledReason}`);
  if (summary.requirementsDue.length) {
    console.log(`  currently_due:     ${summary.requirementsDue.join(', ')}`);
  }
  if (!summary.transfersActive) {
    console.log('\n  → Manager must finish Stripe onboarding: Site Visits → payout setup');
    console.log('  → Dashboard: https://dashboard.stripe.com/connect/accounts/' + summary.id);
  }
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set.');
    process.exit(1);
  }

  const banks = await loadManagerPayoutBank();
  const defaultBank = banks.find((b) => b.is_default) || banks[0];

  if (ACCOUNT_OVERRIDE) {
    const account = await stripe.retrieveConnectAccount(ACCOUNT_OVERRIDE);
    const summary = stripe.summarizeConnectAccount(account);
    if (JSON_OUT) {
      console.log(JSON.stringify({ account: summary }, null, 2));
    } else {
      printAccount('Connect account (override)', summary);
    }
    await pool.end();
    process.exit(summary.transfersActive ? 0 : 1);
  }

  if (!defaultBank) {
    console.error('No manager_payout bank account in DB.');
    console.error('Manager → Site Visits → link payout bank first.');
    await pool.end();
    process.exit(1);
  }

  if (!defaultBank.stripe_connect_account_id) {
    console.error('Payout bank linked but stripe_connect_account_id is missing.');
    console.error(`Bank id: ${defaultBank.id} (${defaultBank.email})`);
    console.error('Re-link payout bank or create Connect account via Site Visits onboarding.');
    await pool.end();
    process.exit(1);
  }

  const account = await stripe.retrieveConnectAccount(defaultBank.stripe_connect_account_id);
  const summary = stripe.summarizeConnectAccount(account);

  const payload = {
    manager: {
      email: defaultBank.email,
      name: [defaultBank.first_name, defaultBank.last_name].filter(Boolean).join(' '),
    },
    bank: {
      id: defaultBank.id,
      institution: defaultBank.institution_name,
      mask: defaultBank.account_mask,
      isDefault: defaultBank.is_default,
    },
    account: summary,
    payrollReady: summary.transfersActive,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printAccount('Manager payroll Connect', summary, defaultBank);
    if (banks.length > 1) {
      console.log(`\n(${banks.length - 1} other manager_payout bank row(s) — use --account to inspect)`);
    }
  }

  await pool.end();
  process.exit(summary.transfersActive ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
