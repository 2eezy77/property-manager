/**
 * One-time production prep: remove demo properties + unverified test payments.
 *
 *   node scripts/production-cleanup.js           # dry-run (default)
 *   node scripts/production-cleanup.js --apply # execute deletes
 */
require('../src/config/env');
const pool = require('../src/db/client');
const Stripe = require('stripe');

const APPLY = process.argv.includes('--apply');
const RESET_CHECKIN = process.argv.includes('--reset-checkin');
const UNLINK_PLAID = process.argv.includes('--unlink-sandbox-plaid');
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'josemontero2002@gmail.com';
const PLAID_ENV = (process.env.PLAID_ENV || 'sandbox').toLowerCase();

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  : null;

function isDemoProperty(row) {
  return (
    /sunset/i.test(row.name || '')
    || (/miami/i.test(row.city || '') && !/norfolk/i.test(row.city || ''))
  );
}

/** Keep verified offline imports and future live Stripe ACH; drop sandbox/test rows. */
function shouldRemovePayment(p) {
  if (p.test) return true;
  if (isDemoProperty({ name: p.property_name, city: p.property_city })) return true;
  if (/smoke|sandbox|test/i.test(p.notes || '')) return true;

  const source = p.source || '';
  if (source === 'cash_app_import' || source === 'manual') return false;

  // Stripe sandbox smoke tests (tenants re-link banks for live ACH)
  if (p.stripe_payment_intent_id) return true;

  return false;
}

async function deleteLeasesForProperty(client, propertyId) {
  const unitIds = (
    await client.query('SELECT id FROM units WHERE property_id = $1', [propertyId])
  ).rows.map((r) => r.id);
  if (!unitIds.length) return;

  const leaseIds = (
    await client.query('SELECT id FROM leases WHERE unit_id = ANY($1::uuid[])', [unitIds])
  ).rows.map((r) => r.id);

  const maintIds = (
    await client.query(
      'SELECT id FROM maintenance_requests WHERE unit_id = ANY($1::uuid[]) OR lease_id = ANY($2::uuid[])',
      [unitIds, leaseIds.length ? leaseIds : ['00000000-0000-0000-0000-000000000000']]
    )
  ).rows.map((r) => r.id);

  if (maintIds.length) {
    await client.query(
      'UPDATE message_threads SET maintenance_request_id = NULL WHERE maintenance_request_id = ANY($1::uuid[])',
      [maintIds]
    );
    await client.query('DELETE FROM maintenance_requests WHERE id = ANY($1::uuid[])', [maintIds]);
  }

  if (leaseIds.length) {
    await client.query('DELETE FROM payment_splits WHERE payment_id IN (SELECT id FROM payments WHERE lease_id = ANY($1::uuid[]))', [leaseIds]);
    await client.query('UPDATE utility_bill_splits SET payment_id = NULL WHERE payment_id IN (SELECT id FROM payments WHERE lease_id = ANY($1::uuid[]))', [leaseIds]);
    await client.query('UPDATE late_fees SET payment_id = NULL WHERE payment_id IN (SELECT id FROM payments WHERE lease_id = ANY($1::uuid[]))', [leaseIds]);
    await client.query('DELETE FROM payments WHERE lease_id = ANY($1::uuid[])', [leaseIds]);
    await client.query('DELETE FROM late_fees WHERE lease_id = ANY($1::uuid[])', [leaseIds]);
    await client.query('DELETE FROM signature_envelopes WHERE lease_id = ANY($1::uuid[])', [leaseIds]);
    await client.query('DELETE FROM leases WHERE id = ANY($1::uuid[])', [leaseIds]);
  }
}

async function wipeQaArtifacts(client) {
  const patterns = ['comms-smoke-test%', 'QA Test%', 'QA maint%', 'QA ann%', '%QA subagent%', '%smoke test%'];

  for (const like of patterns) {
    await client.query(
      `DELETE FROM notifications WHERE related_entity_id IN (
         SELECT id FROM announcements WHERE title ILIKE $1
       )`,
      [like]
    );
    await client.query(`DELETE FROM announcements WHERE title ILIKE $1`, [like]);
  }

  const { rows: threads } = await client.query(
    `SELECT id FROM message_threads
      WHERE subject ILIKE ANY($1::text[])`,
    [['comms-smoke-test%', 'QA thread%', '%QA subagent%', '%smoke test%']]
  );
  for (const t of threads) {
    await client.query(`DELETE FROM messages WHERE thread_id = $1`, [t.id]);
    await client.query(`DELETE FROM message_threads WHERE id = $1`, [t.id]);
  }

  const { rows: mrs } = await client.query(
    `SELECT id FROM maintenance_requests
      WHERE title ILIKE ANY($1::text[])`,
    [['comms-smoke-test%', 'QA Test%', 'QA maint%', '%QA subagent%', '%smoke test%']]
  );
  for (const mr of mrs) {
    await client.query(
      'DELETE FROM maintenance_status_history WHERE request_id = $1',
      [mr.id]
    );
    await client.query(
      'UPDATE message_threads SET maintenance_request_id = NULL WHERE maintenance_request_id = $1',
      [mr.id]
    );
    await client.query('DELETE FROM maintenance_requests WHERE id = $1', [mr.id]);
  }

  const { rows: qaPay } = await client.query(
    `SELECT id FROM payments
      WHERE COALESCE(metadata->>'qa_late_fee', '') <> ''
         OR COALESCE(metadata->>'test', '') <> ''`
  );
  if (qaPay.length) {
    const ids = qaPay.map((p) => p.id);
    await client.query('DELETE FROM payment_splits WHERE payment_id = ANY($1::uuid[])', [ids]);
    await client.query(
      'UPDATE utility_bill_splits SET payment_id = NULL WHERE payment_id = ANY($1::uuid[])',
      [ids]
    );
    await client.query(
      'UPDATE late_fees SET payment_id = NULL WHERE payment_id = ANY($1::uuid[])',
      [ids]
    );
    const del = await client.query('DELETE FROM payments WHERE id = ANY($1::uuid[])', [ids]);
    console.log(`  Deleted ${del.rowCount} QA/test payment(s).`);
  }

  const utilDel = await client.query(
    `DELETE FROM utility_bill_splits WHERE bill_id IN (
       SELECT id FROM utility_bills WHERE notes ILIKE '%smoke test%'
     )`
  );
  await client.query(`DELETE FROM utility_bills WHERE notes ILIKE '%smoke test%'`);
  if (utilDel.rowCount || utilDel.rowCount === 0) {
    console.log('  Removed smoke-test utility bill rows (if any).');
  }
}

/** Plaid sandbox institutions / account names (user_good, Platypus OAuth, etc.) */
function isSandboxPlaidRow(row) {
  const acct = (row.account_name || '').toLowerCase();
  const inst = (row.institution_name || '').toLowerCase();
  return (
    acct.startsWith('plaid ')
    || inst.includes('platypus')
    || (row.account_mask === '0000' && acct.includes('plaid'))
  );
}

async function removeSandboxPlaidBanks(client) {
  const { rows: all } = await client.query(
    `SELECT ba.id, ba.user_id, ba.stripe_customer_id, ba.stripe_bank_account_id,
            ba.institution_name, ba.account_name, ba.account_mask,
            u.email, u.role
       FROM bank_accounts ba
       JOIN users u ON u.id = ba.user_id
      WHERE ba.status <> 'revoked'
      ORDER BY u.email`
  );

  const toRemove = PLAID_ENV !== 'production'
    ? all.filter((r) => r.role === 'tenant')
    : all.filter(isSandboxPlaidRow);

  if (!toRemove.length) {
    console.log('  No sandbox Plaid bank accounts to remove.');
    return;
  }

  console.log(`  Plaid env: ${PLAID_ENV} — removing ${toRemove.length} linked bank account(s):`);
  toRemove.forEach((r) =>
    console.log(`    ✗ ${r.email} — ${r.institution_name} ${r.account_name} (••${r.account_mask || '????'})`)
  );

  const ids = toRemove.map((r) => r.id);

  await client.query(
    `UPDATE leases
        SET autopay_enabled = FALSE,
            autopay_bank_account_id = NULL
      WHERE autopay_bank_account_id = ANY($1::uuid[])`,
    [ids]
  );
  await client.query(
    `UPDATE payments SET bank_account_id = NULL WHERE bank_account_id = ANY($1::uuid[])`,
    [ids]
  );

  if (stripe) {
    for (const row of toRemove) {
      if (row.stripe_customer_id && row.stripe_bank_account_id) {
        try {
          await stripe.customers.deleteSource(
            row.stripe_customer_id,
            row.stripe_bank_account_id
          );
        } catch {
          /* best-effort — DB row removed so tenant can re-link */
        }
      }
    }
  }

  const del = await client.query('DELETE FROM bank_accounts WHERE id = ANY($1::uuid[])', [ids]);
  console.log(`  Deleted ${del.rowCount} sandbox Plaid bank account(s) from DB.`);
}

async function resetTenantCheckin(client) {
  const { rowCount } = await client.query(
    `UPDATE users
        SET password_changed_at = NULL,
            lease_viewed_at = NULL,
            maintenance_viewed_at = NULL,
            vivint_access_configured_at = NULL,
            vivint_access_configured_by = NULL
      WHERE role = 'tenant'
        AND email <> $1
        AND email NOT ILIKE '%@demo.com'`,
    [OWNER_EMAIL]
  );
  console.log(`  Reset check-in progress for ${rowCount} tenant(s) (kept ${OWNER_EMAIL}).`);
}

async function resetLeaseOffboarding(client) {
  const { rowCount } = await client.query(
    `UPDATE leases
        SET offboarding_started_at = NULL,
            offboarding_started_by = NULL,
            offboard_forwarding_confirmed_at = NULL,
            offboard_keys_returned_at = NULL,
            offboard_final_charges_ack_at = NULL,
            offboard_moveout_confirmed_at = NULL,
            offboard_vivint_revoked_at = NULL,
            offboard_vivint_revoked_by = NULL,
            offboard_bank_unlinked_at = NULL,
            offboard_bank_unlinked_by = NULL,
            offboard_utilities_settled_at = NULL,
            offboard_utilities_settled_by = NULL,
            offboard_portal_disabled_at = NULL,
            offboard_portal_disabled_by = NULL,
            updated_at = NOW()`
  );
  console.log(`  Reset move-out offboarding on ${rowCount} lease(s).`);
}

async function resetManagerPlaybook(client) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'manager_playbook_checklist'`
  );
  if (!rows.length) return;

  const { rowCount } = await client.query(
    `UPDATE manager_playbook_checklist
        SET last_completed_at = NULL,
            last_verified_at = NULL,
            updated_at = NOW()`
  );
  if (rowCount) {
    console.log(`  Reset manager playbook progress for ${rowCount} step(s).`);
  }
}

/** Remove stray demo.com tenants (e.g. alex.tenant@demo.com) and their data. */
async function removeDemoUsers(client) {
  const { rows: demos } = await client.query(
    `SELECT id, email, role FROM users
      WHERE email ILIKE '%@demo.com'
         OR email ILIKE '%@demo.%'`
  );
  if (!demos.length) {
    console.log('  No demo users found.');
    return;
  }

  for (const u of demos) {
    const { rows: leaseIds } = await client.query(
      'SELECT id FROM leases WHERE tenant_id = $1',
      [u.id]
    );
    const lids = leaseIds.map((r) => r.id);

    if (lids.length) {
      await client.query(
        'DELETE FROM payment_splits WHERE payment_id IN (SELECT id FROM payments WHERE lease_id = ANY($1::uuid[]))',
        [lids]
      );
      await client.query(
        'UPDATE utility_bill_splits SET payment_id = NULL WHERE payment_id IN (SELECT id FROM payments WHERE lease_id = ANY($1::uuid[]))',
        [lids]
      );
      await client.query(
        'UPDATE late_fees SET payment_id = NULL WHERE payment_id IN (SELECT id FROM payments WHERE lease_id = ANY($1::uuid[]))',
        [lids]
      );
      await client.query('DELETE FROM payments WHERE lease_id = ANY($1::uuid[])', [lids]);
      await client.query('DELETE FROM late_fees WHERE lease_id = ANY($1::uuid[])', [lids]);
      await client.query('DELETE FROM signature_envelopes WHERE lease_id = ANY($1::uuid[])', [lids]);
      await client.query('DELETE FROM leases WHERE id = ANY($1::uuid[])', [lids]);
    }

    await client.query('DELETE FROM payments WHERE tenant_id = $1', [u.id]);
    await client.query('DELETE FROM bank_accounts WHERE user_id = $1', [u.id]);
    await client.query(
      'DELETE FROM maintenance_status_history WHERE request_id IN (SELECT id FROM maintenance_requests WHERE tenant_id = $1)',
      [u.id]
    );
    await client.query('DELETE FROM maintenance_requests WHERE tenant_id = $1', [u.id]);
    await client.query('DELETE FROM messages WHERE sender_user_id = $1', [u.id]);
    await client.query('DELETE FROM message_threads WHERE tenant_id = $1', [u.id]);
    await client.query('DELETE FROM notifications WHERE user_id = $1', [u.id]);
    await client.query('DELETE FROM property_assignments WHERE user_id = $1', [u.id]);
    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [u.id]);
    await client.query('DELETE FROM users WHERE id = $1', [u.id]);
    console.log(`  Removed demo user: ${u.email} (${u.role})`);
  }
}

async function main() {
  console.log(APPLY ? '\n=== PRODUCTION CLEANUP (APPLY) ===\n' : '\n=== PRODUCTION CLEANUP (dry-run) ===\n');

  const { rows: props } = await pool.query(
    `SELECT id, name, address_line1, city, state,
            (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id) AS units,
            (SELECT COUNT(*) FROM leases l JOIN units u ON u.id = l.unit_id WHERE u.property_id = p.id) AS leases
     FROM properties p
     ORDER BY name`
  );
  console.log('Properties:');
  props.forEach((p) => console.log(`  - ${p.name} (${p.city}, ${p.state}) — ${p.units} units, ${p.leases} leases`));

  const demoProps = props.filter(isDemoProperty);

  const { rows: allPayments } = await pool.query(
    `SELECT p.id, p.amount, p.status, p.payment_type, p.period_start, p.paid_at,
            p.stripe_payment_intent_id, p.lease_id,
            p.metadata->>'source' AS source,
            p.metadata->>'test' AS test,
            p.metadata->>'notes' AS notes,
            pr.name AS property_name, pr.city AS property_city,
            u.first_name, u.last_name
     FROM payments p
     JOIN leases l ON l.id = p.lease_id
     JOIN units un ON un.id = l.unit_id
     JOIN properties pr ON pr.id = un.property_id
     JOIN users u ON u.id = p.tenant_id
     ORDER BY COALESCE(p.paid_at, p.created_at) DESC`
  );

  const toDelete = allPayments.filter(shouldRemovePayment);
  const toKeep = allPayments.filter((p) => !toDelete.some((d) => d.id === p.id));

  console.log(`\nPayments: ${allPayments.length} total`);
  console.log(`  Keep (${toKeep.length}):`);
  toKeep.forEach((p) =>
    console.log(`    ✓ $${p.amount} ${p.status} — ${p.first_name} ${p.last_name} (${p.source || 'ledger'})`)
  );
  console.log(`  Remove (${toDelete.length}):`);
  toDelete.forEach((p) =>
    console.log(`    ✗ $${p.amount} ${p.status} — ${p.first_name} ${p.last_name} @ ${p.property_name}`)
  );

  if (demoProps.length) {
    console.log(`\nDemo properties to remove (${demoProps.length}):`);
    demoProps.forEach((p) => console.log(`  ✗ ${p.name} — ${p.address_line1}, ${p.city}`));
  } else {
    console.log('\nNo demo properties found.');
  }

  if (UNLINK_PLAID && !RESET_CHECKIN && !APPLY) {
    const { rows: banks } = await pool.query(
      `SELECT ba.id, u.email, u.role, ba.institution_name, ba.account_name, ba.account_mask
         FROM bank_accounts ba JOIN users u ON u.id = ba.user_id WHERE ba.status <> 'revoked'`
    );
    const toRemove = PLAID_ENV !== 'production'
      ? banks.filter((r) => r.role === 'tenant')
      : banks.filter(isSandboxPlaidRow);
    console.log('\nSandbox Plaid banks (preview):');
    toRemove.forEach((r) =>
      console.log(`  ✗ ${r.email} — ${r.institution_name} ${r.account_name}`)
    );
    if (!toRemove.length) console.log('  (none)');
  }

  if (RESET_CHECKIN || APPLY) {
    const { rows: tenants } = await pool.query(
      `SELECT email, password_changed_at, lease_viewed_at, maintenance_viewed_at
         FROM users WHERE role = 'tenant' ORDER BY email`
    );
    console.log('\nTenant check-in (will reset all tenants except owner email):');
    tenants.forEach((t) => {
      const done = [t.password_changed_at, t.lease_viewed_at, t.maintenance_viewed_at]
        .filter(Boolean).length;
      console.log(`  ${t.email} — ${done}/3 steps recorded`);
    });
  }

  if (!APPLY && !RESET_CHECKIN && !UNLINK_PLAID) {
    console.log('\nDry run only. Re-run with --apply, --reset-checkin, and/or --unlink-sandbox-plaid.\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (RESET_CHECKIN || UNLINK_PLAID || APPLY) {
      if (UNLINK_PLAID || RESET_CHECKIN) {
        console.log('\nRemoving sandbox / test Plaid bank links…');
        await removeSandboxPlaidBanks(client);
      }
    }

    if (RESET_CHECKIN) {
      console.log('\nWiping QA / smoke artifacts…');
      await wipeQaArtifacts(client);
      await removeDemoUsers(client);
      await resetTenantCheckin(client);
      await resetLeaseOffboarding(client);
      await resetManagerPlaybook(client);
    }

    if (!APPLY) {
      await client.query('ROLLBACK');
      const hint = UNLINK_PLAID && !RESET_CHECKIN
        ? 'Use --apply --unlink-sandbox-plaid to commit.'
        : 'Use --apply (and --reset-checkin / --unlink-sandbox-plaid) to commit.';
      console.log(`\nRolled back (dry-run). ${hint}\n`);
      return;
    }

    const unlinkOnly = UNLINK_PLAID && !RESET_CHECKIN;
    if (!unlinkOnly) {
      if (toDelete.length) {
        const ids = toDelete.map((p) => p.id);
        await client.query('DELETE FROM payment_splits WHERE payment_id = ANY($1::uuid[])', [ids]);
        await client.query('UPDATE utility_bill_splits SET payment_id = NULL WHERE payment_id = ANY($1::uuid[])', [ids]);
        await client.query('UPDATE late_fees SET payment_id = NULL WHERE payment_id = ANY($1::uuid[])', [ids]);
        const del = await client.query('DELETE FROM payments WHERE id = ANY($1::uuid[])', [ids]);
        console.log(`\nDeleted ${del.rowCount} payment(s).`);
      }

      for (const prop of demoProps) {
        await deleteLeasesForProperty(client, prop.id);
        await client.query('DELETE FROM properties WHERE id = $1', [prop.id]);
        console.log(`Deleted property: ${prop.name}`);
      }
    }

    await client.query('COMMIT');
    console.log('\nCleanup complete.\n');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Usage:
//   node scripts/production-cleanup.js --reset-checkin           # dry-run check-in + QA wipe preview
//   node scripts/production-cleanup.js --apply --reset-checkin   # QA wipe + check-in reset + playbook reset + unlink sandbox Plaid
//   node scripts/production-cleanup.js --apply --unlink-sandbox-plaid  # Plaid banks only

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
