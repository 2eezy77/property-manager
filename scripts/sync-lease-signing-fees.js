/**
 * One-shot: sync lease-signing fee records (active + terminated + expired).
 * Usage: node scripts/sync-lease-signing-fees.js
 */
require('dotenv').config({ path: '.env.local' });
const pool = require('../src/db/client');
const { resolveOrgIdForUser } = require('../src/services/site-visits.service');
const {
  syncLeaseSigningFees,
  listLeaseSigningFees,
  markTenantFeePaidExternally,
} = require('../src/services/lease-signing-pay.service');

(async () => {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1`
  );
  if (!rows[0]) throw new Error('No owner user');
  const orgId = await resolveOrgIdForUser(rows[0].id);
  const ownerId = rows[0].id;

  const markPaidEmail = process.argv.find((a) => a.startsWith('--mark-paid='))?.split('=')[1]
    || (process.argv.includes('--mark-buckley-paid') ? 'buckleystone1@gmail.com' : null)
    || (process.argv.includes('--mark-isaiah-paid') ? 'isaiahreese13@outlook.com' : null);

  if (markPaidEmail) {
    const fee = await markTenantFeePaidExternally({
      orgId,
      ownerId,
      tenantEmail: markPaidEmail,
      note: 'Paid outside app before rent-gate tracking.',
    });
    console.log('marked paid:', fee.tenantName, fee.status);
  } else {
    const result = await syncLeaseSigningFees(orgId);
    console.log('sync:', result);
  }

  const list = await listLeaseSigningFees({ userId: ownerId, userRole: 'owner' });
  console.log('fees:', list.fees.map((f) => ({
    tenant: f.tenantName || f.tenantEmail,
    status: f.status,
    rentMonths: f.rentMonthsPaid,
    unit: f.unitNumber,
  })));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
