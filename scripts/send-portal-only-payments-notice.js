#!/usr/bin/env node
/**
 * Email active 743 tenants: portal-only payments (no off-app Cash App / cashtag).
 * Does NOT reset passwords or change tenant accounts.
 *
 *   node scripts/send-portal-only-payments-notice.js           # dry-run
 *   node scripts/send-portal-only-payments-notice.js --apply   # send via Gmail
 */
require('../src/config/env');
const pool = require('../src/db/client');
const { getStoredRefreshToken } = require('../src/services/gmail.service');
const { sendEmail } = require('../src/services/email.service');
const { renderPortalOnlyPayments } = require('../src/services/email-templates/portalOnlyPayments');

async function resolveOrgId() {
  const { rows } = await pool.query(
    `SELECT org_id FROM properties WHERE name ILIKE '%743%' LIMIT 1`
  );
  return rows[0]?.org_id ?? null;
}

async function loadActiveTenants() {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (u.id)
            u.id, u.email, u.first_name, u.last_name, un.unit_number
       FROM users u
       JOIN leases l ON l.tenant_id = u.id AND l.status = 'active'
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
      WHERE p.name ILIKE '%743%'
        AND u.role = 'tenant'
        AND u.is_active = TRUE
      ORDER BY u.id, un.unit_number NULLS LAST`
  );
  return rows;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const orgId = await resolveOrgId();
  if (!orgId) {
    console.error('743 property org not found.');
    process.exit(1);
  }

  const stored = await getStoredRefreshToken(orgId);
  if (!stored?.gmailAddress) {
    console.error('Gmail not connected. Owner → Utilities → Connect Gmail first.');
    process.exit(1);
  }

  const tenants = await loadActiveTenants();
  if (tenants.length === 0) {
    console.log('No active tenants found for 743.');
    return;
  }

  console.log(apply ? 'Mode: SEND\n' : 'Mode: dry-run\n');
  console.log(`From: ${stored.gmailAddress} (BCC)`);
  console.log(`Tenants: ${tenants.length} (accounts unchanged — no password resets)\n`);

  let sent = 0;
  for (const t of tenants) {
    const name = t.first_name || 'there';
    const unitLabel = t.unit_number ? `Unit ${t.unit_number}` : '';
    const { subject, html, text } = renderPortalOnlyPayments({
      recipientName: name,
      unitLabel,
      loginEmail: t.email,
    });

    console.log(`${t.email}${unitLabel ? ` (${unitLabel})` : ''} — ${subject}`);
    if (!apply) continue;

    await sendEmail({
      orgId,
      to: t.email,
      bcc: stored.gmailAddress,
      subject,
      html,
      text,
    });
    sent += 1;
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (apply) {
    console.log(`\nSent ${sent} notice(s). Tenant accounts were not modified.`);
  } else {
    console.log(`\nWould send ${tenants.length} notice(s). Re-run with --apply.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
