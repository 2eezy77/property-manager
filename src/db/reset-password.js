/**
 * reset-password.js
 * Lists login-worthy users and/or resets a user's password.
 *
 * Usage:
 *   npm run db:reset-password                       (resets owner — josemontero2002@gmail.com)
 *   node src/db/reset-password.js list              (lists all staff + 743 A Ave tenants)
 *   node src/db/reset-password.js list-all          (lists every user)
 *   node src/db/reset-password.js <email>           (reset that email's password)
 *   node src/db/reset-password.js <email> <plain>   (reset to a specific plaintext password)
 *   node src/db/reset-password.js bootstrap-743     (creates owner + property_manager
 *                                                    for 743 A Ave and resets every
 *                                                    relevant account; prints a
 *                                                    credentials table)
 */

require('../config/env');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { Client } = require('pg');
const {
  assertPasswordResetAllowed,
  assertBootstrapAllowed,
} = require('../utils/db-password-guard');

function generatePassword(len = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from(crypto.randomBytes(len))
    .map((b) => chars[b % chars.length])
    .join('');
}

async function listUsers(client, mode) {
  if (mode === 'list-all') {
    const { rows } = await client.query(
      `SELECT email, first_name, last_name, role
         FROM users
        ORDER BY role, last_name, first_name`
    );
    console.log('\nAll users:');
    rows.forEach(u => console.log(`  [${u.role.padEnd(16)}] ${u.first_name ?? ''} ${u.last_name ?? ''}  <${u.email}>`));
    return;
  }
  const { rows: staff } = await client.query(
    `SELECT email, first_name, last_name, role
       FROM users
      WHERE role IN ('super_admin','owner','property_manager')
      ORDER BY role, last_name`
  );
  const { rows: tenants } = await client.query(
    `SELECT u.email, u.first_name, u.last_name, un.unit_number, l.monthly_rent
       FROM users u
       JOIN leases     l  ON l.tenant_id = u.id
       JOIN units      un ON un.id = l.unit_id
       JOIN properties p  ON p.id  = un.property_id
      WHERE p.address_line1 ILIKE '%743 A%'
        AND l.status = 'active'
      ORDER BY un.unit_number, u.last_name`
  );

  console.log('\nStaff (owner / property manager):');
  staff.forEach(u => console.log(`  [${u.role.padEnd(16)}] ${u.first_name ?? ''} ${u.last_name ?? ''}  <${u.email}>`));

  console.log('\nActive tenants at 743 A Ave:');
  tenants.forEach(t => console.log(`  Unit ${t.unit_number}: ${t.first_name} ${t.last_name}  <${t.email}>  ($${t.monthly_rent}/mo)`));
}

async function resetOne(client, email, explicitPassword) {
  const newPassword = explicitPassword || generatePassword();
  const hash = await bcrypt.hash(newPassword, 12);
  const { rowCount } = await client.query(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2`,
    [hash, email]
  );
  if (rowCount === 0) {
    console.error(`  No user found with email: ${email}`);
    return null;
  }
  return newPassword;
}

async function bootstrap743(client) {
  // Find the property + org for 743 A Ave
  const { rows: propRows } = await client.query(
    `SELECT p.id AS property_id, p.org_id, o.name AS org_name
       FROM properties p
       JOIN organizations o ON o.id = p.org_id
      WHERE p.address_line1 ILIKE '%743 A%'
      LIMIT 1`
  );
  if (!propRows[0]) {
    console.error('No property found matching "743 A Ave". Run the property seeder first.');
    process.exit(1);
  }
  const { property_id, org_id, org_name } = propRows[0];

  // Helper: upsert a user, return id
  async function upsertUser({ email, firstName, lastName, role, orgId }) {
    const { rows: existing } = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existing[0]) {
      await client.query(`UPDATE users SET role = $1, org_id = $2, first_name = $3, last_name = $4, is_active = TRUE WHERE id = $5`,
        [role, orgId, firstName, lastName, existing[0].id]);
      return existing[0].id;
    }
    const tempHash = await bcrypt.hash('placeholder', 12);
    const { rows: [u] } = await client.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name, org_id, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id`,
      [email, tempHash, role, firstName, lastName, orgId]
    );
    return u.id;
  }

  // Owner (Jose — sole owner login)
  const OWNER_EMAIL = 'josemontero2002@gmail.com';
  const ownerId = await upsertUser({
    email: OWNER_EMAIL, firstName: 'Jose', lastName: 'Montero',
    role: 'owner', orgId: org_id,
  });

  // Property manager (Konstantin)
  const KP_EMAIL = 'konstantinhazlett@yahoo.com';
  const kpId = await upsertUser({
    email: KP_EMAIL, firstName: 'Konstantin', lastName: 'Patchell Hazlett',
    role: 'property_manager', orgId: org_id,
  });

  // Make sure Konstantin is assigned to the property (needed by the working
  // accessiblePropertyIds path for property_manager role).
  await client.query(
    `INSERT INTO property_assignments (property_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [property_id, kpId]
  );
  // Isaac as well, belt-and-suspenders (so he sees the property even if
  // the org_id query path errors out anywhere).
  await client.query(
    `INSERT INTO property_assignments (property_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [property_id, ownerId]
  );

  await client.query(`UPDATE organizations SET owner_id = $1 WHERE id = $2`, [ownerId, org_id]);

  // Remove legacy dev super_admin account if present
  await client.query(`DELETE FROM users WHERE email = 'admin@propertymanager.local'`);

  // Pick a memorable shared password for the demo accounts so the user can
  // easily switch between roles. (User can rotate any one via this same script.)
  const sharedPw = 'PropMgr!' + Math.random().toString(36).slice(2, 8);

  // Reset / set passwords on every login-worthy account
  const accounts = [
    { label: 'Owner (oversight)',   email: OWNER_EMAIL                            },
    { label: 'Property Manager',    email: KP_EMAIL                               },
    { label: 'Tenant — Davontaye',  email: 'davontayegara95@gmail.com'         },
    { label: 'Tenant — Buckley',    email: 'buckleystone1@gmail.com'          },
    { label: 'Tenant — Isaiah',     email: 'isaiahreese13@outlook.com'        },
  ];
  for (const a of accounts) {
    await resetOne(client, a.email, sharedPw);
  }

  // Pretty print credentials table
  console.log(`\nOrg:      ${org_name}`);
  console.log(`Property: 743 A Ave, Norfolk VA`);
  console.log(`URL:      http://localhost:5173\n`);
  console.log('Role               Email                                          Password');
  console.log('─'.repeat(92));
  for (const a of accounts) {
    console.log(`${a.label.padEnd(18)} ${a.email.padEnd(47)} ${sharedPw}`);
  }
  console.log('\nAll accounts share the same password above for easy switching during testing.');
  console.log('Rotate any single one with:  node src/db/reset-password.js <email>\n');
}

async function main() {
  const args = process.argv.slice(2);
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    if (args[0] === 'list' || args[0] === 'list-all') {
      await listUsers(client, args[0]);
      return;
    }
    if (args[0] === 'bootstrap-743') {
      assertBootstrapAllowed(args);
      await bootstrap743(client);
      return;
    }

    const email          = args[0] ?? process.env.SEED_OWNER_EMAIL ?? 'josemontero2002@gmail.com';
    const explicitPassword = args[1];

    assertPasswordResetAllowed({ targetEmail: email, argv: args });

    const password = await resetOne(client, email, explicitPassword);
    if (!password) {
      console.error('    Run npm run db:seed to create the user first, or check the email.');
      process.exit(1);
    }

    const width = 60;
    const bar = '─'.repeat(width);
    console.log(`\n┌${bar}┐`);
    console.log(`│  PASSWORD RESET${' '.repeat(width - 16)}│`);
    console.log(`│${''.padEnd(width)}│`);
    console.log(`│  Email:    ${email.padEnd(width - 12)}│`);
    console.log(`│  Password: ${password.padEnd(width - 12)}│`);
    console.log(`│${''.padEnd(width)}│`);
    console.log(`│  Save this — it will not be shown again.${' '.repeat(width - 41)}│`);
    console.log(`└${bar}┘\n`);
  } finally {
    await client.end();
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
