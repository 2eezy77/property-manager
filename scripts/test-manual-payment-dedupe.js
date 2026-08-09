#!/usr/bin/env node
/**
 * Regression: withdrawn/owner-rejected off-site Cash App xrefs must block re-import
 * (full or partial). Isaiah voided Aug Cash App must not re-credit.
 * Run: npm run test:manual-payment-dedupe
 */
const assert = require('assert');
const { recordManualPayment } = require('../src/services/manual-payment.service');

function mockDb(handlers) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      calls.push({ text, params });
      for (const h of handlers) {
        if (h.match(text, params)) return h.result(text, params);
      }
      throw new Error(`Unexpected SQL: ${text.slice(0, 140)}`);
    },
  };
}

async function run() {
  // Succeeded / rejected / withdrawn xref match → skip even with allowPartial
  for (const flag of ['owner_rejected_offsite', 'withdrawn_offsite']) {
    const db = mockDb([
      {
        match: (t) => t.includes("status = 'succeeded'") && t.includes("partial_rent"),
        result: () => ({ rows: [] }),
      },
      {
        match: (t) =>
          t.includes('external_reference') &&
          t.includes('owner_rejected_offsite') &&
          t.includes('withdrawn_offsite') &&
          t.includes('tenant_id'),
        result: () => ({ rows: [{ id: `pay-${flag}` }] }),
      },
    ]);

    const out = await recordManualPayment(db, {
      leaseId: 'lease-isaiah',
      tenantId: 'tenant-isaiah',
      amount: 450,
      paidAt: '2026-08-05',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      paymentMethod: 'cash_app',
      reference: 'CA-VOIDED-AUG',
      allowPartial: true,
      metadataExtra: { source: 'cash_app_import', partial_rent: true },
    });

    assert.deepStrictEqual(out, {
      skipped: true,
      reason: 'duplicate_external_reference',
      paymentId: `pay-${flag}`,
    });
    assert.ok(
      db.calls.some((c) => c.params.includes('CA-VOIDED-AUG')),
      'xref query must use the Cash App reference'
    );
  }

  // No xref hit + allowPartial → inserts succeeded partial
  {
    let inserted = false;
    const db = mockDb([
      {
        match: (t) => t.includes("status = 'succeeded'") && t.includes("partial_rent"),
        result: () => ({ rows: [] }),
      },
      {
        match: (t) =>
          t.includes('external_reference') &&
          t.includes('owner_rejected_offsite') &&
          t.includes('tenant_id'),
        result: () => ({ rows: [] }),
      },
      {
        match: (t) => t.includes("metadata->>'partial_rent' = 'true'"),
        result: () => ({ rows: [] }),
      },
      {
        match: (t) => t.includes("status IN ('pending','processing')"),
        result: () => ({ rows: [] }),
      },
      {
        match: (t) => t.startsWith('INSERT INTO payments'),
        result: () => {
          inserted = true;
          return { rows: [{ id: 'new-partial' }] };
        },
      },
      {
        match: (t) => t.startsWith('UPDATE late_fees'),
        result: () => ({ rows: [], rowCount: 0 }),
      },
    ]);

    const out = await recordManualPayment(db, {
      leaseId: 'lease-isaiah',
      tenantId: 'tenant-isaiah',
      amount: 450,
      paidAt: '2026-08-05',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      paymentMethod: 'cash_app',
      reference: 'CA-NEW-AUG',
      allowPartial: true,
      metadataExtra: { source: 'cash_app_import', partial_rent: true },
    });

    assert.deepStrictEqual(out, { skipped: false, paymentId: 'new-partial' });
    assert.ok(inserted);
  }

  // Comma-separated refs: any match blocks
  {
    const db = mockDb([
      {
        match: (t) => t.includes("status = 'succeeded'") && t.includes("partial_rent"),
        result: () => ({ rows: [] }),
      },
      {
        match: (t, params) =>
          t.includes('external_reference') &&
          t.includes('tenant_id') &&
          params.includes('REF-B'),
        result: () => ({ rows: [{ id: 'hit-b' }] }),
      },
      {
        match: (t) => t.includes('external_reference') && t.includes('tenant_id'),
        result: () => ({ rows: [] }),
      },
    ]);

    const out = await recordManualPayment(db, {
      leaseId: 'lease-1',
      tenantId: 'tenant-1',
      amount: 100,
      paidAt: '2026-08-05',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      paymentMethod: 'cash_app',
      reference: 'REF-A, REF-B',
      allowPartial: true,
    });

    assert.strictEqual(out.reason, 'duplicate_external_reference');
    assert.strictEqual(out.paymentId, 'hit-b');
  }

  console.log('test-manual-payment-dedupe: OK');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
