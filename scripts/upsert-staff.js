#!/usr/bin/env node
/**
 * Add or update a staff user (property_manager or owner) in the 743 A Ave org.
 *
 *   node scripts/upsert-staff.js <email> <password> <first> <last> [role]
 *
 * Default role: property_manager (manager portal — no owner/admin console).
 * Pass "owner" only when explicitly needed (full /admin access).
 */
require('../src/config/env');
const bcrypt = require('bcrypt');
const { Client } = require('pg');

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'josemontero2002@gmail.com';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.argv[3];
  const firstName = process.argv[4]?.trim();
  const lastName = process.argv[5]?.trim();
  const role = process.argv[6]?.trim() || 'property_manager';

  if (!email || !password || !firstName || !lastName) {
    console.error('Usage: node scripts/upsert-staff.js <email> <password> <first> <last> [role]');
    process.exit(1);
  }
  if (!['property_manager', 'owner'].includes(role)) {
    console.error('Role must be property_manager or owner');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  let orgId;
  let orgName;

  const { rows: propOrg } = await client.query(
    `SELECT p.org_id, o.name AS org_name
       FROM properties p
       JOIN organizations o ON o.id = p.org_id
      WHERE p.address_line1 ILIKE '%743 A%'
      LIMIT 1`
  );
  if (propOrg[0]) {
    orgId = propOrg[0].org_id;
    orgName = propOrg[0].org_name;
  } else {
    const { rows: orgRows } = await client.query(
      `SELECT o.id AS org_id, o.name AS org_name
         FROM users u
         JOIN organizations o ON o.id = u.org_id OR o.owner_id = u.id
        WHERE LOWER(u.email) = LOWER($1)
        LIMIT 1`,
      [OWNER_EMAIL]
    );
    if (!orgRows[0]) {
      console.error(`Org not found (tried 743 A Ave property and ${OWNER_EMAIL})`);
      process.exit(1);
    }
    orgId = orgRows[0].org_id;
    orgName = orgRows[0].org_name;
  }

  const hash = await bcrypt.hash(password, 12);
  const { rows: existing } = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);

  let userId;
  if (existing[0]) {
    userId = existing[0].id;
    await client.query(
      `UPDATE users
          SET password_hash = $1, role = $2, org_id = $3, first_name = $4, last_name = $5,
              is_active = TRUE, email_verified_at = COALESCE(email_verified_at, NOW()),
              updated_at = NOW()
        WHERE id = $6`,
      [hash, role, orgId, firstName, lastName, userId]
    );
    console.log(`Updated existing user ${email}`);
  } else {
    const { rows: [u] } = await client.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name, org_id, email_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       RETURNING id`,
      [email, hash, role, firstName, lastName, orgId]
    );
    userId = u.id;
    console.log(`Created user ${email}`);
  }

  const { rows: props } = await client.query(
    `SELECT id, name FROM properties WHERE org_id = $1`,
    [orgId]
  );
  for (const p of props) {
    await client.query(
      `INSERT INTO property_assignments (property_id, user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [p.id, userId]
    );
  }

  console.log(`\nOrg:      ${orgName}`);
  console.log(`Role:     ${role}`);
  console.log(`Name:     ${firstName} ${lastName}`);
  console.log(`Email:    ${email}`);
  console.log(`Password: ${password}`);
  console.log(`Portal:   ${role === 'owner' ? '/admin (Owner Console)' : '/manager (Operations)'}`);
  console.log(`Properties assigned: ${props.map((p) => p.name).join(', ') || '(none)'}\n`);

  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
