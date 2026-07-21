/**
 * Parse utility e-bill emails (Dominion Energy, City of Norfolk / InvoiceCloud, HRSD).
 */

const {
  parseDominionAmounts,
  resolveElectricChargeAmount,
  computeChargeableAfter,
  isDominionProvider,
} = require('./dominion-billing.service');

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function emailText(message) {
  const plain = message.body || '';
  const fromHtml = stripHtml(message.html);
  return `${message.subject || ''}\n${plain}\n${fromHtml}`.trim();
}

function parseMoney(text) {
  const patterns = [
    /current\s+(?:charges|amount)[^$0-9]{0,30}\$?\s*([\d,]+\.\d{2})/i,
    /energy\s+charges[^$0-9]{0,30}\$?\s*([\d,]+\.\d{2})/i,
    /total\s+amount[^$0-9]{0,30}\$?\s*([\d,]+\.\d{2})/i,
    /amount\s+due[^$0-9]{0,30}\$?\s*([\d,]+\.\d{2})/i,
    /amount\s+due[^$0-9]{0,30}([\d,]+\.\d{2})/i,
    /balance\s+due[^$0-9]{0,30}\$?\s*([\d,]+\.\d{2})/i,
    /bill\s+amount[^$0-9]{0,30}\$?\s*([\d,]+\.\d{2})/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m) return Number(m[1].replace(/,/g, ''));
  }

  const dollar = [...text.matchAll(/\$\s*([\d,]+\.\d{2})/g)].map(m => Number(m[1].replace(/,/g, '')));
  if (dollar.length) return Math.max(...dollar);

  const bare = [...text.matchAll(/(?:^|[\s:])([\d,]+\.\d{2})(?:\s|$)/gm)]
    .map(m => Number(m[1].replace(/,/g, '')))
    .filter(n => n >= 5);
  return bare.length ? Math.max(...bare) : null;
}

function parseIsoDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  const mdy = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseDueDate(text) {
  const patterns = [
    /due\s+date[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
    /due\s+date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /payment\s+date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /payment\s+date[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
    /payment\s+due\s+on[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /payment\s+due\s+by[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
    /pay\s+by[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /upcoming\s+on[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /transaction\s+is\s+upcoming\s+on[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return parseIsoDate(m[1]);
  }
  return null;
}

function parseBillingPeriod(text) {
  const patterns = [
    /(?:billing|service)\s+period[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s*[-–—to]+\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
    /(?:billing|service)\s+period[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\s*[-–—to]+\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /for\s+the\s+period\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s*[-–—to]+\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      return { period_start: parseIsoDate(m[1]), period_end: parseIsoDate(m[2]) };
    }
  }
  return { period_start: null, period_end: null };
}

function parseAccountNumber(text) {
  const patterns = [
    /account\s*(?:number|#)?[:\s#]*([A-Z]{0,3}-?\d{6,14})/i,
    /account\s*#[:\s]*(\d{8,14})/i,
    /invoice\s*#[:\s]*([\d]+-PP-\d+)/i,
    /invoice\s*number[:\s]*([\d]+-PP-[\d]+)/i,
    /account\s+ending\s+in\s+(\d{4,6})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].replace(/\s/g, '');
  }
  return null;
}

/** Emails we should never turn into draft bills. */
function shouldSkipBillImport(from, subject, text) {
  const hay = `${from} ${subject} ${text}`.toLowerCase();

  const skipPhrases = [
    'thank you for your payment',
    'payment has been processed',
    'confirmation number',
    'payment confirmation',
    'your payment of',
    'disconnection',
    'subject to disconnect',
    'power outage',
    'outage restored',
    'outage alert',
    'merger',
    'nexteara',
    'peak time rebate',
    'smart thermostat',
    'energy spend alert',
    'daily usage alert',
    'temperatures are rising',
    'your bill doesn',
    'trending on nextdoor',
    'potomac crossing',
  ];
  if (skipPhrases.some((p) => hay.includes(p))) {
    return 'Not a bill statement (payment, alert, or marketing)';
  }

  if (hay.includes('dominion') && !hay.includes('bill is available') && !hay.includes('amount due')
    && !hay.includes('invoice') && !hay.includes('balance due')) {
    return 'Dominion email is not a bill statement';
  }

  return null;
}

function detectProvider(from, subject, text) {
  const hay = `${from} ${subject} ${text}`.toLowerCase();
  const sub = subject.toLowerCase();

  if (hay.includes('invoicecloud') || (hay.includes('norfolk') && (sub.includes('invoice') || hay.includes('invoice#')))) {
    return {
      provider_name: 'City of Norfolk Utilities',
      service_type: 'water',
    };
  }

  if (
    hay.includes('dominion')
    || hay.includes('domenergyvan')
    || from.toLowerCase().includes('domenergy')
  ) {
    if (sub.includes('bill is available') || hay.includes('amount due') || hay.includes('balance due')
      || sub.includes('invoice')) {
      return {
        provider_name: 'Dominion Energy Virginia',
        service_type: 'electric',
      };
    }
  }

  if (hay.includes('hrsd') || hay.includes('hrub')
    || (hay.includes('norfolk') && hay.includes('util'))
    || sub.includes('bill is ready')) {
    return {
      provider_name: 'HRSD / Norfolk Utilities',
      service_type: 'water',
    };
  }

  return null;
}

function defaultPeriodFromMessage(messageDate) {
  const end = messageDate || new Date().toISOString().slice(0, 10);
  const d = new Date(end);
  d.setMonth(d.getMonth() - 1);
  d.setDate(1);
  const start = d.toISOString().slice(0, 10);
  return { period_start: start, period_end: end };
}

function parseAmountsForProvider(text, provider, from) {
  if (provider.service_type === 'electric' && isDominionProvider(provider.provider_name, from, text)) {
    const dominion = parseDominionAmounts(text);
    const tenant_charge_amount = dominion.tenant_charge_amount;
    return {
      tenant_charge_amount,
      statement_balance: dominion.statement_balance,
      amount_source: dominion.amount_source,
      parse_warnings: dominion.warnings,
      total_amount: tenant_charge_amount,
    };
  }

  const total_amount = parseMoney(text);
  return {
    tenant_charge_amount: total_amount,
    statement_balance: null,
    amount_source: null,
    parse_warnings: [],
    total_amount,
  };
}

function parseUtilityEmail(message) {
  const text = emailText(message);
  const skip = shouldSkipBillImport(message.from, message.subject, text);
  if (skip) return { ok: false, reason: skip };

  const provider = detectProvider(message.from, message.subject, text);
  if (!provider) {
    return { ok: false, reason: 'Unknown sender — not a recognized utility bill email' };
  }

  const amounts = parseAmountsForProvider(text, provider, message.from);
  const total_amount = amounts.total_amount;
  if (!total_amount || total_amount < 5) {
    return { ok: false, reason: 'Could not find bill amount in email' };
  }

  const due_date = parseDueDate(text);
  let { period_start, period_end } = parseBillingPeriod(text);
  const account_number = parseAccountNumber(text);

  const messageDate = parseIsoDate(message.date) || new Date().toISOString().slice(0, 10);
  if (!period_end) {
    const fallback = defaultPeriodFromMessage(messageDate);
    period_start = period_start || fallback.period_start;
    period_end = fallback.period_end;
  }
  if (!period_start) {
    const d = new Date(period_end);
    d.setMonth(d.getMonth() - 1);
    d.setDate(1);
    period_start = d.toISOString().slice(0, 10);
  }

  const chargeable_after = computeChargeableAfter(period_end);

  const dueFallback = (() => {
    const d = new Date(messageDate);
    d.setDate(d.getDate() + 21);
    return d.toISOString().slice(0, 10);
  })();

  const tenant_charge_amount = amounts.tenant_charge_amount ?? total_amount;

  return {
    ok: true,
    gmail_message_id: message.id,
    provider_name: provider.provider_name,
    service_type: provider.service_type,
    total_amount,
    tenant_charge_amount,
    statement_balance: amounts.statement_balance,
    amount_source: amounts.amount_source,
    chargeable_after,
    parse_warnings: amounts.parse_warnings,
    due_date: due_date || dueFallback,
    period_start,
    period_end,
    account_number,
    notes: `Imported from Gmail: ${message.subject} (${messageDate})`,
    bill_document_url: `https://mail.google.com/mail/u/0/#inbox/${message.id}`,
    email_subject: message.subject,
    email_from: message.from,
    email_date: messageDate,
  };
}

module.exports = {
  parseUtilityEmail,
  emailText,
  stripHtml,
  parseMoney,
  detectProvider,
  shouldSkipBillImport,
  parseAmountsForProvider,
  parseDominionAmounts,
  resolveElectricChargeAmount,
};
