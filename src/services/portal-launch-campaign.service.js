/**
 * Portal launch email campaign — load recipients from DB, render, send with BCC to sender.
 */

const pool = require('../db/client');
const { getStoredRefreshToken } = require('./gmail.service');
const { sendEmail } = require('./email.service');
const {
  DEFAULT_ELECTRIC,
  renderOwner,
  renderManager,
  renderTenant,
} = require('./email-templates/portalLaunch');
const {
  generatePassword,
  setPasswordHash,
} = require('./password-admin.service');

const PROPERTY_MATCH = '%743%';
/** Co-owner — launch email like primary owner (no password reset on send). */
const CO_OWNER_EMAIL = 'trevormcmanus.student@gmail.com';

async function loadElectricFromDb(client) {
  const { rows } = await client.query(
    `SELECT period_start::text, period_end::text,
            total_amount::float, tenant_charge_amount::float,
            statement_balance::float, chargeable_after::text
       FROM utility_bills
      WHERE service_type = 'electric'
        AND status = 'draft'
      ORDER BY period_end DESC
      LIMIT 1`
  );
  if (!rows[0]) return { ...DEFAULT_ELECTRIC };

  const bill = rows[0];
  const charge = bill.tenant_charge_amount ?? bill.total_amount;

  const { rows: splits } = await client.query(
    `SELECT u.email, u.first_name, s.amount::float
       FROM utility_bill_splits s
       JOIN users u ON u.id = s.tenant_id
       JOIN utility_bills ub ON ub.id = s.bill_id
      WHERE ub.service_type = 'electric' AND ub.status = 'draft'
      ORDER BY u.first_name NULLS LAST, u.email`
  );

  const tenantShares = splits.map((s) => ({
    email: s.email.toLowerCase(),
    firstName: s.first_name || s.email.split('@')[0],
    amount: s.amount,
  }));

  return {
    periodStart: bill.period_start,
    periodEnd: bill.period_end,
    currentCharges: charge,
    statementBalance: bill.statement_balance ?? DEFAULT_ELECTRIC.statementBalance,
    chargeableAfter: bill.chargeable_after || bill.period_end,
    tenantShares,
  };
}

async function buildCampaignMessages() {
  const client = await pool.connect();
  try {
    const electric = await loadElectricFromDb(client);

    const { rows: [propRow] } = await client.query(
      `SELECT org_id FROM properties WHERE name ILIKE $1 LIMIT 1`,
      [PROPERTY_MATCH]
    );
    const orgId = propRow?.org_id || (await resolveOrgId());

    let owners = orgId
      ? (await client.query(
        `SELECT id, email, first_name, last_name
           FROM users
          WHERE is_active = TRUE
            AND role = 'owner'
            AND org_id = $1
          ORDER BY first_name, last_name`,
        [orgId]
      )).rows
      : [];

    if (!owners.some((o) => o.email.toLowerCase() === CO_OWNER_EMAIL)) {
      const { rows: coOwner } = await client.query(
        `SELECT id, email, first_name, last_name
           FROM users
          WHERE is_active = TRUE
            AND role = 'owner'
            AND LOWER(email) = $1`,
        [CO_OWNER_EMAIL]
      );
      if (coOwner[0]) owners = [...owners, coOwner[0]];
    }

    const { rows: managers } = orgId
      ? await client.query(
        `SELECT id, email, first_name, last_name
           FROM users
          WHERE is_active = TRUE
            AND role = 'property_manager'
            AND org_id = $1
          ORDER BY first_name
          LIMIT 1`,
        [orgId]
      )
      : [];
    const manager = managers[0] ?? null;

    const { rows: tenants } = await client.query(
      `SELECT DISTINCT ON (u.id)
              u.id, u.email, u.first_name, u.last_name, un.unit_number, l.start_date::text
         FROM users u
         JOIN leases l ON l.tenant_id = u.id AND l.status = 'active'
         JOIN units un ON un.id = l.unit_id
         JOIN properties p ON p.id = un.property_id
        WHERE p.name ILIKE $1
          AND u.role = 'tenant'
          AND u.is_active = TRUE
        ORDER BY u.id, l.start_date DESC`,
      [PROPERTY_MATCH]
    );

    const messages = [];

    for (const owner of owners) {
      const name = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email;
      const slug = String(owner.email).split('@')[0].replace(/\W/g, '-').slice(0, 24);
      const { html, text, subject } = renderOwner({
        recipientName: name.split(' ')[0] || name,
        electric,
      });
      messages.push({
        id: `owner-${slug}`,
        userId: owner.id,
        label: `Owner — ${name.split(' ')[0] || name}`,
        role: 'owner',
        to: owner.email,
        recipientName: name,
        subject,
        html,
        text,
        includesPassword: false,
      });
    }

    if (manager) {
      const name = [manager.first_name, manager.last_name].filter(Boolean).join(' ') || 'Konstantin';
      const { html, text, subject } = renderManager({
        recipientName: name.split(' ')[0] || name,
        electric,
      });
      messages.push({
        id: 'manager',
        userId: manager.id,
        label: 'Manager',
        role: 'property_manager',
        to: manager.email,
        recipientName: name,
        subject,
        html,
        text,
        includesPassword: false,
      });
    }

    for (const t of tenants) {
      const first = t.first_name || 'there';
      const unitLabel = t.unit_number ? `Unit ${t.unit_number}` : '';
      const prorated = t.start_date && t.start_date >= '2026-06-01';
      const slug = String(t.email).split('@')[0].replace(/\W/g, '-').slice(0, 24);
      const { html, text, subject } = renderTenant({
        recipientName: first,
        unitLabel,
        electric,
        proratedElectric: prorated,
      });
      messages.push({
        id: `tenant-${slug}`,
        userId: t.id,
        label: `Tenant — ${first}`,
        role: 'tenant',
        to: t.email,
        recipientName: first,
        unitLabel,
        startDate: t.start_date,
        subject,
        html,
        text,
        includesPassword: false,
      });
    }

    return { messages, electric };
  } finally {
    client.release();
  }
}

async function resolveSenderBcc(orgId) {
  const stored = await getStoredRefreshToken(orgId);
  if (!stored?.gmailAddress) return null;
  return stored.gmailAddress;
}

async function resolveOrgId() {
  const { rows } = await pool.query(
    `SELECT org_id FROM gmail_oauth_tokens ORDER BY updated_at DESC NULLS LAST LIMIT 1`
  );
  return rows[0]?.org_id || null;
}

async function resolvePrimaryOwnerId(orgId) {
  if (!orgId) return null;
  const { rows } = await pool.query(
    `SELECT owner_id FROM organizations WHERE id = $1 LIMIT 1`,
    [orgId]
  );
  return rows[0]?.owner_id ?? null;
}

const PREVIEW_PASSWORD_PLACEHOLDER = '(unique — generated when you click Send all)';

function rerenderWithCredentials(message, electric, temporaryPassword) {
  const loginEmail = message.to;
  if (message.role === 'property_manager') {
    return renderManager({
      recipientName: message.recipientName,
      loginEmail,
      temporaryPassword,
      electric,
    });
  }
  if (message.role === 'tenant') {
    const prorated = message.startDate && message.startDate >= '2026-06-01';
    return renderTenant({
      recipientName: message.recipientName,
      unitLabel: message.unitLabel,
      loginEmail,
      temporaryPassword,
      electric,
      proratedElectric: prorated,
    });
  }
  return { html: message.html, text: message.text, subject: message.subject };
}

async function prepareMessagesForSend(messages, { primaryOwnerId, electric }) {
  const prepared = [];
  for (const m of messages) {
    const skipPassword = m.role === 'owner';
    if (skipPassword || !m.userId) {
      prepared.push({ ...m, includesPassword: false });
      continue;
    }
    const plain = generatePassword();
    await setPasswordHash(m.userId, plain);
    const rendered = rerenderWithCredentials(m, electric, plain);
    prepared.push({
      ...m,
      ...rendered,
      includesPassword: true,
      passwordNote: 'New password set in system; included only in this email to recipient.',
    });
  }
  return prepared;
}

async function sendCampaign({ messageIds, dryRun = false, delayMs = 2000 }) {
  const orgId = await resolveOrgId();
  if (!orgId) {
    const err = new Error('Gmail is not connected. Connect Gmail under Utilities first.');
    err.code = 'NOT_CONNECTED';
    throw err;
  }

  const bcc = await resolveSenderBcc(orgId);
  const primaryOwnerId = await resolvePrimaryOwnerId(orgId);
  const { messages, electric } = await buildCampaignMessages();
  let selected = messageIds?.length
    ? messages.filter((m) => messageIds.includes(m.id))
    : messages;

  if (!selected.length) {
    return { dryRun, sent: 0, failed: 0, results: [], bcc, messages: messages.map((m) => m.id) };
  }

  if (!dryRun) {
    selected = await prepareMessagesForSend(selected, { primaryOwnerId, electric });
  } else {
    selected = selected.map((m) => ({
      ...m,
      passwordNote:
        m.role === 'owner'
          ? 'Owner email never includes a password.'
          : 'On send: new unique password generated and embedded in this email only.',
    }));
  }

  const results = [];
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < selected.length; i++) {
    const m = selected[i];
    if (dryRun) {
      results.push({
        id: m.id,
        to: m.to,
        subject: m.subject,
        status: 'dry_run',
        includesPassword: m.role !== 'owner',
        note: m.passwordNote,
      });
      continue;
    }

    try {
      const result = await sendEmail({
        orgId,
        to: m.to,
        bcc: bcc || undefined,
        subject: m.subject,
        text: m.text,
        html: m.html,
      });
      if (result.sent) {
        sent++;
        results.push({ id: m.id, to: m.to, subject: m.subject, status: 'sent', provider: result.provider });
      } else {
        failed++;
        results.push({ id: m.id, to: m.to, subject: m.subject, status: 'skipped', reason: result.skipped });
      }
    } catch (err) {
      failed++;
      results.push({ id: m.id, to: m.to, subject: m.subject, status: 'error', message: err.message });
    }

    if (!dryRun && i < selected.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { dryRun, sent, failed, bcc, results, total: selected.length };
}

function renderStandalonePreviewPage({ messages, bcc, apiBase }) {
  const cards = messages
    .map(
      (m) => `
    <article class="card" id="${m.id}">
      <header class="card-head">
        <span class="role">${escapeHtml(m.label)}</span>
        <h2>${escapeHtml(m.subject)}</h2>
        <p class="to">To: <strong>${escapeHtml(m.to)}</strong></p>
        <a class="solo" href="${apiBase}/preview/${m.id}" target="_blank" rel="noopener">Open full screen ↗</a>
      </header>
      <iframe src="${apiBase}/preview/${m.id}" title="${escapeHtml(m.label)}" loading="lazy"></iframe>
    </article>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Portal launch emails — Montero Rentals</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #e2e8f0; margin: 0; padding: 24px 16px 100px; color: #0f172a; }
    .top { max-width: 720px; margin: 0 auto 24px; text-align: center; }
    .top h1 { font-size: 22px; margin: 0 0 8px; }
    .top p { color: #64748b; font-size: 14px; margin: 0 0 16px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 16px; }
    button { font-size: 15px; font-weight: 600; padding: 12px 22px; border-radius: 10px; border: 0; cursor: pointer; }
    .primary { background: #4f46e5; color: #fff; }
    .secondary { background: #fff; color: #334155; border: 1px solid #cbd5e1; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    #status { max-width: 720px; margin: 16px auto 0; font-size: 14px; text-align: left; white-space: pre-wrap; }
    .card { max-width: 720px; margin: 0 auto 28px; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgb(0 0 0 / 8%); }
    .card-head { padding: 16px 20px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
    .role { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
    .card-head h2 { margin: 6px 0 4px; font-size: 17px; line-height: 1.35; }
    .to { margin: 0; font-size: 13px; color: #475569; }
    .solo { float: right; font-size: 12px; font-weight: 600; color: #4f46e5; text-decoration: none; }
    iframe { display: block; width: 100%; height: 560px; border: 0; background: #f1f5f9; }
    .bcc { font-size: 12px; color: #059669; background: #ecfdf5; display: inline-block; padding: 4px 10px; border-radius: 999px; }
  </style>
</head>
<body>
  <div class="top">
    <h1>Portal launch emails</h1>
    <p>${messages.length} messages · BCC sender on every send <span class="bcc">${bcc ? escapeHtml(bcc) : 'Gmail sender'}</span></p>
    <div class="actions">
      <button type="button" class="primary" id="sendAll">Send all ${messages.length} emails</button>
      <button type="button" class="secondary" id="dryRun">Dry run (no send)</button>
    </div>
    <pre id="status"></pre>
  </div>
  ${cards}
  <script>
    const apiBase = ${JSON.stringify(apiBase)};
    const statusEl = document.getElementById('status');
    function token() {
      return localStorage.getItem('pm_access_token') || sessionStorage.getItem('pm_access_token') || prompt('Paste owner access token (log in at /admin, DevTools → Application, or use Network tab on any API call):');
    }
    async function runSend(dryRun) {
      const t = token();
      if (!t) { statusEl.textContent = 'Cancelled — no token.'; return; }
      document.getElementById('sendAll').disabled = true;
      document.getElementById('dryRun').disabled = true;
      statusEl.textContent = dryRun ? 'Dry run…' : 'Sending…';
      try {
        const res = await fetch(apiBase + '/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
          body: JSON.stringify({ dryRun }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || res.statusText);
        statusEl.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
      } finally {
        document.getElementById('sendAll').disabled = false;
        document.getElementById('dryRun').disabled = false;
      }
    }
    document.getElementById('sendAll').onclick = () => {
      if (confirm('Send all portal launch emails now? Each message goes to one recipient; you are BCC on every send.')) runSend(false);
    };
    document.getElementById('dryRun').onclick = () => runSend(true);
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Preview HTML — owner has no password block; others show placeholder. */
async function previewHtmlForMessage(messageId) {
  const { messages, electric } = await buildCampaignMessages();
  const m = messages.find((x) => x.id === messageId);
  if (!m) return null;
  if (m.role === 'owner') return m.html;
  const rendered = rerenderWithCredentials(m, electric, PREVIEW_PASSWORD_PLACEHOLDER);
  return rendered.html;
}

module.exports = {
  buildCampaignMessages,
  sendCampaign,
  renderStandalonePreviewPage,
  previewHtmlForMessage,
  resolveOrgId,
  resolveSenderBcc,
};
