/**
 * owner-checklist.service.js — Owner personal payment checklist (not tenant rent).
 */

const pool = require('../db/client');

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
  const sets = [];
  const vals = [ownerId, itemId];
  let i = 3;

  for (const key of allowed) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = $${i++}`);
      vals.push(patch[key]);
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

module.exports = { listChecklist, updateChecklistItem, seedDefaults, DEFAULT_ITEMS };
