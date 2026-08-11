/**
 * Unit tests: safe utility split refresh + no double-charge helpers.
 * Run: node scripts/test-utility-split-refresh-safety.js
 */
const assert = require('assert');
const {
  defaultOpenSplitStatus,
  isFrozenSplitRow,
  upsertBillSplits,
} = require('../src/use-cases/utilities/domain');
const {
  PAYABLE_SPLIT_STATUSES,
  summarizeOpenUtilities,
  prepareUtilityPortalCharge,
} = require('../src/services/utility-portal-charge.service');

assert.strictEqual(defaultOpenSplitStatus('draft'), 'pending');
assert.strictEqual(defaultOpenSplitStatus('notified'), 'notified');
assert.strictEqual(defaultOpenSplitStatus('charging'), 'notified');
assert.strictEqual(defaultOpenSplitStatus('settled'), 'pending');

assert.strictEqual(isFrozenSplitRow({ status: 'paid', payment_id: null }), true);
assert.strictEqual(isFrozenSplitRow({ status: 'charging', payment_id: 'p1' }), true);
assert.strictEqual(isFrozenSplitRow({ status: 'waived', payment_id: null }), true);
assert.strictEqual(isFrozenSplitRow({ status: 'notified', payment_id: 'p1' }), true);
assert.strictEqual(isFrozenSplitRow({ status: 'notified', payment_id: null }), false);
assert.strictEqual(isFrozenSplitRow({ status: 'pending', payment_id: null }), false);
assert.strictEqual(isFrozenSplitRow({ status: 'failed', payment_id: null }), false);

assert.ok(PAYABLE_SPLIT_STATUSES.includes('pending'));
assert.ok(PAYABLE_SPLIT_STATUSES.includes('notified'));
assert.ok(!PAYABLE_SPLIT_STATUSES.includes('paid'));
assert.ok(!PAYABLE_SPLIT_STATUSES.includes('charging'));
assert.ok(!PAYABLE_SPLIT_STATUSES.includes('waived'));

{
  const summary = summarizeOpenUtilities([
    {
      split_id: 's1',
      bill_id: 'b1',
      lease_id: 'l1',
      amount: 51.07,
      split_status: 'pending',
      service_type: 'electric',
      provider_name: 'Dominion',
      period_start: '2026-06-17',
      period_end: '2026-07-16',
      due_date: '2026-08-14',
      property_name: '743 A Ave',
    },
  ]);
  assert.strictEqual(summary.utilityDue, 51.07);
  assert.strictEqual(summary.utilitySplits[0].status, 'pending');
}

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
  // Upsert: paid row preserved; open row amount/status updated; no DELETE of paid
  {
    const paidId = '11111111-1111-1111-1111-111111111111';
    const openId = '22222222-2222-2222-2222-222222222222';
    const leasePaid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const leaseOpen = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const client = makeFakeClient([
      {
        rows: [
          {
            id: paidId,
            lease_id: leasePaid,
            tenant_id: 't1',
            amount: '95.76',
            status: 'paid',
            payment_id: 'pay-1',
          },
          {
            id: openId,
            lease_id: leaseOpen,
            tenant_id: 't2',
            amount: '40.00',
            status: 'pending',
            payment_id: null,
          },
        ],
      },
      { rows: [], rowCount: 1 }, // UPDATE open
    ]);

    const bill = { id: 'bill-1', status: 'notified' };
    const computed = [
      { leaseId: leasePaid, tenantId: 't1', amount: '99.00' },
      { leaseId: leaseOpen, tenantId: 't2', amount: '51.07' },
    ];

    const result = await upsertBillSplits(client, bill, computed);
    assert.strictEqual(result.updated, 1);
    assert.strictEqual(result.inserted, 0);
    assert.strictEqual(result.deleted, 0);
    assert.strictEqual(result.skippedFrozen, 1);

    const updateCall = client.calls.find((c) => c.sql.startsWith('UPDATE utility_bill_splits'));
    assert.ok(updateCall, 'expected UPDATE of open split');
    assert.strictEqual(updateCall.params[0], openId);
    assert.strictEqual(updateCall.params[1], '51.07');
    assert.strictEqual(updateCall.params[3], 'notified');

    assert.ok(
      !client.calls.some((c) => c.sql.startsWith('DELETE FROM utility_bill_splits') && c.params[0] === paidId),
      'must not delete paid split'
    );
    assert.ok(
      !client.calls.some((c) => c.sql.startsWith('UPDATE utility_bill_splits') && c.params[0] === paidId),
      'must not update paid split'
    );
  }

  // Upsert: all frozen → no churn
  {
    const client = makeFakeClient([
      {
        rows: [
          {
            id: 'p1',
            lease_id: 'l1',
            tenant_id: 't1',
            amount: '10',
            status: 'paid',
            payment_id: 'pay',
          },
        ],
      },
    ]);
    const result = await upsertBillSplits(
      client,
      { id: 'b', status: 'notified' },
      [{ leaseId: 'l1', tenantId: 't1', amount: '12' }]
    );
    assert.strictEqual(result.skippedFrozen, 1);
    assert.strictEqual(client.calls.length, 1); // only SELECT
  }

  // Upsert: insert missing lease as notified when bill notified
  {
    const client = makeFakeClient([
      { rows: [] },
      { rows: [], rowCount: 1 },
    ]);
    const result = await upsertBillSplits(
      client,
      { id: 'b', status: 'notified' },
      [{ leaseId: 'l-new', tenantId: 't-new', amount: '17.34' }]
    );
    assert.strictEqual(result.inserted, 1);
    const insert = client.calls.find((c) => c.sql.startsWith('INSERT INTO utility_bill_splits'));
    assert.ok(insert);
    assert.strictEqual(insert.params[4], 'notified');
  }

  // Second prepareUtilityPortalCharge blocked when claim UPDATE matches 0 rows
  {
    const leaseId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const tenantId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const splitId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const client = makeFakeClient([
      { rows: [{ id: leaseId, tenant_id: tenantId, status: 'active' }] },
      {
        rows: [
          {
            split_id: splitId,
            lease_id: leaseId,
            tenant_id: tenantId,
            amount: '51.07',
            split_status: 'notified',
            payment_id: null,
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
      { rows: [{ id: 'pay-new', amount: 51.07 }], rowCount: 1 },
      { rows: [], rowCount: 0 }, // claim lost the race
    ]);

    let err;
    try {
      await prepareUtilityPortalCharge(client, { tenantId, leaseId });
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'expected NOTHING_DUE when claim fails');
    assert.strictEqual(err.code, 'NOTHING_DUE');
  }

  console.log('test-utility-split-refresh-safety OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
