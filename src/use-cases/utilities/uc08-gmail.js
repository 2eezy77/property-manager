/** UC08 + UC09 — Org Gmail connection and e-bill import. */

const pool = require('../../db/client');
const gmailService = require('../../services/gmail.service');
const { parseUtilityEmail } = require('../../services/utility-email-parser.service');
const { loadAccessibleProperties } = require('./access');
const { loadActiveLeases, matchProperty } = require('./domain');
const { upsertMonthlyDraft } = require('./monthly-billing');
const { executeCombineMonthlyDrafts } = require('./uc10-combine-monthly');
const { enforceLatestCollectible } = require('./enforce-latest-collectible');
const { useCaseError } = require('./errors');

async function executeGmailStatus({ userId, role }) {
  return gmailService.getConnectionStatus(userId, role);
}

async function executeGmailConnect({ userId, role }) {
  return gmailService.getAuthUrl(userId, role);
}

async function executeGmailCallback({ code, state }) {
  return gmailService.handleOAuthCallback(code, state);
}

async function executeImportFromGmail({ userId, role, maxMessages = 15 }) {
  const properties = await loadAccessibleProperties(userId, role);
  if (!properties.length) {
    throw useCaseError('NO_PROPERTIES', 'No accessible properties to assign imported bills.');
  }

  const gmail = await gmailService.getGmailClient(userId, role);
  const messages = await gmailService.listUtilityMessages(gmail, { maxResults: maxMessages });

  const results = { scanned: messages.length, created: [], skipped: [], errors: [] };

  for (const ref of messages) {
    try {
      const { rows: existing } = await pool.query(
        `SELECT id FROM utility_bills WHERE gmail_message_id = $1 LIMIT 1`,
        [ref.id]
      );
      if (existing[0]) {
        results.skipped.push({ message_id: ref.id, reason: 'Already imported' });
        continue;
      }

      const message = await gmailService.getMessage(gmail, ref.id);
      const parsed = parseUtilityEmail(message);
      if (!parsed.ok) {
        results.skipped.push({ message_id: ref.id, subject: message.subject, reason: parsed.reason });
        continue;
      }

      const property = matchProperty(properties, parsed);
      if (!property) {
        results.skipped.push({
          message_id: ref.id,
          subject: message.subject,
          reason: 'Could not match property — set account numbers on the property or use a single property',
        });
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const leases = await loadActiveLeases(
          client, property.id, parsed.period_start, parsed.period_end
        );
        if (!leases.length) {
          await client.query('ROLLBACK');
          results.skipped.push({
            message_id: ref.id,
            subject: message.subject,
            reason: 'No active leases overlap the bill period',
          });
          continue;
        }

        const { bill, merged } = await upsertMonthlyDraft(client, {
          propertyId: property.id,
          createdBy: userId,
          parsed,
          leases,
        });

        await client.query('COMMIT');
        const entry = {
          bill_id: bill.id,
          message_id: ref.id,
          property_id: property.id,
          property_name: property.name,
          service_type: parsed.service_type,
          total_amount: bill.total_amount,
          due_date: bill.due_date,
          subject: message.subject,
          merged,
        };
        if (merged) {
          results.merged = results.merged || [];
          results.merged.push(entry);
        } else {
          results.created.push(entry);
        }
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      results.errors.push({ message_id: ref.id, error: err.message });
    }
  }

  const monthly = await executeCombineMonthlyDrafts({ userId, role });
  results.monthly = monthly;

  const touchedIds = new Set(
    [...(results.created || []), ...(results.merged || [])].map((e) => e.property_id)
  );
  const policyClient = await pool.connect();
  try {
    const policy = { groups: 0, settled_older: 0, splits_waived: 0, latest_reopened: 0 };
    const targets = touchedIds.size
      ? [...touchedIds]
      : properties.map((p) => p.id);
    for (const pid of targets) {
      const s = await enforceLatestCollectible(policyClient, { propertyId: pid });
      policy.groups += s.groups;
      policy.settled_older += s.settled_older;
      policy.splits_waived += s.splits_waived;
      policy.latest_reopened += s.latest_reopened;
    }
    results.collectible_policy = policy;
  } finally {
    policyClient.release();
  }

  return results;
}

module.exports = {
  executeGmailStatus,
  executeGmailConnect,
  executeGmailCallback,
  executeImportFromGmail,
};
