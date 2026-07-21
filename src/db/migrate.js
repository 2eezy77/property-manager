/**
 * migrate.js
 * Reads schema.sql and executes it against the database in DATABASE_URL.
 * Safe to re-run — all CREATE statements use IF NOT EXISTS where possible,
 * and enum/type creation is guarded by a DO block that checks pg_type first.
 *
 * Usage:  node src/db/migrate.js
 *         npm run db:migrate
 */

require('../config/env');
const fs   = require('fs');
const path = require('path');
const { Client } = require('pg');

const SCHEMA_PATH     = path.resolve(__dirname, '../../schema.sql');
const MIGRATIONS_DIR  = path.resolve(__dirname, 'migrations');

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error('❌  DATABASE_URL is not set. Copy .env.example → .env and fill it in.');
    process.exit(1);
  }

  console.log('🔌  Connecting to database…');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },   // required for Supabase
  });

  try {
    await client.connect();
    console.log('✅  Connected.\n');

    // 1. Base schema (skip on existing DB — schema.sql is not idempotent for enums)
    const { rows: existing } = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
      LIMIT 1
    `);
    if (existing.length) {
      console.log('ℹ️  Existing database — skipping schema.sql');
    } else {
      const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
      console.log('📄  Running schema.sql…');
      await client.query(sql);
    }

    // 2. Incremental migrations (sorted by filename, tracked in schema_migrations)
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    if (fs.existsSync(MIGRATIONS_DIR)) {
      const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();

      let { rows: appliedRows } = await client.query('SELECT filename FROM schema_migrations');
      let applied = new Set(appliedRows.map(r => r.filename));

      // Legacy DBs created before schema_migrations — assume 002–009 already applied
      if (applied.size === 0 && existing.length) {
        console.log('ℹ️  Bootstrapping schema_migrations for existing database…');
        for (const file of files) {
          if (file >= '010_') {
            const { rows: col } = await client.query(`
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'leases'
                AND column_name = 'autopay_enabled'
              LIMIT 1
            `);
            if (col.length) {
              await client.query(
                'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
                [file],
              );
            }
            break;
          }
          await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
            [file],
          );
        }
        ({ rows: appliedRows } = await client.query('SELECT filename FROM schema_migrations'));
        applied = new Set(appliedRows.map(r => r.filename));
      }

      for (const file of files) {
        if (applied.has(file)) {
          console.log(`⏭️  Skipping migration: ${file} (already applied)`);
          continue;
        }
        const migrationSql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        console.log(`📄  Running migration: ${file}…`);
        await client.query(migrationSql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file],
        );
      }
    }

    console.log('\n✅  Migration complete — all tables, indexes, and functions are ready.');
  } catch (err) {
    console.error('\n❌  Migration failed:', err.message);
    console.error('\nFull error:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
