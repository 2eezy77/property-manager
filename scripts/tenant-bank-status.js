/**
 * List active 743 tenants and whether they have a verified Plaid bank link.
 * Usage: node scripts/tenant-bank-status.js
 */
require('../src/config/env');
const pool = require('../src/db/client');

async function main() {
  const { rows } = await pool.query(
    `SELECT u.email,
            u.first_name,
            u.last_name,
            un.unit_number,
            ba.institution_name,
            ba.account_mask,
            ba.status AS bank_status,
            ba.link_status,
            ba.created_at AS linked_at
       FROM users u
       JOIN leases l ON l.tenant_id = u.id AND l.status = 'active'
       JOIN units un ON un.id = l.unit_id
       JOIN properties p ON p.id = un.property_id
       LEFT JOIN LATERAL (
         SELECT institution_name, account_mask, status, link_status, created_at
           FROM bank_accounts ba
          WHERE ba.user_id = u.id AND ba.status <> 'revoked'
          ORDER BY ba.is_default DESC, ba.created_at DESC
          LIMIT 1
       ) ba ON TRUE
      WHERE p.name ILIKE '%743%'
        AND u.role = 'tenant'
        AND u.is_active = TRUE
      ORDER BY un.unit_number NULLS LAST, u.email`
  );

  if (rows.length === 0) {
    console.log('No active tenants found for 743.');
    return;
  }

  let linked = 0;
  for (const r of rows) {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email;
    const ok = r.bank_status === 'verified' && r.link_status === 'active';
    if (ok) linked += 1;
    const bank = ok
      ? `${r.institution_name} ····${r.account_mask}`
      : r.bank_status
        ? `${r.bank_status}${r.link_status === 'needs_relink' ? ' (reconnect needed)' : ''}`
        : 'NOT LINKED';
    console.log(`Unit ${r.unit_number || '?'} | ${name} | ${r.email}`);
    console.log(`  Bank: ${bank}`);
  }

  console.log(`\n${linked}/${rows.length} tenant(s) with verified active bank link.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
