#!/usr/bin/env node
/**
 * Send portal launch campaign (owner, manager, 3 tenants). BCC = Gmail sender.
 *
 *   npm run portal-launch:send:dry
 *   npm run portal-launch:send
 */
require('../src/config/env');
const pool = require('../src/db/client');
const { buildCampaignMessages, sendCampaign } = require('../src/services/portal-launch-campaign.service');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const { messages } = await buildCampaignMessages();
  console.log(`\nPortal launch — ${messages.length} message(s)`);
  for (const m of messages) {
    console.log(`  • ${m.label} → ${m.to}`);
    console.log(`    ${m.subject}`);
  }

  if (process.env.EMAIL_ENABLED === 'false') {
    console.error('\nEMAIL_ENABLED=false');
    process.exit(1);
  }

  const result = await sendCampaign({ dryRun: DRY_RUN });
  console.log(DRY_RUN ? '\nDry run:' : '\nResult:', JSON.stringify(result, null, 2));
  await pool.end();
  process.exit(result.failed && !DRY_RUN ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
