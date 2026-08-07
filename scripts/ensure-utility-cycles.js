#!/usr/bin/env node
/**
 * Monthly utility cycle health check for 743 (Dominion + HRSD).
 * Does NOT notify tenants. Alerts owner by email when something looks wrong.
 *
 * Dry-run / always prints report. SEND_ALERT=1 to email owner.
 */
require('../src/config/env');
const pool = require('../src/db/client');

const PROPERTY_ID = process.env.PROPERTY_ID || 'cccccccc-0000-0000-0000-000000000001';
const OWNER_EMAIL = process.env.OWNER_EMAIL || null;
const SEND_ALERT = process.env.SEND_ALERT === '1';
const ELECTRIC_MAX_AGE_DAYS = Number(process.env.ELECTRIC_MAX_AGE_DAYS || 45);
const WATER_MAX_AGE_DAYS = Number(process.env.WATER_MAX_AGE_DAYS || 45);

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

async function latestBill(service) {
  // Prefer open/collectible cycles over settled history (settled Aug phantoms sort newer by period_end).
  const { rows } = await pool.query(
    `SELECT id, status, period_start::text, period_end::text, due_date::text,
            total_amount, tenant_charge_amount, statement_balance, amount_source,
            provider_name
       FROM utility_bills
      WHERE property_id = $1 AND service_type = $2
      ORDER BY
        CASE status::text
          WHEN 'draft' THEN 0
          WHEN 'notified' THEN 0
          WHEN 'charging' THEN 1
          ELSE 2
        END,
        period_end DESC NULLS LAST,
        created_at DESC
      LIMIT 1`,
    [PROPERTY_ID, service]
  );
  return rows[0] || null;
}

async function main() {
  const issues = [];
  const electric = await latestBill('electric');
  const water = await latestBill('water');

  console.log('Electric latest:', electric);
  console.log('Water latest:', water);

  if (!electric) {
    issues.push('No electric bill found for 743.');
  } else {
    const age = daysSince(electric.period_end);
    if (age != null && age > ELECTRIC_MAX_AGE_DAYS) {
      issues.push(
        `Electric period_end ${electric.period_end} is ${age}d old (>${ELECTRIC_MAX_AGE_DAYS}). Import BillingHistory or portal extract.`
      );
    }
    if (
      electric.amount_source === 'amount_due_fallback' ||
      electric.amount_source === 'parsed_total'
    ) {
      issues.push(
        `Electric ${electric.id} amount_source=${electric.amount_source} — do not notify until Current Charges confirmed.`
      );
    }
    const charge = Number(electric.tenant_charge_amount ?? electric.total_amount);
    const bal = electric.statement_balance != null ? Number(electric.statement_balance) : null;
    if (bal != null && Math.abs(charge - bal) < 0.01 && charge >= 400) {
      issues.push(
        `Electric charge $${charge.toFixed(2)} equals statement balance — likely Amount Due, not Current Charges.`
      );
    }
  }

  if (!water) {
    issues.push('No water bill found for 743.');
  } else {
    const age = daysSince(water.period_end);
    if (age != null && age > WATER_MAX_AGE_DAYS) {
      issues.push(
        `Water period_end ${water.period_end} is ${age}d old (>${WATER_MAX_AGE_DAYS}). Check HRSD / Gmail import.`
      );
    }
    const start = String(water.period_start || '').slice(0, 10);
    const end = String(water.period_end || '').slice(0, 10);
    if (start.endsWith('-01') && /-(28|29|30|31)$/.test(end) && start.slice(0, 7) === end.slice(0, 7)) {
      issues.push(
        `Water ${water.id} looks like a calendar-month snap (${start}–${end}). Prefer HRSD Billing Period dates.`
      );
    }
  }

  // Flag open notified bills while auto-notify should be off (informational)
  const { rows: notified } = await pool.query(
    `SELECT id, service_type, status FROM utility_bills
      WHERE property_id = $1 AND status = 'notified'`,
    [PROPERTY_ID]
  );
  if (notified.length && process.env.UTILITIES_AUTO_NOTIFY_ENABLED !== 'true') {
    issues.push(
      `${notified.length} bill(s) still notified while UTILITIES_AUTO_NOTIFY_ENABLED is off: ${notified.map((b) => b.id.slice(0, 8)).join(', ')}`
    );
  }

  const report = {
    ok: issues.length === 0,
    issues,
    electric_id: electric?.id || null,
    water_id: water?.id || null,
    auto_notify: process.env.UTILITIES_AUTO_NOTIFY_ENABLED === 'true',
  };
  console.log(JSON.stringify(report, null, 2));

  if (SEND_ALERT && issues.length) {
    const { sendEmail } = require('../src/services/email.service');
    const { rows: [org] } = await pool.query(
      `SELECT org_id FROM properties WHERE id = $1`,
      [PROPERTY_ID]
    );
    let to = OWNER_EMAIL;
    if (!to) {
      const { rows: [owner] } = await pool.query(
        `SELECT email FROM users
          WHERE role = 'owner' AND is_active = TRUE
          ORDER BY created_at ASC LIMIT 1`
      );
      to = owner?.email;
    }
    if (!to) {
      console.warn('SEND_ALERT set but no OWNER_EMAIL / owner user found — skipping email');
    } else {
      await sendEmail({
        orgId: org.org_id,
        to,
        subject: `[Utilities] Cycle check needs attention — 743 A Ave`,
        text: [
          'Utility monthly health check found issues (tenants were NOT notified):',
          '',
          ...issues.map((i) => `• ${i}`),
          '',
          'Auto-notify remains off until UTILITIES_AUTO_NOTIFY_ENABLED=true.',
          '',
          '— Montero Rentals',
        ].join('\n'),
      });
      console.log('Alert emailed to', to);
    }
  }

  await pool.end();
  process.exit(issues.length ? 2 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
