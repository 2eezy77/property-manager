#!/usr/bin/env node
/**
 * Add required payment_intent.* events to the live Montero Rentals webhook.
 *
 *   node scripts/update-stripe-webhook-events.js --dry-run
 *   node scripts/update-stripe-webhook-events.js --apply
 *
 * Requires STRIPE_SECRET_KEY (live secret with webhook write access).
 */
require('../src/config/env');
const Stripe = require('stripe');
const { ALL_WEBHOOK_EVENTS, PRODUCTION_WEBHOOK_URLS } = require('../src/services/stripe.service');

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;

const TARGET_URLS = PRODUCTION_WEBHOOK_URLS;

function mergeEvents(existing = []) {
  if (existing.includes('*')) return ['*'];
  const set = new Set([...existing, ...ALL_WEBHOOK_EVENTS]);
  return [...set].sort();
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('STRIPE_SECRET_KEY is not set.');
    process.exit(1);
  }
  if (!key.startsWith('sk_live_') && !key.startsWith('sk_test_')) {
    console.error('Use a standard secret key (sk_live_... or sk_test_...), not a restricted key.');
    process.exit(1);
  }

  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });

  let account;
  try {
    account = await stripe.accounts.retrieve();
  } catch (err) {
    console.error('Stripe auth failed:', err.message);
    console.error('Reveal a fresh live secret at https://dashboard.stripe.com/apikeys');
    process.exit(1);
  }
  console.log(`Account: ${account.id} (${account.settings?.dashboard?.display_name || 'Stripe'})`);

  const { data: endpoints } = await stripe.webhookEndpoints.list({ limit: 20 });
  const match = endpoints.find((w) => TARGET_URLS.some((u) => w.url.replace(/\/$/, '') === u.replace(/\/$/, '')));

  if (!match) {
    console.error('No webhook endpoint found for:');
    TARGET_URLS.forEach((u) => console.error(' ', u));
    console.error('\nRegistered endpoints:');
    endpoints.forEach((w) => console.error(' ', w.id, w.url, w.enabled_events.join(', ')));
    process.exit(1);
  }

  const nextEvents = mergeEvents(match.enabled_events);
  const added = nextEvents.filter((e) => !match.enabled_events.includes(e));

  console.log('\nEndpoint:', match.id);
  console.log('URL:', match.url);
  console.log('Current events:', match.enabled_events.join(', '));
  console.log('Next events:   ', nextEvents.join(', '));
  if (added.length) console.log('Adding:        ', added.join(', '));
  else console.log('No changes needed.');

  if (DRY) {
    console.log('\nDry run only. Re-run with --apply to update.');
    process.exit(0);
  }

  const updated = await stripe.webhookEndpoints.update(match.id, {
    enabled_events: nextEvents,
  });

  console.log('\nUpdated:', updated.id);
  console.log('Events:', updated.enabled_events.join(', '));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
