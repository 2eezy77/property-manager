/**
 * Pull Cash App "Payment received" emails from org Gmail and import as rent payments.
 */

const pool = require('../db/client');
const { getGmailClient, getMessage } = require('./gmail.service');
const {
  buildImportPlanFromRows,
  load743CashAppTenants,
  applyCashAppImportPlan,
  normalizeSender,
} = require('./cashapp-import.service');

const CASHAPP_QUERY = 'from:cash@square.com subject:"Payment received"';

function parseMoney(raw) {
  if (raw == null || raw === '') return 0;
  return parseFloat(String(raw).replace(/[$,]/g, '')) || 0;
}

function parsePaymentText(snippet, body) {
  const text = `${snippet || ''} ${body || ''}`.replace(/\s+/g, ' ');
  const m = text.match(/(.+?)\s+paid you \$([\d,]+\.?\d*)/i);
  if (!m) return null;

  const sender = m[1].trim();
  const amount = parseMoney(m[2]);
  if (amount <= 0) return null;

  let notes = '';
  const forM = text.match(/\bfor\s+(.+?)(?:\.|$|\s+View)/i);
  if (forM) notes = forM[1].trim();

  return { sender, amount, notes };
}

function parseEmailDate(dateHeader) {
  const d = new Date(dateHeader);
  if (Number.isNaN(d.getTime())) return null;
  const dateIso = d.toISOString().slice(0, 10);
  return { date: d, dateIso };
}

function parsePaymentEmail(msg) {
  const parsed = parsePaymentText(msg.snippet, msg.body);
  if (!parsed) return null;

  const when = parseEmailDate(msg.date);
  if (!when) return null;

  const senderKey = normalizeSender(parsed.sender);
  if (!senderKey) return null;

  return {
    transactionId: `gmail:${msg.id}`,
    date: when.date,
    dateIso: when.dateIso,
    amount: parsed.amount,
    notes: parsed.notes,
    sender: parsed.sender,
    senderKey,
  };
}

async function listCashAppPaymentMessages(gmail, { newerThanDays = 400, maxMessages = 500 } = {}) {
  const q = `${CASHAPP_QUERY} newer_than:${newerThanDays}d`;
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

async function fetchCashAppPaymentsFromGmail(gmail, options = {}) {
  const messageRefs = await listCashAppPaymentMessages(gmail, options);
  const rows = [];
  const unparsed = [];

  for (const ref of messageRefs) {
    const msg = await getMessage(gmail, ref.id);
    const row = parsePaymentEmail(msg);
    if (row) rows.push(row);
    else unparsed.push({ id: ref.id, subject: msg.subject, snippet: msg.snippet });
  }

  return { rows, unparsed };
}

async function buildGmailImportPlan(userId, role, options = {}) {
  const gmail = await getGmailClient(userId, role);
  const { rows, unparsed } = await fetchCashAppPaymentsFromGmail(gmail, options);
  const tenants = await load743CashAppTenants(pool);
  const senderKeys = [...new Set(tenants.map((t) => t.cashAppKey).filter(Boolean))];
  const plan = buildImportPlanFromRows(rows, tenants, senderKeys);
  return { plan, unparsed, paymentCount: rows.length, tenantsLoaded: tenants.length };
}

async function syncCashAppFromGmail(userId, role, { apply = true, ...options } = {}) {
  const { plan, unparsed, paymentCount, tenantsLoaded } = await buildGmailImportPlan(userId, role, options);

  if (!apply) {
    return { plan, unparsed, paymentCount, tenantsLoaded, applied: false };
  }

  const applyResult = await applyCashAppImportPlan(pool, plan);
  return {
    plan,
    unparsed,
    paymentCount,
    tenantsLoaded,
    applied: true,
    ...applyResult,
  };
}

module.exports = {
  parsePaymentEmail,
  fetchCashAppPaymentsFromGmail,
  buildGmailImportPlan,
  syncCashAppFromGmail,
};
