/**
 * Load env files in the same order as Vite/Next:
 *   .env          — defaults
 *   .env.local    — local overrides (gitignored, your real secrets)
 */
const path = require('path');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local'), override: true });
