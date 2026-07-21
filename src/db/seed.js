/**
 * seed.js
 * Creates the initial owner user so you can log in for the first time.
 * Also seeds one owner organization, one property, and one unit as examples.
 *
 * Run AFTER migrate.js:
 *   node src/db/seed.js
 *   npm run db:seed
 *
 * What it does:
 *   1. Generates a secure random password
 *   2. Hashes it with bcrypt (12 rounds)
 *   3. Inserts the owner user (oversight)
 *   4. Creates a starter org, property, and unit
 *   5. Prints your login credentials to the terminal — SAVE THEM
 *
 * Safe to re-run: skips any records that already exist (checks by email / name).
 */

require('../config/env');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { Client } = require('pg');

// ── Config ────────────────────────────────────────────────────────────────────
const OWNER_EMAIL   = process.env.SEED_OWNER_EMAIL ?? 'josemontero2002@gmail.com';
const OWNER_FIRST   = process.env.SEED_OWNER_FIRST ?? 'Owner';
const OWNER_LAST    = process.env.SEED_OWNER_LAST ?? 'User';
const BCRYPT_ROUNDS = 12;

// ── Helpers ───────────────────────────────────────────────────────────────────
function generatePassword(len = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from(crypto.randomBytes(len))
    .map((b) => chars[b % chars.length])
    .join('');
}

function box(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const bar   = '─'.repeat(width);
  console.log(`\n┌${bar}┐`);
  lines.forEach((l) => console.log(`│  ${l.padEnd(width - 2)}│`));
  console.log(`└${bar}┘\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error('❌  DATABASE_URL is not set. Copy .env.example → .env first.');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅  Connected to database.\n');

    // ── 1. Owner user (oversight) ──────────────────────────────────────────────
    const { rows: existing } = await client.query(
      'SELECT id FROM users WHERE email = $1', [OWNER_EMAIL]
    );

    let ownerId;
    let generatedPassword;

    if (existing.length > 0) {
      ownerId = existing[0].id;
      console.log(`ℹ️   Owner user already exists (${OWNER_EMAIL}) — skipping user creation.`);
      console.log('    If you need to reset the password, run: npm run db:reset-password\n');
    } else {
      generatedPassword = generatePassword();
      const hash = await bcrypt.hash(generatedPassword, BCRYPT_ROUNDS);

      const { rows: [owner] } = await client.query(
        `INSERT INTO users
           (email, password_hash, role, first_name, last_name, email_verified_at)
         VALUES ($1, $2, 'owner', $3, $4, NOW())
         RETURNING id`,
        [OWNER_EMAIL, hash, OWNER_FIRST, OWNER_LAST]
      );
      ownerId = owner.id;
      console.log('✅  Owner user created.');
    }

    // ── 2. Starter organization ────────────────────────────────────────────────
    const { rows: existingOrg } = await client.query(
      "SELECT id FROM organizations WHERE name = 'My Properties LLC'", []
    );

    let orgId;
    if (existingOrg.length > 0) {
      orgId = existingOrg[0].id;
      console.log('ℹ️   Starter organization already exists — skipping.');
    } else {
      const { rows: [org] } = await client.query(
        `INSERT INTO organizations (name, owner_id, subscription_tier)
         VALUES ('My Properties LLC', $1, 'pro')
         RETURNING id`,
        [ownerId]
      );
      orgId = org.id;
      console.log('✅  Starter organization created: My Properties LLC');
    }

    await client.query(
      `UPDATE users SET org_id = $1 WHERE id = $2 AND org_id IS NULL`,
      [orgId, ownerId]
    );

    // ── 3. Starter property ────────────────────────────────────────────────────
    const { rows: existingProp } = await client.query(
      'SELECT id FROM properties WHERE org_id = $1 LIMIT 1', [orgId]
    );

    let propertyId;
    if (existingProp.length > 0) {
      propertyId = existingProp[0].id;
      console.log('ℹ️   Starter property already exists — skipping.');
    } else {
      const { rows: [prop] } = await client.query(
        `INSERT INTO properties
           (org_id, name, address_line1, city, state, zip, country)
         VALUES ($1, '743 A Ave', '743 A Ave', 'Norfolk', 'VA', '23504', 'US')
         RETURNING id`,
        [orgId]
      );
      propertyId = prop.id;
      console.log('✅  Starter property created: 743 A Ave, Norfolk VA');
    }

    // ── 4. Starter unit ────────────────────────────────────────────────────────
    const { rows: existingUnit } = await client.query(
      "SELECT id FROM units WHERE property_id = $1 AND unit_number = '1A'", [propertyId]
    );

    if (existingUnit.length > 0) {
      console.log('ℹ️   Starter unit already exists — skipping.');
    } else {
      await client.query(
        `INSERT INTO units (property_id, unit_number, bedrooms, bathrooms, square_feet)
         VALUES ($1, '1A', 2, 1, 850)`,
        [propertyId]
      );
      console.log('✅  Starter unit created: Unit 1A (2bed/1bath, 850 sqft)');
    }

    if (generatedPassword) {
      box([
        '🎉  SETUP COMPLETE — YOUR LOGIN CREDENTIALS',
        '',
        `   URL:       http://localhost:5173`,
        `   Email:     ${OWNER_EMAIL}`,
        `   Password:  ${generatedPassword}`,
        '',
        '   ⚠️  Save this password now — it will not be shown again.',
        '   Add a property manager via bootstrap-743 or the Owner → Users panel.',
      ]);
    } else {
      console.log('\n✅  Seed complete. Database is ready.');
    }

  } catch (err) {
    console.error('\n❌  Seed failed:', err.message);
    if (err.message.includes('relation') && err.message.includes('does not exist')) {
      console.error('\n💡  Hint: Run migrations first:  npm run db:migrate');
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
