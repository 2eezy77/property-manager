/** UC01 — Create utility bill (includes UC02 preview in response). */

const pool = require('../../db/client');
const { assertPropertyAccess } = require('./access');
const { loadActiveLeases, insertBillWithSplits } = require('./domain');
const { fetchBillWithSplits } = require('./queries');
const { useCaseError } = require('./errors');

async function executeCreateBill({ userId, role, body }) {
  const {
    property_id, service_type, period_start, period_end,
    total_amount, due_date, provider_name, notes, bill_document_url,
  } = body;

  if (!property_id || !service_type || !period_start || !period_end
      || !total_amount || !due_date) {
    throw useCaseError(
      'MISSING_PARAMS',
      'property_id, service_type, period_start, period_end, total_amount, due_date are required.'
    );
  }
  if (Number(total_amount) <= 0) {
    throw useCaseError('INVALID_AMOUNT', 'total_amount must be positive.');
  }

  await assertPropertyAccess(property_id, userId, role);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const leases = await loadActiveLeases(client, property_id, period_start, period_end);
    if (!leases.length) {
      await client.query('ROLLBACK');
      throw useCaseError('NO_ACTIVE_LEASES', 'No active leases overlap this bill period.');
    }

    const bill = await insertBillWithSplits(client, {
      propertyId: property_id,
      createdBy: userId,
      service_type,
      provider_name,
      period_start,
      period_end,
      total_amount,
      due_date,
      notes,
      bill_document_url,
      leases,
    });

    await client.query('COMMIT');
    return fetchBillWithSplits(pool, bill.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { executeCreateBill };
