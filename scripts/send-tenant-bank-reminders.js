/**
 * Email active 743 tenants who have not linked a verified bank (no password reset).
 *
 *   node scripts/send-tenant-bank-reminders.js           # dry-run
 *   node scripts/send-tenant-bank-reminders.js --apply   # send via Gmail
 */
require('../src/config/env');
const pool = require('../src/db/client');
const { getStoredRefreshToken } = require('../src/services/gmail.service');
const { sendEmail } = require('../src/services/email.service');
const { renderBankLinkReminder } = require('../src/services/email-templates/bankLinkReminder');

async function resolveOrgId() {
  const { rows } = await pool.query(
    `SELECT org_id FROM properties WHERE name ILIKE '%743%' LIMIT 1`
  );
  return rows[0]?.org_id ?? null;
}

async function loadTenantsNeedingBank() {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, un.unit_number
       FROM users u
       JOIN leases l ON l.tenant_id = u.id AND l.status = 'active'
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
      WHERE p.name ILIKE '%743%'
        AND u.role = 'tenant'
        AND u.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM bank_accounts ba
           WHERE ba.user_id = u.id
             AND ba.status = 'verified'
             AND ba.link_status = 'active'
        )
      ORDER BY un.unit_number NULLS LAST, u.email`
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

  const tenants = await loadTenantsNeedingBank();
  if (tenants.length === 0) {
    console.log('All active tenants have a verified bank linked.');
    return;
  }

  console.log(apply ? 'Mode: SEND\n' : 'Mode: dry-run\n');
  console.log(`From: ${stored.gmailAddress} (BCC)\n`);

  let sent = 0;
  for (const t of tenants) {
    const name = t.first_name || 'there';
    const unitLabel = t.unit_number ? `Unit ${t.unit_number}` : '';
    const { subject, html, text } = renderBankLinkReminder({
      recipientName: name,
      unitLabel,
      loginEmail: t.email,
    });

    console.log(`${t.email} — ${subject}`);
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
    console.log(`\nSent ${sent} reminder(s).`);
  } else {
    console.log(`\nWould send ${tenants.length} reminder(s). Re-run with --apply.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
