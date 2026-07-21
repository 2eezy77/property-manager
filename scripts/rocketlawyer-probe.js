/**
 * Dry-run Rocket Lawyer integration health (auth + templates + optional Events subscription).
 * Usage: npm run rocketlawyer:probe
 */
require('../src/config/env');
const {
  checkConnection,
  listTemplates,
  ensureEventsSubscription,
  pullAndProcessEvents,
} = require('../src/services/rocketlawyer.service');

async function main() {
  console.log('Rocket Lawyer probe');
  console.log('RL_BASE_URL:', process.env.RL_BASE_URL || '(default sandbox)');
  console.log('RL_LEASE_TEMPLATE_ID:', process.env.RL_LEASE_TEMPLATE_ID ? '(set)' : 'MISSING');
  console.log('RL_WEBHOOK_URL:', process.env.RL_WEBHOOK_URL || '(not set — Events polling disabled)');
  console.log('RL_EVENTS_SUBSCRIPTION_ID:', process.env.RL_EVENTS_SUBSCRIPTION_ID || '(not set)');
  console.log('');

  const status = await checkConnection();
  console.log('── Status ──');
  console.log(JSON.stringify(status, null, 2));
  console.log('');

  if (status.auth !== 'ok') {
    console.log('Auth failed — fix credentials or wait for app approval before probing APIs.');
    return;
  }

  try {
    const templates = await listTemplates({ pageSize: 5 });
    console.log(`── Templates (first ${templates.length}) ──`);
    for (const t of templates.slice(0, 5)) {
      console.log(`  ${t.templateId}  ${t.templateName}`);
    }
    if (!templates.length) console.log('  (empty list — RocketDocument may still be pending)');
  } catch (err) {
    console.log('[fail] listTemplates', err.message);
  }

  if (process.env.RL_WEBHOOK_URL) {
    console.log('');
    try {
      const sub = await ensureEventsSubscription();
      console.log('── Events subscription ──');
      console.log(JSON.stringify(sub, null, 2));
      if (sub.subscriptionId && !process.env.RL_EVENTS_SUBSCRIPTION_ID) {
        console.log(`\nAdd to .env.local: RL_EVENTS_SUBSCRIPTION_ID=${sub.subscriptionId}`);
      }
      const pull = await pullAndProcessEvents({ maxEvents: 5 });
      console.log('── Event pull ──');
      console.log(JSON.stringify(pull, null, 2));
    } catch (err) {
      console.log('[fail] events', err.message);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
