const pool = require('../../db/client');
const { accessiblePropertyIds } = require('./access');
const { useCaseError } = require('./errors');

async function executeDeleteDraftBill({ userId, role, billId }) {
  const propIds = await accessiblePropertyIds(userId, role);
  if (!propIds.length) throw useCaseError('NOT_FOUND', 'Bill not found.');

  const { rows: [bill] } = await pool.query(
    `SELECT id, property_id, status FROM utility_bills WHERE id = $1`,
    [billId]
  );
  if (!bill || !propIds.includes(bill.property_id)) {
    throw useCaseError('NOT_FOUND', 'Bill not found.');
  }
  if (bill.status !== 'draft') {
    throw useCaseError('INVALID_STATE', 'Only draft bills can be deleted.');
  }

  await pool.query('DELETE FROM utility_bill_splits WHERE bill_id = $1', [billId]);
  await pool.query('DELETE FROM utility_bills WHERE id = $1', [billId]);
  return { deleted: true, id: billId };
}

/** Remove duplicate draft bills (same property, service, period, amount). Keeps Gmail-linked or newest. */
async function executePruneDuplicateDrafts({ userId, role }) {
  const propIds = await accessiblePropertyIds(userId, role);
  if (!propIds.length) return { removed: 0, kept: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: dupes } = await client.query(
      `WITH ranked AS (
         SELECT ub.id,
                ROW_NUMBER() OVER (
                  PARTITION BY ub.property_id, ub.service_type, ub.period_start, ub.period_end, ub.total_amount
                  ORDER BY (ub.gmail_message_id IS NOT NULL) DESC, ub.created_at DESC
                ) AS rn
           FROM utility_bills ub
          WHERE ub.status = 'draft'
            AND ub.property_id = ANY($1::uuid[])
       )
       SELECT id FROM ranked WHERE rn > 1`,
      [propIds]
    );
    const ids = dupes.map((r) => r.id);
    if (!ids.length) {
      await client.query('COMMIT');
      return { removed: 0, kept: 0 };
    }
    await client.query('DELETE FROM utility_bill_splits WHERE bill_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM utility_bills WHERE id = ANY($1::uuid[])', [ids]);
    await client.query('COMMIT');
    return { removed: ids.length, kept: ids.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Per property + service, keep only the newest draft (by period end). */
async function executePruneStaleDrafts({ userId, role }) {
  const propIds = await accessiblePropertyIds(userId, role);
  if (!propIds.length) return { removed: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: stale } = await client.query(
      `WITH ranked AS (
         SELECT ub.id,
                ROW_NUMBER() OVER (
                  PARTITION BY ub.property_id, ub.service_type
                  ORDER BY ub.period_end DESC, (ub.gmail_message_id IS NOT NULL) DESC, ub.created_at DESC
                ) AS rn
           FROM utility_bills ub
          WHERE ub.status = 'draft'
            AND ub.property_id = ANY($1::uuid[])
       )
       SELECT id FROM ranked WHERE rn > 1`,
      [propIds]
    );
    const ids = stale.map((r) => r.id);
    if (!ids.length) {
      await client.query('COMMIT');
      return { removed: 0 };
    }
    await client.query('DELETE FROM utility_bill_splits WHERE bill_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM utility_bills WHERE id = ANY($1::uuid[])', [ids]);
    await client.query('COMMIT');
    return { removed: ids.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  executeDeleteDraftBill,
  executePruneDuplicateDrafts,
  executePruneStaleDrafts,
};
