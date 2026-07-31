/**
 * Load env files in the same order as Vite/Next:
 *   .env          — defaults
 *   .env.local    — local overrides (gitignored, your real secrets)
 *
 * Host-provided env (Railway, CI, `railway run`) always wins over files so
 * production keeps Supabase DATABASE_URL instead of a local .env.local.
 */
const path = require('path');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '../..');

/** Snapshot process env before dotenv so we can restore host values. */
const hostEnv = { ...process.env };

dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local'), override: true });

for (const [key, value] of Object.entries(hostEnv)) {
  if (value !== undefined) process.env[key] = value;
}
