/**
 * Read-only migration status — applied vs pending (schema_migrations table).
 *
 * Usage:
 *   npm run db:migrate:status
 *   node scripts/db-migrate-status.js
 */

require('../src/config/env');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.resolve(__dirname, '../src/db/migrations');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    : [];

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const { rows: tableCheck } = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'schema_migrations'
      LIMIT 1
    `);

    let appliedMap = new Map();
    if (tableCheck.length) {
      const { rows } = await client.query(
        'SELECT filename, applied_at FROM schema_migrations ORDER BY filename',
      );
      appliedMap = new Map(rows.map((r) => [r.filename, r.applied_at]));
    } else {
      console.log('schema_migrations table not found — run npm run db:migrate first.\n');
    }

    const applied = [];
    const pending = [];

    for (const file of files) {
      if (appliedMap.has(file)) {
        applied.push({ file, appliedAt: appliedMap.get(file) });
      } else {
        pending.push(file);
      }
    }

    // Orphan rows in DB with no matching file
    const orphans = [...appliedMap.keys()].filter((f) => !files.includes(f));

    console.log('\nMigration status\n');
    console.log(`  Total files:  ${files.length}`);
    console.log(`  Applied:      ${applied.length}`);
    console.log(`  Pending:      ${pending.length}`);
    if (orphans.length) console.log(`  Orphan rows:  ${orphans.length}`);
    console.log('');

    if (applied.length) {
      console.log('Applied:');
      for (const { file, appliedAt } of applied) {
        const ts = appliedAt ? new Date(appliedAt).toISOString().slice(0, 19) : '?';
        console.log(`  ✓ ${file}  (${ts})`);
      }
      console.log('');
    }

    if (pending.length) {
      console.log('Pending:');
      for (const file of pending) {
        console.log(`  ○ ${file}`);
      }
      console.log('');
    }

    if (orphans.length) {
      console.log('In DB but no file:');
      for (const file of orphans) {
        console.log(`  ? ${file}`);
      }
      console.log('');
    }

    process.exit(pending.length ? 1 : 0);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
