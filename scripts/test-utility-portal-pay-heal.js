/**
 * Regression: portal-pay heal + collectible settle must not double-charge
 * or wipe payment-linked / charging splits (PR #37 follow-up coverage).
 *
 * Pure fake-client unit tests — no DB.
 * Run: npm run test:utility-portal-pay-heal
 */
const assert = require('assert');
const {
  backfillSplitNotifications,
  healPendingSplitsForBill,
} = require('../src/use-cases/utilities/notify-splits');
const {
  waiveOpenSplits,
  reopenLatestForCollection,
} = require('../src/use-cases/utilities/enforce-latest-collectible');
const {
  upsertBillSplits,
} = require('../src/use-cases/utilities/domain');
const {
  prepareUtilityPortalCharge,
} = require('../src/services/utility-portal-charge.service');

/** Minimal fake pg client capturing SQL + returning scripted rows. */
function makeFakeClient(script) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      const step = script[i++];
      if (!step) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof step === 'function') return step(sql, params);
      return step;
    },
  };
}

async function main() {
  // Heal: pending → notified only when payment_id IS NULL, then backfill in-app notify
  {
    const billId = 'bill-heal';
    const splitNew = 'split-new';
    const splitExisting = 'split-existing';
    const client = makeFakeClient([
      { rows: [], rowCount: 2 }, // UPDATE pending → notified
      {
        rows: [
          {
            split_id: splitNew,
            tenant_id: 't1',
            amount: '51.07',
            service_type: 'electric',
            period_start: '2026-06-17',
            period_end: '2026-07-16',
          },
          {
            split_id: splitExisting,
            tenant_id: 't2',
            amount: '17.34',
            service_type: 'electric',
            period_start: '2026-06-17',
            period_end: '2026-07-16',
          },
        ],
      },
      { rows: [] }, // no notification for t1
      { rows: [], rowCount: 1 }, // INSERT notification t1
      { rows: [{ '?column?': 1 }] }, // existing notification for t2
    ]);

    const healed = await healPendingSplitsForBill(client, billId);
    assert.strictEqual(healed, 2);

    const update = client.calls[0];
    assert.ok(update.sql.includes("status = 'notified'"));
    assert.ok(update.sql.includes("status = 'pending'"));
    assert.ok(update.sql.includes('payment_id IS NULL'));
    assert.strictEqual(update.params[0], billId);

    const inserts = client.calls.filter((c) => c.sql.startsWith('INSERT INTO notifications'));
    assert.strictEqual(inserts.length, 1, 'only missing in-app notify is inserted');
    assert.strictEqual(inserts[0].params[0], 't1');
    assert.strictEqual(inserts[0].params[3], splitNew);
    assert.ok(String(inserts[0].params[2]).includes('51.07'));
  }

  // backfill: skips waived/paid selection via query filter (paid/waived not returned)
  {
    const client = makeFakeClient([
      { rows: [] },
    ]);
    await backfillSplitNotifications(client, 'bill-empty');
    assert.strictEqual(client.calls.length, 1);
    assert.ok(client.calls[0].sql.includes("status NOT IN ('waived', 'paid')"));
  }

  // waiveOpenSplits: never touch payment-linked or charging rows
  {
    const client = makeFakeClient([{ rows: [], rowCount: 3 }]);
    const n = await waiveOpenSplits(client, 'old-bill', 'owner-1');
    assert.strictEqual(n, 3);
    const sql = client.calls[0].sql;
    assert.ok(sql.includes('payment_id IS NULL'), 'must skip payment-linked splits');
    assert.ok(sql.includes("'charging'"), 'must not waive charging splits mid-pay');
    assert.ok(sql.includes("'paid'"));
    assert.deepStrictEqual(client.calls[0].params, ['old-bill', 'owner-1']);
  }

  // reopenLatestForCollection: notified bill reopens waived as notified; payment_id gated
  {
    const client = makeFakeClient([
      {
        rows: [
          { id: 's1', status: 'waived', payment_id: null },
          { id: 's2', status: 'waived', payment_id: 'pay-keep' },
        ],
      },
      { rows: [], rowCount: 1 },
    ]);
    await reopenLatestForCollection(client, {
      id: 'latest',
      status: 'notified',
      property_id: 'p1',
      period_start: '2026-06-17',
      period_end: '2026-07-16',
      total_amount: 100,
    });
    const reopenUpdate = client.calls.find((c) =>
      c.sql.startsWith('UPDATE utility_bill_splits')
    );
    assert.ok(reopenUpdate);
    assert.strictEqual(reopenUpdate.params[1], 'notified');
    assert.ok(reopenUpdate.sql.includes('payment_id IS NULL'));
    assert.ok(reopenUpdate.sql.includes("status = 'waived'"));
  }

  // reopenLatestForCollection: draft/settled latest inserts as pending when no splits
  {
    const client = makeFakeClient([
      { rows: [] }, // existing splits
      // loadActiveLeases
      {
        rows: [
          {
            id: 'lease-a',
            tenant_id: 't-a',
            start_date: '2025-01-01',
            end_date: '2027-01-01',
            unit_id: null,
          },
        ],
      },
      { rows: [], rowCount: 1 }, // INSERT split
      { rows: [], rowCount: 1 }, // reopen bill → draft
    ]);
    await reopenLatestForCollection(client, {
      id: 'latest-empty',
      status: 'settled',
      property_id: 'p1',
      period_start: '2026-07-01',
      period_end: '2026-07-31',
      total_amount: 90,
    });
    const insert = client.calls.find((c) => c.sql.startsWith('INSERT INTO utility_bill_splits'));
    assert.ok(insert, 'expected split insert when none exist');
    assert.strictEqual(insert.params[4], 'pending');
  }

  // Upsert preserves disputed/failed status (do not reset to notified)
  {
    const disputedId = 'disputed-1';
    const leaseId = 'lease-d';
    const client = makeFakeClient([
      {
        rows: [
          {
            id: disputedId,
            lease_id: leaseId,
            tenant_id: 't-d',
            amount: '20.00',
            status: 'disputed',
            payment_id: null,
          },
        ],
      },
      { rows: [], rowCount: 1 },
    ]);
    const result = await upsertBillSplits(
      client,
      { id: 'bill-d', status: 'notified' },
      [{ leaseId, tenantId: 't-d', amount: '22.50' }]
    );
    assert.strictEqual(result.updated, 1);
    const update = client.calls.find((c) => c.sql.startsWith('UPDATE utility_bill_splits'));
    assert.strictEqual(update.params[3], 'disputed');
  }

  // Upsert deletes orphan open lease; never deletes paid
  {
    const paidId = 'paid-keep';
    const orphanId = 'orphan-open';
    const client = makeFakeClient([
      {
        rows: [
          {
            id: paidId,
            lease_id: 'lease-paid',
            tenant_id: 't1',
            amount: '10',
            status: 'paid',
            payment_id: 'pay-1',
          },
          {
            id: orphanId,
            lease_id: 'lease-gone',
            tenant_id: 't2',
            amount: '10',
            status: 'pending',
            payment_id: null,
          },
        ],
      },
      { rows: [], rowCount: 1 }, // DELETE orphan
    ]);
    const result = await upsertBillSplits(
      client,
      { id: 'bill-o', status: 'notified' },
      [{ leaseId: 'lease-paid', tenantId: 't1', amount: '10' }]
    );
    assert.strictEqual(result.deleted, 1);
    assert.strictEqual(result.skippedFrozen, 1);
    assert.ok(
      client.calls.some((c) => c.sql.startsWith('DELETE FROM utility_bill_splits') && c.params[0] === orphanId)
    );
    assert.ok(
      !client.calls.some((c) => c.sql.startsWith('DELETE FROM utility_bill_splits') && c.params[0] === paidId)
    );
  }

  // prepareUtilityPortalCharge: post-lock recheck rejects already-claimed payment_id
  {
    const leaseId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const tenantId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const client = makeFakeClient([
      { rows: [{ id: leaseId, tenant_id: tenantId, status: 'active' }] },
      {
        rows: [
          {
            split_id: 'split-claimed',
            lease_id: leaseId,
            tenant_id: tenantId,
            amount: '51.07',
            split_status: 'notified',
            payment_id: 'already-taken',
            bill_id: 'bill-e',
            service_type: 'electric',
            provider_name: 'Dominion',
            period_start: '2026-06-17',
            period_end: '2026-07-16',
            due_date: '2026-08-14',
            bill_status: 'notified',
            property_name: '743',
          },
        ],
      },
    ]);

    let err;
    try {
      await prepareUtilityPortalCharge(client, { tenantId, leaseId });
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'expected NOTHING_DUE when payment_id already set after lock');
    assert.strictEqual(err.code, 'NOTHING_DUE');
    assert.ok(
      !client.calls.some((c) => c.sql.startsWith('INSERT INTO payments')),
      'must not create a payment after claim recheck fails'
    );
  }

  console.log('test-utility-portal-pay-heal OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
