/**
 * owner-checklist.service.js — Owner personal payment checklist (not tenant rent).
 */

const pool = require('../db/client');
const { norfolkDateKey, parseNorfolkLocal } = require('../utils/norfolk-time');

/** Newrez ACH posted 2026-09-01 — covers August 2026, not September. */
const NEWREZ_2026_09_01_POSTING = {
  amount: 2265.37,
  postedOn: '2026-09-01',
  confirmation: '104800282',
  loanLast4: '8062',
};

/** ET day of the Gmail/Newrez posting — only this day (or null) is rewritten. */
const NEWREZ_SEP1_ET_START = '2026-09-01T00:00:00-04:00';
const NEWREZ_SEP2_ET_START = '2026-09-02T00:00:00-04:00';

/** True when migration 048 may set last_paid_at to Aug 31 noon ET. */
function wouldRewriteMortgageLastPaidAt(lastPaidAt) {
  if (lastPaidAt == null || lastPaidAt === '') return true;
  const t = new Date(lastPaidAt).getTime();
  if (Number.isNaN(t)) return false;
  return t >= new Date(NEWREZ_SEP1_ET_START).getTime()
    && t < new Date(NEWREZ_SEP2_ET_START).getTime();
}

function newrezAugust2026PaidNote() {
  const { amount, postedOn, confirmation, loanLast4 } = NEWREZ_2026_09_01_POSTING;
  const dollars = Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Newrez posted $${dollars} on ${postedOn} (conf ${confirmation}, loan ending ${loanLast4}) covering August 2026 — not September.`;
}

/**
 * Newrez mortgage is due on the 1st; a posting on the 1st is last month's payment.
 * Store last_paid_at on the prior month's last day (noon Norfolk) so the
 * checklist date is August, not September — and UTC ISO date stays in August.
 */
function lastPaidAtForPostedPayment(item, postedAt = new Date()) {
  const posted = postedAt instanceof Date ? postedAt : new Date(postedAt);
  if (Number.isNaN(posted.getTime())) return postedAt;
  if (!item || item.category !== 'mortgage' || Number(item.due_day) !== 1) {
    return posted;
  }

  const key = norfolkDateKey(posted);
  if (!key || Number(key.slice(8, 10)) !== 1) return posted;

  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const prior = parseNorfolkLocal(
    `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T12:00`
  );
  return prior || posted;
}

const DEFAULT_ITEMS = [
  {
    category: 'mortgage',
    label: 'Mortgage (Newrez)',
    amount_estimate: 2265.37,
    due_day: 1,
    payment_method: 'ach',
    notes: '743 A Ave — ~$2,265.37/mo; check Newrez dashboard for escrow adjustments.',
    sort_order: 1,
  },
  {
    category: 'vivint',
    label: 'Vivint Smart Home',
    amount_estimate: 110.0,
    due_day: null,
    payment_method: 'credit_card',
    notes: 'Service ~$66 + ~$44 on credit card.',
    sort_order: 2,
  },
  {
    category: 'tmobile',
    label: 'T-Mobile Internet',
    amount_estimate: 100.0,
    due_day: null,
    payment_method: 'auto_pay',
    notes: 'Home internet ~$100/mo.',
    sort_order: 3,
  },
  {
    category: 'utilities',
    label: 'Property utilities (electric + water/trash)',
    amount_estimate: null,
    due_day: null,
    payment_method: 'varies',
    notes: '743 A Ave tenant utility splits tracked under Manager → Utilities; owner pays master bills as needed.',
    sort_order: 4,
  },
];

async function seedDefaults(ownerId) {
  for (const item of DEFAULT_ITEMS) {
    await pool.query(
      `INSERT INTO owner_payment_checklist (
         owner_id, category, label, amount_estimate, due_day,
         payment_method, notes, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (owner_id, category) DO NOTHING`,
      [
        ownerId,
        item.category,
        item.label,
        item.amount_estimate,
        item.due_day,
        item.payment_method,
        item.notes,
        item.sort_order,
      ]
    );
  }
}

async function listChecklist(ownerId) {
  const { rows: existing } = await pool.query(
    `SELECT 1 FROM owner_payment_checklist WHERE owner_id = $1 LIMIT 1`,
    [ownerId]
  );
  if (!existing.length) await seedDefaults(ownerId);

  const { rows } = await pool.query(
    `SELECT id, category, label, amount_estimate, due_day, payment_method, notes,
            last_paid_at, last_verified_at, sort_order, created_at, updated_at
     FROM owner_payment_checklist
     WHERE owner_id = $1
     ORDER BY sort_order, label`,
    [ownerId]
  );
  return rows;
}

async function updateChecklistItem(ownerId, itemId, patch) {
  const allowed = ['label', 'amount_estimate', 'due_day', 'payment_method', 'notes', 'last_paid_at', 'last_verified_at'];
  const next = { ...patch };

  if (next.last_paid_at != null) {
    const { rows: [current] } = await pool.query(
      `SELECT category, due_day FROM owner_payment_checklist
        WHERE id = $2 AND owner_id = $1`,
      [ownerId, itemId]
    );
    if (current) {
      next.last_paid_at = lastPaidAtForPostedPayment(current, next.last_paid_at);
    }
  }

  const sets = [];
  const vals = [ownerId, itemId];
  let i = 3;

  for (const key of allowed) {
    if (next[key] !== undefined) {
      sets.push(`${key} = $${i++}`);
      vals.push(next[key]);
    }
  }

  if (!sets.length) {
    const err = new Error('No valid fields to update');
    err.code = 'VALIDATION';
    throw err;
  }

  sets.push('updated_at = NOW()');

  const { rows } = await pool.query(
    `UPDATE owner_payment_checklist
     SET ${sets.join(', ')}
     WHERE id = $2 AND owner_id = $1
     RETURNING *`,
    vals
  );

  if (!rows[0]) {
    const err = new Error('Checklist item not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return rows[0];
}

module.exports = {
  listChecklist,
  updateChecklistItem,
  seedDefaults,
  DEFAULT_ITEMS,
  lastPaidAtForPostedPayment,
  NEWREZ_2026_09_01_POSTING,
  newrezAugust2026PaidNote,
  wouldRewriteMortgageLastPaidAt,
  NEWREZ_SEP1_ET_START,
  NEWREZ_SEP2_ET_START,
};
