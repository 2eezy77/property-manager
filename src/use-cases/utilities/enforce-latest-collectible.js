/**
 * Only the newest bill per property + service_type may be collectible by tenants.
 * Older bills are settled; non-paid splits are waived (historical / owner resolved).
 */

const { loadActiveLeases, computeOccupancySplits } = require('./domain');

const OPEN_BILL_STATUSES = ['draft', 'notified', 'charging'];
const RESOLVED_NOTE = 'Resolved — superseded by a newer bill or owner prepaid history';

async function resolveOwnerId(client, propertyId) {
  const { rows } = await client.query(
    `SELECT o.owner_id
       FROM properties p
       JOIN organizations o ON o.id = p.org_id
      WHERE p.id = $1`,
    [propertyId]
  );
  return rows[0]?.owner_id ?? null;
}

async function waiveOpenSplits(client, billId, waivedBy) {
  const { rowCount } = await client.query(
    `UPDATE utility_bill_splits
        SET status = 'waived',
            waived_by = $2,
            waived_at = NOW(),
            updated_at = NOW()
      WHERE bill_id = $1
        AND status NOT IN ('paid', 'waived')`,
    [billId, waivedBy]
  );
  return rowCount ?? 0;
}

async function settleBill(client, billId) {
  await client.query(
    `UPDATE utility_bills
        SET status = 'settled',
            settled_at = COALESCE(settled_at, NOW()),
            updated_at = NOW(),
            notes = CASE
              WHEN COALESCE(notes, '') = '' THEN $2
              WHEN notes LIKE '%' || $2 || '%' THEN notes
              ELSE notes || E'\n' || $2
            END
      WHERE id = $1
        AND status NOT IN ('settled', 'cancelled')`,
    [billId, RESOLVED_NOTE]
  );
}

async function reopenLatestForCollection(client, bill) {
  const { rows: splits } = await client.query(
    `SELECT id, status FROM utility_bill_splits WHERE bill_id = $1`,
    [bill.id]
  );
  if (!splits.length) {
    const leases = await loadActiveLeases(
      client,
      bill.property_id,
      bill.period_start,
      bill.period_end
    );
    const computed = computeOccupancySplits(
      leases,
      bill.total_amount,
      bill.period_start,
      bill.period_end
    );
    for (const s of computed) {
      await client.query(
        `INSERT INTO utility_bill_splits (bill_id, lease_id, tenant_id, amount, status)
         VALUES ($1,$2,$3,$4,'pending')`,
        [bill.id, s.leaseId, s.tenantId, s.amount]
      );
    }
  } else {
    await client.query(
      `UPDATE utility_bill_splits
          SET status = 'pending',
              waived_by = NULL,
              waived_at = NULL,
              updated_at = NOW()
        WHERE bill_id = $1
          AND status = 'waived'`,
      [bill.id]
    );
  }

  if (!OPEN_BILL_STATUSES.includes(bill.status)) {
    await client.query(
      `UPDATE utility_bills
          SET status = 'draft',
              settled_at = NULL,
              updated_at = NOW()
        WHERE id = $1
          AND status NOT IN ('cancelled')`,
      [bill.id]
    );
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ propertyId?: string, serviceType?: string, ownerId?: string }} opts
 */
async function enforceLatestCollectible(client, opts = {}) {
  const { propertyId, serviceType, ownerId: ownerIdIn } = opts;

  const params = [];
  let where = '1=1';
  if (propertyId) {
    params.push(propertyId);
    where += ` AND ub.property_id = $${params.length}`;
  }
  if (serviceType) {
    params.push(serviceType);
    where += ` AND ub.service_type = $${params.length}`;
  }

  const { rows: groups } = await client.query(
    `SELECT ub.property_id, ub.service_type::text AS service_type
       FROM utility_bills ub
      WHERE ${where}
      GROUP BY ub.property_id, ub.service_type`,
    params
  );

  const summary = { groups: 0, settled_older: 0, splits_waived: 0, latest_reopened: 0 };

  for (const g of groups) {
    summary.groups += 1;
    const waivedBy = ownerIdIn || (await resolveOwnerId(client, g.property_id));

    const { rows: bills } = await client.query(
      `SELECT id, property_id, service_type, period_start, period_end,
              total_amount, status, settled_at
         FROM utility_bills
        WHERE property_id = $1
          AND service_type = $2
        ORDER BY period_end DESC, created_at DESC`,
      [g.property_id, g.service_type]
    );
    if (!bills.length) continue;

    const [latest, ...older] = bills;

    for (const bill of older) {
      if (!['settled', 'cancelled'].includes(bill.status)) {
        await settleBill(client, bill.id);
        summary.settled_older += 1;
      }
      summary.splits_waived += await waiveOpenSplits(client, bill.id, waivedBy);
    }

    const { rows: latestSplits } = await client.query(
      `SELECT status FROM utility_bill_splits WHERE bill_id = $1`,
      [latest.id]
    );
    const allPaid =
      latestSplits.length > 0 && latestSplits.every((s) => s.status === 'paid');
    const hasCollectible = latestSplits.some((s) =>
      ['pending', 'notified', 'disputed', 'charging'].includes(s.status)
    );
    const allWaived =
      latestSplits.length > 0 && latestSplits.every((s) => s.status === 'waived');

    if (allPaid) {
      if (latest.status !== 'settled') {
        await client.query(
          `UPDATE utility_bills
              SET status = 'settled', settled_at = COALESCE(settled_at, NOW()), updated_at = NOW()
            WHERE id = $1`,
          [latest.id]
        );
      }
      continue;
    }

    if (allWaived || (latest.status === 'settled' && !hasCollectible) || !latestSplits.length) {
      await reopenLatestForCollection(client, latest);
      summary.latest_reopened += 1;
    } else if (!OPEN_BILL_STATUSES.includes(latest.status) && hasCollectible) {
      await client.query(
        `UPDATE utility_bills SET status = 'draft', settled_at = NULL, updated_at = NOW() WHERE id = $1`,
        [latest.id]
      );
      summary.latest_reopened += 1;
    }
  }

  return summary;
}

module.exports = {
  enforceLatestCollectible,
  RESOLVED_NOTE,
};
