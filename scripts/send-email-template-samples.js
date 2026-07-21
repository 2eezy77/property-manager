#!/usr/bin/env node
/**
 * Send one sample of each HTML email template to EMAIL_DEV_OVERRIDE (default: owner).
 * Does not touch notification dedupe tables — direct sendEmail only.
 *
 *   npm run send:email-previews
 *   npm run send:email-previews -- --dry-run
 */

process.env.EMAIL_DEV_OVERRIDE =
  process.env.EMAIL_DEV_OVERRIDE || 'josemontero2002@gmail.com';

require('../src/config/env');

const pool = require('../src/db/client');
const { sendEmail } = require('../src/services/email.service');
const { listTemplateKeys, renderTemplateEmail } = require('../src/services/email-templates');

const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = Number(process.env.EMAIL_PREVIEW_DELAY_MS) || 2500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const to = process.env.EMAIL_DEV_OVERRIDE;
  const keys = listTemplateKeys();

  console.log(`\nEmail template samples → ${to}`);
  console.log(`  Templates: ${keys.length}`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'SEND'}\n`);

  if (process.env.EMAIL_ENABLED === 'false') {
    console.error('EMAIL_ENABLED=false — set EMAIL_ENABLED=true in .env.local');
    process.exit(1);
  }

  const { rows: [gmail] } = await pool.query(
    `SELECT org_id, gmail_address FROM gmail_oauth_tokens ORDER BY updated_at DESC NULLS LAST LIMIT 1`
  );
  if (!gmail?.org_id) {
    console.error('Gmail not connected — Manager → Utilities → Connect Gmail');
    process.exit(1);
  }
  console.log(`  From org Gmail: ${gmail.gmail_address}\n`);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const rendered = renderTemplateEmail(key);
    if (!rendered) {
      console.log(`  ✗ ${key} — unknown`);
      failed++;
      continue;
    }

    const subject = `[Montero Preview ${i + 1}/${keys.length}] ${rendered.subject}`;

    if (DRY_RUN) {
      console.log(`  ○ ${key} — ${subject}`);
      continue;
    }

    try {
      const result = await sendEmail({
        orgId: gmail.org_id,
        to,
        subject,
        text: rendered.text,
        html: rendered.html,
      });
      if (result.sent) {
        sent++;
        console.log(`  ✓ ${key}`);
      } else {
        failed++;
        console.log(`  ✗ ${key} — ${result.skipped || 'not sent'}`);
      }
    } catch (err) {
      failed++;
      console.log(`  ✗ ${key} — ${err.message}`);
    }

    if (i < keys.length - 1) await sleep(DELAY_MS);
  }

  console.log(
    DRY_RUN
      ? `\nDry run complete. Re-run without --dry-run to send.\n`
      : `\nDone: ${sent} sent, ${failed} failed. Check ${to} (and spam).\n`
  );
  await pool.end();
  process.exit(failed && !DRY_RUN ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
