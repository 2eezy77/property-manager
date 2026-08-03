#!/usr/bin/env node
/**
 * Backfill Stripe Customer.name / description from our users table so the
 * Dashboard no longer shows blank/"unknown" customers for past payments.
 *
 *   node scripts/backfill-stripe-customer-names.js          # dry-run
 *   node scripts/backfill-stripe-customer-names.js --apply
 */
require('../src/config/env');
const pool = require('../src/db/client');
const stripe = require('../src/services/stripe.service');

const APPLY = process.argv.includes('--apply');

(async () => {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (ba.stripe_customer_id)
            ba.stripe_customer_id,
            u.id AS user_id,
            u.email,
            u.first_name,
            u.last_name
       FROM bank_accounts ba
       JOIN users u ON u.id = ba.user_id
      WHERE ba.stripe_customer_id IS NOT NULL
        AND ba.stripe_customer_id <> ''
      ORDER BY ba.stripe_customer_id, ba.updated_at DESC NULLS LAST`
  );

  // Also include users who paid by card/Cash App without a bank row — via payments metadata.
  const { rows: fromPayments } = await pool.query(
    `SELECT DISTINCT ON (p.tenant_id)
            NULL::text AS stripe_customer_id,
            u.id AS user_id,
            u.email,
            u.first_name,
            u.last_name
       FROM payments p
       JOIN users u ON u.id = p.tenant_id
      WHERE p.stripe_payment_intent_id IS NOT NULL
      ORDER BY p.tenant_id, p.created_at DESC`
  );

  const byUser = new Map();
  for (const r of [...rows, ...fromPayments]) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, r);
  }

  let updated = 0;
  let skipped = 0;
  let missing = 0;

  for (const row of byUser.values()) {
    const name = stripe.personDisplayName({
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
    });
    if (!name) {
      skipped++;
      continue;
    }

    let customerId = row.stripe_customer_id;
    if (!customerId) {
      // Resolve via metadata search / create path (also sets name).
      if (!APPLY) {
        console.log(`[dry] would sync user ${row.email} → ${name}`);
        updated++;
        continue;
      }
      customerId = await stripe.getOrCreateCustomer(row.user_id, row.email, {
        firstName: row.first_name,
        lastName: row.last_name,
      });
      updated++;
      console.log(`synced ${row.email} → ${customerId} (${name})`);
      continue;
    }

    if (!APPLY) {
      console.log(`[dry] would update ${customerId} ${row.email} → ${name}`);
      updated++;
      continue;
    }

    try {
      await stripe.syncCustomerProfile(customerId, { name, email: row.email });
      updated++;
      console.log(`updated ${customerId} ${row.email} → ${name}`);
    } catch (err) {
      if (err?.code === 'resource_missing') {
        missing++;
        console.warn(`missing customer ${customerId} for ${row.email}`);
      } else {
        throw err;
      }
    }
  }

  console.log(JSON.stringify({ apply: APPLY, updated, skipped, missing, users: byUser.size }));
  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
