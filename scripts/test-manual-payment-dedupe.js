#!/usr/bin/env node
/**
 * Regression: after an owner-rejected / withdrawn off-site Cash App row, the same
 * external_reference must not re-credit (including partial_rent imports).
 */
const assert = require('assert');
const { recordManualPayment } = require('../src/services/manual-payment.service');

function mockDb({ existing = [] } = {}) {
  const state = { existing: existing.map((r) => ({ ...r, metadata: { ...(r.metadata || {}) } })) };
  return {
    state,
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim();

      if (text.includes("status = 'succeeded'") && text.includes("partial_rent") && text.includes('<>')) {
        // Full-month duplicate check
        const rows = state.existing.filter(
          (p) =>
            p.lease_id === params[0] &&
            p.payment_type === params[1] &&
            String(p.period_start).slice(0, 10) === String(params[2]).slice(0, 10) &&
            p.status === 'succeeded' &&
            String(p.metadata?.partial_rent) !== 'true'
        );
        return { rows };
      }

      if (text.includes('owner_rejected_offsite') && text.includes('external_reference')) {
        const tenantId = params[0];
        const paymentType = params[1];
        const ref = params[2];
        const rows = state.existing.filter((p) => {
          if (p.tenant_id !== tenantId || p.payment_type !== paymentType) return false;
          const blocked =
            p.status === 'succeeded' ||
            p.metadata?.owner_rejected_offsite === true ||
            p.metadata?.owner_rejected_offsite === 'true' ||
            p.metadata?.withdrawn_offsite === true ||
            p.metadata?.withdrawn_offsite === 'true';
          if (!blocked) return false;
          const xref = String(p.metadata?.external_reference || '');
          return xref === ref || xref.includes(ref);
        });
        return { rows: rows.slice(0, 1) };
      }

      if (text.includes("partial_rent' = 'true'")) {
        const rows = state.existing.filter(
          (p) =>
            p.lease_id === params[0] &&
            p.payment_type === params[1] &&
            String(p.period_start).slice(0, 10) === String(params[2]).slice(0, 10) &&
            String(p.metadata?.partial_rent) === 'true' &&
            String(p.metadata?.external_reference || '') === String(params[3] || '') &&
            (p.status === 'succeeded' ||
              p.metadata?.owner_rejected_offsite === true ||
              p.metadata?.withdrawn_offsite === true)
        );
        return { rows };
      }

      if (text.includes("status IN ('pending','processing')")) {
        return { rows: [] };
      }

      if (text.startsWith('INSERT INTO payments')) {
        const id = `pay-${state.existing.length + 1}`;
        state.existing.push({
          id,
          lease_id: params[0],
          tenant_id: params[1],
          amount: params[2],
          payment_type: params[3],
          period_start: params[4],
          period_end: params[5],
          status: 'succeeded',
          metadata: typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7],
        });
        return { rows: [{ id }] };
      }

      if (text.startsWith('UPDATE late_fees')) {
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unexpected SQL: ${text.slice(0, 120)}`);
    },
  };
}

async function run() {
  const withdrawnRef = 'CASHAPP-VOID-AUG';

  {
    const db = mockDb({
      existing: [
        {
          id: 'void-1',
          lease_id: 'lease-1',
          tenant_id: 'tenant-1',
          payment_type: 'rent',
          period_start: '2026-08-01',
          status: 'failed',
          metadata: {
            external_reference: withdrawnRef,
            withdrawn_offsite: 'true',
            partial_rent: 'true',
          },
        },
      ],
    });

    const result = await recordManualPayment(db, {
      leaseId: 'lease-1',
      tenantId: 'tenant-1',
      amount: 450,
      paidAt: '2026-08-03',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      reference: withdrawnRef,
      allowPartial: true,
      metadataExtra: { source: 'cash_app_import', partial_rent: true },
    });

    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.reason, 'duplicate_external_reference');
    assert.strictEqual(result.paymentId, 'void-1');
    assert.strictEqual(db.state.existing.length, 1, 'must not insert a second credit');
  }

  {
    const db = mockDb({
      existing: [
        {
          id: 'reject-1',
          lease_id: 'lease-1',
          tenant_id: 'tenant-1',
          payment_type: 'rent',
          period_start: '2026-08-01',
          status: 'failed',
          metadata: {
            external_reference: 'TXN-A, TXN-B',
            owner_rejected_offsite: 'true',
          },
        },
      ],
    });

    const result = await recordManualPayment(db, {
      leaseId: 'lease-1',
      tenantId: 'tenant-1',
      amount: 900,
      paidAt: '2026-08-04',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      reference: 'TXN-B',
      allowPartial: false,
    });

    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.reason, 'duplicate_external_reference');
  }

  {
    const db = mockDb({ existing: [] });
    const result = await recordManualPayment(db, {
      leaseId: 'lease-1',
      tenantId: 'tenant-1',
      amount: 900,
      paidAt: '2026-08-05',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      reference: 'BRAND-NEW-TXN',
    });
    assert.strictEqual(result.skipped, false);
    assert.ok(result.paymentId);
    assert.strictEqual(db.state.existing.length, 1);
  }

  console.log('test-manual-payment-dedupe: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
