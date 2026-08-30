#!/usr/bin/env node
/**
 * Poll org Gmail for a Dominion Energy email/SMS-fallback MFA verification code.
 *
 * Dominion does NOT support authenticator-app TOTP. Login MFA is email or SMS.
 * Prefer "Send code by email" during portal login, then run this script.
 *
 * Usage:
 *   railway run -s property-manager -e production -- node scripts/dominion/fetch-email-otp.js
 *   WAIT_SECONDS=120 NEWER_THAN_MINUTES=10 node scripts/dominion/fetch-email-otp.js
 *
 * Prints the 6-digit code to stdout when found.
 */
require('../../src/config/env');
const pool = require('../../src/db/client');
const { getGmailClient, getMessage } = require('../../src/services/gmail.service');
const { extractCode, looksLikeMfa } = require('../../src/utils/dominion-otp');

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'josemontero2002@gmail.com';
const WAIT_SECONDS = Number(process.env.WAIT_SECONDS || 90);
const POLL_MS = Number(process.env.POLL_MS || 5000);
const NEWER_THAN_MINUTES = Number(process.env.NEWER_THAN_MINUTES || 15);
const AFTER_EPOCH_MS = process.env.AFTER_EPOCH_MS
  ? Number(process.env.AFTER_EPOCH_MS)
  : Date.now() - NEWER_THAN_MINUTES * 60_000;

// Broad query — Dominion MFA mail can come from several corporate senders.
const GMAIL_QUERY = [
  '(from:dominionenergy.com OR from:dominionenergy OR subject:Dominion OR subject:"verification code" OR subject:"one-time" OR subject:OTP OR subject:"security code")',
  `newer_than:${Math.max(1, Math.ceil(NEWER_THAN_MINUTES / (60 * 24)) || 1)}d`,
].join(' ');

async function resolveOwner() {
  const { rows } = await pool.query(
    `SELECT id, role FROM users WHERE email = $1 LIMIT 1`,
    [OWNER_EMAIL]
  );
  if (!rows[0]) throw new Error(`Owner not found: ${OWNER_EMAIL}`);
  return rows[0];
}

async function scanOnce(gmail) {
  const list = await gmail.users.messages.list({
    userId: 'me',
    q: GMAIL_QUERY,
    maxResults: 15,
  });
  const refs = list.data.messages || [];
  const hits = [];

  for (const ref of refs) {
    const { data: raw } = await gmail.users.messages.get({
      userId: 'me',
      id: ref.id,
      format: 'full',
    });
    const internalDate = Number(raw.internalDate || 0);
    if (internalDate && internalDate < AFTER_EPOCH_MS) continue;

    const msg = await getMessage(gmail, ref.id);
    const blob = [msg.subject, msg.snippet, msg.body, msg.html].filter(Boolean).join('\n');
    const code = extractCode(blob);
    if (!code) continue;

    // Avoid matching ordinary Dominion bill emails that happen to contain 6-digit account fragments
    // unless the body looks like an MFA / verification message.
    if (!looksLikeMfa(blob)) continue;

    hits.push({
      id: msg.id,
      date: msg.date,
      subject: msg.subject,
      from: msg.from,
      code,
      internalDate: internalDate || Date.parse(msg.date) || 0,
    });
  }

  hits.sort((a, b) => (b.internalDate || 0) - (a.internalDate || 0));
  return hits[0] || null;
}

async function main() {
  const owner = await resolveOwner();
  const gmail = await getGmailClient(owner.id, owner.role);
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  console.error(`Polling Gmail for Dominion MFA (query newer than ${new Date(AFTER_EPOCH_MS).toISOString()}, wait ${WAIT_SECONDS}s)…`);

  while (Date.now() <= deadline) {
    const hit = await scanOnce(gmail);
    if (hit) {
      console.error(`Found code in: ${hit.subject || '(no subject)'} from ${hit.from || '?'}`);
      console.log(hit.code);
      await pool.end().catch(() => {});
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  console.error('No Dominion MFA code found in Gmail within the wait window.');
  console.error('If Dominion only offered SMS, switch to "email code" on the login screen, or complete MFA in the Desktop pane.');
  await pool.end().catch(() => {});
  process.exit(2);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
