/**
 * Fresh Dominion import from BillingHistory.xlsx (Dominion Energy portal export).
 *
 *   node scripts/import-dominion-billing-history.js [path/to/BillingHistory.xlsx]
 *   node scripts/import-dominion-billing-history.js --apply
 *   node scripts/import-dominion-billing-history.js --apply --tenant-billing-from 2026-05-01
 *
 * Default xlsx: %USERPROFILE%/Downloads/BillingHistory.xlsx
 *
 * After import, only the **most recent** electric bill per property is collectible; older periods are settled.
 * --owner-paid-through  Stored on property (default: today).
 * --property            Property name substring (default: 743).
 */
require('../src/config/env');
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/client');
const { computeChargeableAfter } = require('../src/services/dominion-billing.service');
const { loadActiveLeases, computeSplitsForBill } = require('../src/use-cases/utilities/domain');
const { enforceLatestCollectible } = require('../src/use-cases/utilities/enforce-latest-collectible');

const APPLY = process.argv.includes('--apply');
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'josemontero2002@gmail.com';

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function defaultXlsxPath() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, 'Downloads', 'BillingHistory.xlsx');
}

function excelDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  return new Date(Math.round((n - 25569) * 86400 * 1000));
}

function iso(d) {
  return d ? d.toISOString().slice(0, 10) : null;
}

function money(s) {
  return parseFloat(String(s).replace(/[^0-9.-]/g, '')) || 0;
}

function parseRows(xlsxPath) {
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch {
    console.error('Missing xlsx package. Run: npm install xlsx --save-dev');
    process.exit(1);
  }
  if (!fs.existsSync(xlsxPath)) {
    console.error(`File not found: ${xlsxPath}`);
    process.exit(1);
  }
  const wb = XLSX.readFile(xlsxPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  return raw
    .map((r) => {
      const due = excelDate(r['Due Date']);
      const days = parseInt(r['Billing Days'], 10) || 30;
      if (!due) return null;
      const periodEnd = new Date(due);
      const periodStart = new Date(periodEnd);
      periodStart.setDate(periodStart.getDate() - days);
      const charges = money(r['Current Charges']);
      if (charges <= 0) return null;
      return {
        periodStart: iso(periodStart),
        periodEnd: iso(periodEnd),
        dueDate: iso(periodEnd),
        billingDays: days,
        currentCharges: charges,
        accountBalance: money(r['Total account balance']),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

async function resolveProperty(namePart) {
  const { rows } = await pool.query(
    `SELECT id, name, dominion_account_number
       FROM properties
      WHERE name ILIKE $1
      ORDER BY name
      LIMIT 1`,
    [`%${namePart}%`]
  );
  return rows[0] ?? null;
}

async function resolveOwner() {
  const { rows } = await pool.query(
    `SELECT id, email FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [OWNER_EMAIL]
  );
  return rows[0] ?? null;
}

async function deleteDominionBills(client, propertyId) {
  const { rows } = await client.query(
    `SELECT id FROM utility_bills
      WHERE property_id = $1
        AND service_type = 'electric'
        AND (
          provider_name ILIKE '%dominion%'
          OR notes ILIKE '%dominion%'
          OR gmail_message_id LIKE 'dominion-xlsx-%'
        )`,
    [propertyId]
  );
  const ids = rows.map((r) => r.id);
  if (!ids.length) return 0;
  await client.query('DELETE FROM utility_bill_splits WHERE bill_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM utility_bills WHERE id = ANY($1::uuid[])', [ids]);
  return ids.length;
}

async function main() {
  const xlsxPath = process.argv.find((a) => a.endsWith('.xlsx')) || defaultXlsxPath();
  const ownerPaidThrough = argValue('--owner-paid-through', iso(new Date()));
  const propertyPart = argValue('--property', '743');

  const periods = parseRows(xlsxPath);
  if (!periods.length) {
    console.error('No billing periods parsed from spreadsheet.');
    process.exit(1);
  }

  const property = await resolveProperty(propertyPart);
  if (!property) {
    console.error(`Property not found matching "${propertyPart}".`);
    process.exit(1);
  }
  const owner = await resolveOwner();
  if (!owner) {
    console.error(`Owner not found: ${OWNER_EMAIL}`);
    process.exit(1);
  }

  const latest = periods[periods.length - 1];

  console.log(`\nDominion import — ${property.name}`);
  console.log(`  XLSX: ${xlsxPath} (${periods.length} periods)`);
  console.log(`  Owner paid through (stored): ${ownerPaidThrough}`);
  console.log(`  Tenant-owed: **latest bill only** (${latest.periodStart} → ${latest.periodEnd}, $${latest.currentCharges.toFixed(2)})`);
  console.log(`  Historical (${periods.length - 1} older): settled / waived after import`);
  console.log(`  Mode: ${APPLY ? 'APPLY' : 'dry-run'}\n`);
  console.log(
    `\nLatest statement: ${latest.periodStart} → ${latest.periodEnd}, charges $${latest.currentCharges.toFixed(2)}, account balance $${latest.accountBalance.toFixed(2)}`
  );

  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to reset Dominion bills and import.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const removed = await deleteDominionBills(client, property.id);
    console.log(`\nRemoved ${removed} existing Dominion electric bill(s).`);

    let imported = 0;
    let splitSummary = [];

    for (const p of periods) {
      const isLatest =
        p.periodEnd === latest.periodEnd && p.periodStart === latest.periodStart;
      const status = isLatest ? 'draft' : 'settled';
      const gmailId = `dominion-xlsx-${p.periodEnd}`;
      const notes = isLatest
        ? `Dominion import · latest bill — tenant collectible · stmt balance $${p.accountBalance.toFixed(2)}`
        : `Dominion import · resolved history · owner paid through ${ownerPaidThrough}`;

      const leases = await loadActiveLeases(client, property.id, p.periodStart, p.periodEnd);
      const billStub = {
        service_type: 'electric',
        tenant_charge_amount: p.currentCharges,
        total_amount: p.currentCharges,
      };
      const splits = leases.length
        ? await computeSplitsForBill(client, {
          propertyId: property.id,
          service_type: 'electric',
          leases,
          bill: billStub,
          period_start: p.periodStart,
          period_end: p.periodEnd,
        })
        : [];
      const chargeableAfter = computeChargeableAfter(p.periodEnd);

      const { rows: existing } = await client.query(
        `SELECT id FROM utility_bills WHERE gmail_message_id = $1 LIMIT 1`,
        [gmailId]
      );

      let bill;
      if (existing.length) {
        const { rows: [updated] } = await client.query(
          `UPDATE utility_bills
              SET total_amount = $2,
                  tenant_charge_amount = $2,
                  statement_balance = $3,
                  amount_source = 'current_charges',
                  chargeable_after = $4,
                  amount_pulled_at = NOW(),
                  period_start = $5, period_end = $6,
                  notes = $7, status = $8, settled_at = $9, updated_at = NOW()
            WHERE id = $1
            RETURNING id`,
          [
            existing[0].id,
            p.currentCharges,
            p.accountBalance,
            chargeableAfter,
            p.periodStart,
            p.periodEnd,
            notes,
            status,
            isLatest ? null : new Date(),
          ]
        );
        bill = updated;
      } else {
        const { rows: [inserted] } = await client.query(
          `INSERT INTO utility_bills
             (property_id, created_by, service_type, provider_name,
              period_start, period_end, total_amount, due_date,
              notes, gmail_message_id, status, settled_at,
              tenant_charge_amount, statement_balance, amount_source,
              chargeable_after, amount_pulled_at)
           VALUES ($1,$2,'electric','Dominion Energy Virginia',$3,$4,$5,$6,$7,$8,$9,$10,
                   $5,$11,'current_charges',$12,NOW())
           RETURNING id`,
          [
            property.id,
            owner.id,
            p.periodStart,
            p.periodEnd,
            p.currentCharges,
            p.dueDate,
            notes,
            gmailId,
            status,
            isLatest ? null : new Date(),
            p.accountBalance,
            chargeableAfter,
          ]
        );
        bill = inserted;
      }

      await client.query('DELETE FROM utility_bill_splits WHERE bill_id = $1', [bill.id]);

      for (const s of splits) {
        const splitStatus = isLatest ? 'pending' : 'waived';
        await client.query(
          `INSERT INTO utility_bill_splits (bill_id, lease_id, tenant_id, amount, status, waived_by, waived_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            bill.id,
            s.leaseId,
            s.tenantId,
            s.amount,
            splitStatus,
            isLatest ? null : owner.id,
            isLatest ? null : new Date(),
          ]
        );
        if (isLatest) {
          const { rows: [t] } = await client.query(
            `SELECT first_name, last_name FROM users WHERE id = $1`,
            [s.tenantId]
          );
          splitSummary.push({
            period: `${p.periodStart}`,
            name: `${t?.first_name || ''} ${t?.last_name || ''}`.trim(),
            amount: s.amount,
          });
        }
      }
      imported += 1;
    }

    const policy = await enforceLatestCollectible(client, {
      propertyId: property.id,
      serviceType: 'electric',
      ownerId: owner.id,
    });

    await client.query(
      `UPDATE properties
          SET dominion_owner_paid_through = $2::date,
              dominion_tenant_billing_from = $3::date,
              updated_at = NOW()
        WHERE id = $1`,
      [property.id, ownerPaidThrough, latest.periodStart]
    );

    await client.query('COMMIT');

    console.log(`\nImported ${imported} Dominion bill period(s).`);
    console.log(
      `Policy: ${policy.settled_older} older bill(s) settled, ${policy.splits_waived} split(s) waived, latest reopened: ${policy.latest_reopened}`
    );
    if (splitSummary.length) {
      console.log('\nTenant shares (draft — notify/charge in Utilities):');
      for (const s of splitSummary) {
        console.log(`  ${s.period}  ${s.name}  $${s.amount}`);
      }
    }
    console.log('\nNext: Manager → Utilities → review draft bill(s) → Notify tenants.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
