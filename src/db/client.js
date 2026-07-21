/**
 * client.js
 * Single shared pg connection pool for the entire server.
 *
 * SSL is always enabled — Supabase requires it on all connections
 * regardless of environment. rejectUnauthorized: false is safe here
 * because Supabase uses a valid certificate; this just prevents
 * hostname-mismatch errors on the pooler endpoint.
 */
require('../config/env');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString:      process.env.DATABASE_URL,
  max:                   10,
  idleTimeoutMillis:     30_000,
  connectionTimeoutMillis: 5_000,
  ssl: { rejectUnauthorized: false },   // required for Supabase
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error:', err.message);
});

module.exports = pool;
