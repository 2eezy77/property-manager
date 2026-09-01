/**
 * Classify owner-bill Gmail (Newrez, Vivint, T-Mobile, Dominion/HRSD).
 * Payment confirmations only — never tenant rent, Stripe, or a bill statement.
 * Does not invent amounts.
 */

const { lastPaidAtForPostedPayment } = require('./owner-checklist.service');
const { norfolkDateKey, parseNorfolkLocal } = require('../utils/norfolk-time');

const CATEGORIES = ['mortgage', 'vivint', 'tmobile', 'utilities'];

const PAID_PHRASES = [
  'thank you for your payment',
  'payment confirmation',
  'payment has been processed',
  'payment has been received',
  'payment received',
  'we received your payment',
  'your payment of',
  'payment posted',
  'was posted',
];

const BILL_PHRASES = [
  'bill is available',
  'bill is ready',
  'statement is available',
  'monthly mortgage statement',
  'monthly statement',
];

const UPCOMING_PHRASES = [
  'will be deducted',
  'upcoming payment',
  'scheduled payment',
  'enrolled in auto pay',
];

function haystack(message) {
  return [
    message.from,
    message.subject,
    message.snippet,
    message.body,
  ].filter(Boolean).join('\n');
}

function parseIsoDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const mdy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function postedAtFromIso(iso, fallback) {
  if (iso) {
    const local = parseNorfolkLocal(`${iso}T12:00`);
    if (local) return { postedAt: local, postedOn: iso };
  }
  if (fallback instanceof Date && !Number.isNaN(fallback.getTime())) {
    return { postedAt: fallback, postedOn: norfolkDateKey(fallback) };
  }
  const header = fallback ? new Date(fallback) : null;
  if (header && !Number.isNaN(header.getTime())) {
    return { postedAt: header, postedOn: norfolkDateKey(header) };
  }
  return { postedAt: null, postedOn: null };
}

function parsePostedDate(text, dateHeader) {
  const patterns = [
    /posted\s+on[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /payment\s+date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /payment\s+date[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
    /posted\s+on[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const iso = parseIsoDate(m[1]);
      if (iso) return postedAtFromIso(iso, dateHeader);
    }
  }
  return postedAtFromIso(null, dateHeader);
}

function parseConfirmation(text) {
  const m = text.match(/confirmation(?:\s*(?:number|#|no\.?))?[:\s#]*([A-Z0-9-]{5,})/i);
  if (!m) return null;
  return m[1].replace(/[.,;]+$/, '');
}

function parseAmount(text) {
  const patterns = [
    /your\s+payment\s+of\s*\$?\s*([\d,]+\.\d{2})/i,
    /(?:we\s+received\s+your\s+)?payment\s+of\s*\$?\s*([\d,]+\.\d{2})/i,
    /amount[:\s]+\$?\s*([\d,]+\.\d{2})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1].replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function detectCategories(text) {
  const hay = text.toLowerCase();
  const hits = [];
  if (/newrez|shellpoint/.test(hay)) hits.push('mortgage');
  if (/vivint/.test(hay)) hits.push('vivint');
  if (/t-?mobile/.test(hay)) hits.push('tmobile');
  if (/dominion|domenergy|hrsd|invoicecloud|norfolk\.gov|city of norfolk/.test(hay)) {
    hits.push('utilities');
  }
  return [...new Set(hits)];
}

function isRejected(text) {
  const hay = text.toLowerCase();
  if (hay.includes('cash@square.com') || hay.includes('cash app') || /paid you \$/.test(hay)) {
    return 'tenant_cashapp';
  }
  if (hay.includes('stripe.com') || hay.includes('stripe payout') || hay.includes('payout is on the way')) {
    return 'stripe';
  }
  if (/\bchime\b/.test(hay) || hay.includes('chime.com')) return 'chime';
  return null;
}

function classifyKind(text) {
  const hay = text.toLowerCase();
  const paid = PAID_PHRASES.some((p) => hay.includes(p));
  const upcoming = UPCOMING_PHRASES.some((p) => hay.includes(p));
  const bill = BILL_PHRASES.some((p) => hay.includes(p));

  if (upcoming && !paid) return { kind: 'upcoming', skipReason: 'upcoming_or_scheduled' };
  if (bill && !paid) return { kind: 'bill', skipReason: 'bill_not_confirmation' };
  if (paid) return { kind: 'paid_confirmation', skipReason: null };
  return { kind: 'ambiguous', skipReason: 'ambiguous' };
}

function parseOwnerBillEmail(message) {
  const text = haystack(message || {});
  const rejected = isRejected(text);
  const categories = detectCategories(text);
  const { kind, skipReason } = rejected
    ? { kind: 'rejected', skipReason: rejected }
    : classifyKind(text);

  let category = null;
  let finalKind = kind;
  let finalSkip = skipReason;

  if (rejected) {
    category = null;
  } else if (categories.length === 1) {
    category = categories[0];
  } else if (categories.length > 1) {
    finalKind = 'ambiguous';
    finalSkip = 'multiple_categories';
  } else if (kind === 'paid_confirmation') {
    finalKind = 'ambiguous';
    finalSkip = 'unknown_biller';
  }

  if (finalKind === 'paid_confirmation' && !category) {
    finalKind = 'ambiguous';
    finalSkip = 'unknown_biller';
  }

  const { postedAt, postedOn } = parsePostedDate(text, message?.date);
  const confirmation = parseConfirmation(text);
  const amount = parseAmount(text);

  return {
    kind: finalKind,
    skipReason: finalKind === 'paid_confirmation' ? null : finalSkip,
    category,
    confirmation,
    amount,
    postedAt,
    postedOn,
    gmailMessageId: message?.id || null,
    subject: message?.subject || '',
    from: message?.from || '',
  };
}

function confirmationKey(category, confirmation) {
  if (!category || !confirmation) return null;
  return `${category}:${confirmation}`;
}

function decideOwnerBillApply({
  parsed,
  item,
  existingByGmailId = new Set(),
  existingByConfirmation = new Set(),
}) {
  if (!parsed || parsed.kind !== 'paid_confirmation') {
    return {
      action: 'skip',
      reason: parsed?.skipReason || parsed?.kind || 'not_confirmation',
    };
  }
  if (!parsed.category || !CATEGORIES.includes(parsed.category)) {
    return { action: 'skip', reason: 'unknown_biller' };
  }
  if (item && item.category && item.category !== parsed.category) {
    return { action: 'skip', reason: 'category_mismatch' };
  }
  if (parsed.gmailMessageId && existingByGmailId.has(parsed.gmailMessageId)) {
    return { action: 'skip', reason: 'duplicate_gmail' };
  }
  const confKey = confirmationKey(parsed.category, parsed.confirmation);
  if (confKey && existingByConfirmation.has(confKey)) {
    return { action: 'skip', reason: 'duplicate_confirmation' };
  }
  if (!parsed.postedAt) {
    return { action: 'skip', reason: 'no_posted_date' };
  }

  const attributedPaid = lastPaidAtForPostedPayment(item, parsed.postedAt);
  const patch = {};

  const currentPaid = item?.last_paid_at ? new Date(item.last_paid_at).getTime() : null;
  if (currentPaid == null || attributedPaid.getTime() > currentPaid) {
    patch.last_paid_at = attributedPaid;
  }

  const currentVerified = item?.last_verified_at ? new Date(item.last_verified_at).getTime() : null;
  const verifiedAt = parsed.postedAt;
  if (currentVerified == null || verifiedAt.getTime() > currentVerified) {
    patch.last_verified_at = verifiedAt;
  }

  return { action: 'apply', patch };
}

function appendConfirmationNote(existingNotes, parsed) {
  const notes = existingNotes == null ? '' : String(existingNotes);
  const markers = [parsed?.confirmation, parsed?.gmailMessageId].filter(Boolean);
  if (markers.some((m) => notes.includes(m))) return notes;

  const bits = ['Gmail confirmation'];
  if (parsed?.confirmation) bits.push(parsed.confirmation);
  if (parsed?.gmailMessageId) bits.push(`(gmail ${parsed.gmailMessageId})`);
  if (parsed?.postedOn) bits.push(`posted ${parsed.postedOn}`);
  if (Number.isFinite(parsed?.amount)) {
    bits.push(`$${Number(parsed.amount).toFixed(2)}`);
  }

  const line = bits.join(' ');
  if (!notes.trim()) return line;
  return `${notes.trim()}\n\n${line}`;
}

function buildExistingKeys(rows = []) {
  const existingByGmailId = new Set();
  const existingByConfirmation = new Set();
  for (const row of rows) {
    if (row.gmail_message_id) existingByGmailId.add(row.gmail_message_id);
    const key = confirmationKey(row.category, row.confirmation);
    if (key) existingByConfirmation.add(key);
  }
  return { existingByGmailId, existingByConfirmation };
}

module.exports = {
  parseOwnerBillEmail,
  decideOwnerBillApply,
  appendConfirmationNote,
  buildExistingKeys,
  confirmationKey,
  CATEGORIES,
};
