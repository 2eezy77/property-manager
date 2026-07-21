/**
 * Outbound email — Gmail API (org OAuth) with optional Resend fallback.
 *
 * Env:
 *   EMAIL_ENABLED=false          — disable all sends (log only)
 *   EMAIL_DEV_OVERRIDE=addr@…     — route every recipient here (dev/testing)
 *   RESEND_API_KEY                — optional fallback if Gmail send fails
 *   EMAIL_FROM                    — required for Resend (e.g. "743 A Ave <onboarding@resend.dev>")
 */

const crypto = require('crypto');
const { google } = require('googleapis');
const pool = require('../db/client');
const { createOAuthClient, getStoredRefreshToken } = require('./gmail.service');
const { sanitizeEmailSubject } = require('../utils/email-subject');

function isEnabled() {
  return process.env.EMAIL_ENABLED !== 'false';
}

function resolveRecipients(recipients, { allowOverride = true } = {}) {
  const list = (Array.isArray(recipients) ? recipients : [recipients])
    .filter(Boolean)
    .map(r => (typeof r === 'string' ? r : r.email))
    .filter(Boolean);

  const override = process.env.EMAIL_DEV_OVERRIDE?.trim();
  if (override && allowOverride) return [override];

  return [...new Set(list)];
}

function buildMimeMessage({ from, to, cc, bcc, subject, text, html }) {
  const boundary = `pm_${crypto.randomBytes(8).toString('hex')}`;
  const toHeader = Array.isArray(to) ? to.join(', ') : to;
  const ccList = cc ? (Array.isArray(cc) ? cc : [cc]).filter(Boolean) : [];
  const bccList = bcc ? (Array.isArray(bcc) ? bcc : [bcc]).filter(Boolean) : [];
  const lines = [
    `From: ${from}`,
    `To: ${toHeader}`,
    ...(ccList.length ? [`Cc: ${ccList.join(', ')}`] : []),
    ...(bccList.length ? [`Bcc: ${bccList.join(', ')}`] : []),
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    text || '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    html || text || '',
    `--${boundary}--`,
  ];
  return lines.join('\r\n');
}

async function sendViaGmail(orgId, { to, cc, bcc, subject, text, html }) {
  let stored = await getStoredRefreshToken(orgId);
  let effectiveOrgId = orgId;

  if (!stored?.refreshToken) {
    const { rows } = await pool.query(
      `SELECT org_id FROM gmail_oauth_tokens ORDER BY updated_at DESC NULLS LAST LIMIT 1`
    );
    if (rows[0]?.org_id && rows[0].org_id !== orgId) {
      stored = await getStoredRefreshToken(rows[0].org_id);
      effectiveOrgId = rows[0].org_id;
      if (stored?.refreshToken) {
        console.warn(`[email] no Gmail for org ${orgId}; using org ${effectiveOrgId}`);
      }
    }
  }

  if (!stored?.refreshToken) {
    const err = new Error('Gmail is not connected for this organization.');
    err.code = 'NOT_CONNECTED';
    throw err;
  }

  const from = stored.gmailAddress || process.env.GMAIL_ADDRESS;
  if (!from) {
    const err = new Error('Gmail sender address is unknown. Reconnect Gmail in Utilities.');
    err.code = 'NO_FROM';
    throw err;
  }

  const oauth2 = createOAuthClient({ refresh_token: stored.refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const raw = Buffer.from(buildMimeMessage({ from, to, cc, bcc, subject, text, html }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const { data } = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return { provider: 'gmail', id: data.id, from };
}

async function sendViaResend({ to, cc, bcc, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    const err = new Error('Resend is not configured (RESEND_API_KEY + EMAIL_FROM).');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      ...(cc?.length ? { cc: Array.isArray(cc) ? cc : [cc] } : {}),
      ...(bcc?.length ? { bcc: Array.isArray(bcc) ? bcc : [bcc] } : {}),
      subject,
      text,
      html: html || undefined,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `Resend HTTP ${res.status}`);
    err.code = 'RESEND_ERROR';
    throw err;
  }

  return { provider: 'resend', id: body.id, from };
}

/**
 * Send one email to one or more recipients.
 * @returns {{ sent: boolean, provider?: string, id?: string, skipped?: string }}
 */
async function sendEmail({ orgId, to, cc, bcc, subject, text, html }) {
  const recipients = resolveRecipients(to);
  const ccRecipients = cc ? resolveRecipients(cc).filter((e) => !recipients.includes(e)) : [];
  const bccRecipients = bcc
    ? resolveRecipients(bcc, { allowOverride: false }).filter(
        (e) => !recipients.includes(e) && !ccRecipients.includes(e)
      )
    : [];
  if (!recipients.length) {
    return { sent: false, skipped: 'no_recipients' };
  }

  if (!isEnabled()) {
    const extra = [
      ccRecipients.length ? `cc: ${ccRecipients.join(', ')}` : '',
      bccRecipients.length ? `bcc: ${bccRecipients.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    const note = extra ? ` (${extra})` : '';
    console.log(`[email] disabled — would send "${subject}" to ${recipients.join(', ')}${note}`);
    return { sent: false, skipped: 'disabled' };
  }

  const safeSubject = sanitizeEmailSubject(subject);
  const payload = {
    to: recipients,
    cc: ccRecipients.length ? ccRecipients : undefined,
    bcc: bccRecipients.length ? bccRecipients : undefined,
    subject: safeSubject,
    text,
    html,
  };

  if (orgId) {
    try {
      const result = await sendViaGmail(orgId, payload);
      console.log(`[email] sent via Gmail to ${recipients.join(', ')} — ${subject}`);
      return { sent: true, ...result };
    } catch (err) {
      console.warn(`[email] Gmail send failed: ${err.message}`);
      if (process.env.RESEND_API_KEY) {
        const result = await sendViaResend(payload);
        console.log(`[email] sent via Resend to ${recipients.join(', ')} — ${subject}`);
        return { sent: true, ...result };
      }
      throw err;
    }
  }

  const result = await sendViaResend(payload);
  console.log(`[email] sent via Resend to ${recipients.join(', ')} — ${subject}`);
  return { sent: true, ...result };
}

async function resolveOrgIdForLease(db, leaseId) {
  const { rows } = await db.query(
    `SELECT p.org_id
       FROM leases l
       JOIN units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id
      WHERE l.id = $1`,
    [leaseId]
  );
  return rows[0]?.org_id || null;
}

/** Property manager = primary ops; owner = oversight (CC when managers exist). */
async function getOperationalStaff(db, orgId) {
  if (!orgId) return { managers: [], owners: [], all: [] };
  const { rows } = await db.query(
    `SELECT id, email, first_name, role
       FROM users
      WHERE org_id = $1
        AND is_active = TRUE
        AND role IN ('owner', 'property_manager')
        AND email IS NOT NULL`,
    [orgId]
  );
  const managers = rows.filter((r) => r.role === 'property_manager');
  const owners = rows.filter((r) => r.role === 'owner');
  return { managers, owners, all: rows };
}

async function getStaffEmails(db, orgId) {
  const { all } = await getOperationalStaff(db, orgId);
  return all;
}

/**
 * Operational alerts: To property manager(s); Cc owner(s) for oversight.
 * If no manager on file, owners receive To only.
 */
async function sendOperationalStaffEmail(db, { orgId, subject, text, html }) {
  const { managers, owners, all } = await getOperationalStaff(db, orgId);
  if (!all.length) return { sent: false, skipped: 'no_staff' };

  const to = managers.length ? managers.map((s) => s.email) : owners.map((s) => s.email);
  const cc = managers.length ? owners.map((s) => s.email) : [];

  return sendEmail({ orgId, to, cc: cc.length ? cc : undefined, subject, text, html });
}

/**
 * Owner-action alerts (e.g. approve site visit): To owner(s); Cc manager(s).
 */
async function sendOwnerActionEmail(db, { orgId, subject, text, html }) {
  const { managers, owners, all } = await getOperationalStaff(db, orgId);
  if (!all.length) return { sent: false, skipped: 'no_staff' };

  const to = owners.length ? owners.map((s) => s.email) : managers.map((s) => s.email);
  const cc = owners.length ? managers.map((s) => s.email) : [];

  return sendEmail({ orgId, to, cc: cc.length ? cc : undefined, subject, text, html });
}

module.exports = {
  sendEmail,
  resolveRecipients,
  resolveOrgIdForLease,
  getOperationalStaff,
  getStaffEmails,
  sendOperationalStaffEmail,
  sendOwnerActionEmail,
  isEnabled,
};
