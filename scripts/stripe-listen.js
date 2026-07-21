#!/usr/bin/env node
/**
 * Forward Stripe webhooks to the local Express server.
 *
 * IMPORTANT: uses STRIPE_SECRET_KEY from .env.local so events match the same
 * Stripe account as the app (not necessarily the Stripe CLI default login).
 *
 * Usage:
 *   npm run stripe:listen
 *
 * On startup the CLI prints a webhook signing secret (whsec_...).
 * Copy it into .env.local as STRIPE_WEBHOOK_SECRET, then restart the backend.
 */

require('../src/config/env');
const { spawn } = require('child_process');

const PORT   = process.env.PORT ?? 8080;
const apiKey = process.env.STRIPE_SECRET_KEY;

if (!apiKey) {
  console.error('Missing STRIPE_SECRET_KEY in .env.local');
  process.exit(1);
}

const events = [
  'payment_intent.processing',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.dispute.created',
].join(',');

console.log(`Forwarding Stripe webhooks → http://localhost:${PORT}/webhooks/stripe`);
console.log('When the CLI prints whsec_..., set STRIPE_WEBHOOK_SECRET in .env.local and restart the server.\n');

const child = spawn(
  'stripe',
  [
    'listen',
    '--api-key', apiKey,
    '--forward-to', `localhost:${PORT}/webhooks/stripe`,
    '--events', events,
  ],
  { stdio: 'inherit', shell: true }
);

child.on('exit', (code) => process.exit(code ?? 0));
