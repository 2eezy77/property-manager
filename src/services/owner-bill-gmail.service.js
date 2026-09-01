/**
 * Pull owner-bill payment confirmations from org Gmail and check off
 * the Owner Finance checklist. Not tenant rent. Not Stripe. Does not charge.
 */

const pool = require('../db/client');
const { getGmailClient, getMessage, resolveOrgId } = require('./gmail.service');
const { listChecklist, updateChecklistItem } = require('./owner-checklist.service');
const {
  parseOwnerBillEmail,
  decideOwnerBillApply,
  appendConfirmationNote,
  buildExistingKeys,
} = require('./owner-bill-gmail-parser.service');

const OWNER_BILL_QUERY = [
  '-from:cash@square.com',
  '-from:stripe.com',
  '(',
  'from:newrez OR from:shellpoint',
  'OR from:vivint',
  'OR from:t-mobile.com OR from:tmobile.com',
  'OR from:dominionenergy.com OR from:domenergyvanccc.com OR from:domenergyvanc.com',
  'OR from:hrsd.com OR from:invoicecloud.net OR from:norfolk.gov',
  ')',
  '(',
  'subject:"thank you for your payment"',
  'OR subject:"payment confirmation"',
  'OR subject:"payment received"',
  'OR subject:"payment posted"',
  'OR subject:"we received your payment"',
  'OR "confirmation number"',
  ')',
].join(' ');

async function listOwnerBillMessages(gmail, { newerThanDays = 120, maxMessages = 200 } = {}) {
  const q = `${OWNER_BILL_QUERY} newer_than:${newerThanDays}d`;
  const out = [];
  let pageToken;

  do {
    const list = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: Math.min(100, maxMessages - out.length),
      pageToken,
    });
    out.push(...(list.data.messages || []));
    pageToken = list.data.nextPageToken;
  } while (pageToken && out.length < maxMessages);

  return out;
}

async function resolveOwnerIds(orgId) {
  if (!orgId) return [];
  const { rows } = await pool.query(
    `SELECT id FROM users
      WHERE org_id = $1
        AND role = 'owner'
        AND is_active = TRUE
        AND site_archived_at IS NULL
      ORDER BY created_at ASC`,
    [orgId]
  );
  return rows.map((r) => r.id);
}

async function loadExistingKeys(ownerId) {
  const { rows } = await pool.query(
    `SELECT gmail_message_id, confirmation, category
       FROM owner_bill_gmail_imports
      WHERE owner_id = $1`,
    [ownerId]
  );
  return buildExistingKeys(rows);
}

async function recordImport(ownerId, parsed, message, decision) {
  await pool.query(
    `INSERT INTO owner_bill_gmail_imports (
       owner_id, category, gmail_message_id, confirmation,
       posted_at, applied_last_paid_at, applied_verified,
       subject, from_address, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT (owner_id, gmail_message_id) DO NOTHING`,
    [
      ownerId,
      parsed.category,
      parsed.gmailMessageId,
      parsed.confirmation || null,
      parsed.postedAt || null,
      decision.patch.last_paid_at || null,
      Boolean(decision.patch.last_verified_at || decision.patch.last_paid_at),
      message.subject || parsed.subject || null,
      message.from || parsed.from || null,
      JSON.stringify({
        confirmation: parsed.confirmation || null,
        postedOn: parsed.postedOn || null,
        amount: Number.isFinite(parsed.amount) ? parsed.amount : null,
      }),
    ]
  );
}

async function applyToOwner(ownerId, parsed, message) {
  const items = await listChecklist(ownerId);
  const item = items.find((row) => row.category === parsed.category);
  if (!item) {
    return { action: 'skip', reason: 'no_checklist_item' };
  }

  const keys = await loadExistingKeys(ownerId);
  const decision = decideOwnerBillApply({
    parsed,
    item,
    existingByGmailId: keys.existingByGmailId,
    existingByConfirmation: keys.existingByConfirmation,
  });

  if (decision.action !== 'apply') return decision;

  const patch = { ...decision.patch };
  const nextNotes = appendConfirmationNote(item.notes, parsed);
  if (nextNotes !== (item.notes || '')) {
    patch.notes = nextNotes;
  }

  if (Object.keys(patch).length) {
    await updateChecklistItem(ownerId, item.id, patch);
  }

  try {
    await recordImport(ownerId, parsed, message, decision);
  } catch (err) {
    if (err.code === '23505') {
      return { action: 'skip', reason: 'duplicate_confirmation' };
    }
    throw err;
  }
  return { action: 'apply', itemId: item.id, category: parsed.category, patch };
}

async function syncOwnerBillsFromGmail(userId, role, {
  apply = true,
  newerThanDays = 120,
  maxMessages = 200,
} = {}) {
  const gmail = await getGmailClient(userId, role);
  const orgId = await resolveOrgId(userId, role);
  const ownerIds = await resolveOwnerIds(orgId);

  const refs = await listOwnerBillMessages(gmail, { newerThanDays, maxMessages });
  const results = {
    scanned: refs.length,
    applied: [],
    skipped: [],
    errors: [],
    ownerIds,
    orgId,
  };

  for (const ref of refs) {
    let message;
    try {
      message = await getMessage(gmail, ref.id);
    } catch (err) {
      results.errors.push({ id: ref.id, error: err.message });
      continue;
    }

    const parsed = parseOwnerBillEmail(message);
    if (!parsed || parsed.kind !== 'paid_confirmation') {
      const reason = parsed?.skipReason || parsed?.kind || 'ambiguous';
      console.log(
        `[owner-bill-gmail] skip ${ref.id} ${JSON.stringify(message.subject || '')}: ${reason}`
      );
      results.skipped.push({
        id: ref.id,
        subject: message.subject,
        reason,
      });
      continue;
    }

    if (!apply) {
      results.applied.push({
        id: ref.id,
        category: parsed.category,
        confirmation: parsed.confirmation,
        postedOn: parsed.postedOn,
        dryRun: true,
      });
      continue;
    }

    if (!ownerIds.length) {
      results.skipped.push({ id: ref.id, reason: 'no_owner' });
      continue;
    }

    for (const ownerId of ownerIds) {
      try {
        const outcome = await applyToOwner(ownerId, parsed, message);
        if (outcome.action === 'apply') {
          results.applied.push({
            ownerId,
            id: ref.id,
            category: parsed.category,
            confirmation: parsed.confirmation,
            itemId: outcome.itemId,
          });
        } else {
          results.skipped.push({
            ownerId,
            id: ref.id,
            category: parsed.category,
            reason: outcome.reason,
          });
        }
      } catch (err) {
        results.errors.push({
          ownerId,
          id: ref.id,
          error: err.message,
        });
      }
    }
  }

  return results;
}

module.exports = {
  listOwnerBillMessages,
  syncOwnerBillsFromGmail,
  applyToOwner,
  OWNER_BILL_QUERY,
};
