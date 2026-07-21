/**
 * End-to-end smoke test — auth, utilities UCs, Gmail, RBAC, tenant flows.
 * Usage: npm run smoke:test
 */

const pool = require('../src/db/client');
const {
  BASE, ACCOUNTS, createReporter, req, login, section,
} = require('./lib/test-helpers');

const { ok, fail, skip, printSummary } = createReporter();

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  PROPERTY MANAGER — FULL SMOKE TEST                  ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  // Health
  await section('0. Server health', async () => {
    try {
      const r = await req('GET', '/api/utilities/bills');
      r.status === 401 ? ok('Server reachable (401 without token)') : fail('Expected 401', r.status);
    } catch (e) {
      fail('Server not reachable', e.message);
      process.exit(1);
    }
  });

  const tokens = {};
  await section('1. Auth — all roles', async () => {
    for (const [role, account] of Object.entries(ACCOUNTS)) {
      const { email, pw } = typeof account === 'string' ? { email: account, pw: PW } : account;
      try {
        tokens[role] = await login(email, pw);
        ok(`${role} login (${email})`);
      } catch (e) {
        fail(`${role} login`, e.message);
      }
    }
    const me = await req('GET', '/auth/me', null, tokens.owner);
    me.status === 200 && me.body.user?.role === 'owner'
      ? ok('/auth/me returns owner role')
      : fail('/auth/me', JSON.stringify(me.body));
  });

  let propertyId;
  await section('2. Properties & tenants (staff)', async () => {
    const r = await req('GET', '/api/properties', null, tokens.owner);
    if (r.status !== 200 || !r.body.properties?.length) {
      fail('GET /api/properties', JSON.stringify(r.body));
      return;
    }
    propertyId = r.body.properties.find(p => p.address_line1?.includes('743'))?.id
      || r.body.properties[0].id;
    ok(`Properties list (${r.body.properties.length}) — using ${propertyId.slice(0, 8)}…`);

    const tr = await req('GET', '/api/tenants', null, tokens.manager);
    tr.status === 200 ? ok(`Tenants list (${(tr.body.tenants || tr.body).length || 'ok'})`) : fail('GET /api/tenants', tr.status);

    const lr = await req('GET', '/api/leases', null, tokens.manager);
    lr.status === 200 ? ok('Leases list') : fail('GET /api/leases', lr.status);
  });

  await section('3. RBAC boundaries', async () => {
    const t = await req('GET', '/api/utilities/bills', null, tokens.tenant1);
    t.status === 403 ? ok('Tenant blocked from staff bills') : fail('Tenant should be 403 on bills', t.status);

    const gc = await req('GET', '/api/utilities/gmail/connect', null, tokens.manager);
    gc.status === 403 ? ok('Property manager blocked from Gmail connect (UC8)') : fail('Manager should not connect Gmail', gc.status);

    const gco = await req('GET', '/api/utilities/gmail/connect', null, tokens.owner);
    gco.status === 200 && gco.body.url?.includes('google') ? ok('Owner can start Gmail OAuth URL') : fail('Owner Gmail connect', JSON.stringify(gco.body));

    const gs = await req('GET', '/api/utilities/gmail/status', null, tokens.manager);
    gs.status === 200 && gs.body.shared && gs.body.connected === gs.body.connected
      ? ok(`Manager sees org Gmail status (connected=${gs.body.connected})`)
      : fail('Gmail status for manager', JSON.stringify(gs.body));
  });

  let draftBillId;
  await section('4. UC01 — Create utility bill', async () => {
    if (!propertyId) { skip('UC01', 'no property'); return; }
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
    const due = new Date(today.getFullYear(), today.getMonth() + 1, 15).toISOString().slice(0, 10);

    const r = await req('POST', '/api/utilities/bills', {
      property_id: propertyId,
      service_type: 'water',
      provider_name: 'Smoke Test HRSD',
      period_start: start,
      period_end: end,
      total_amount: 90.00,
      due_date: due,
      notes: 'Automated smoke test bill — safe to delete',
    }, tokens.owner);

    if (r.status !== 201) {
      fail('UC01 create bill', `${r.status} ${JSON.stringify(r.body)}`);
      return;
    }
    draftBillId = r.body.bill?.id;
    const splits = r.body.splits || [];
    const sum = splits.reduce((a, s) => a + Number(s.amount), 0);
    Math.abs(sum - 90) < 0.02 && splits.length >= 1
      ? ok(`UC01 created draft with ${splits.length} splits summing $${sum.toFixed(2)}`)
      : fail('UC01 split math', `splits=${splits.length} sum=${sum}`);
  });

  await section('5. UC02 — Preview bill', async () => {
    if (!draftBillId) { skip('UC02', 'no draft bill'); return; }
    const r = await req('GET', `/api/utilities/bills/${draftBillId}`, null, tokens.manager);
    r.status === 200 && r.body.splits?.length
      ? ok(`UC02 manager can preview bill (${r.body.splits.length} splits)`)
      : fail('UC02 preview', r.status);
    const bad = await req('GET', `/api/utilities/bills/${draftBillId}`, null, tokens.tenant1);
    bad.status === 403 ? ok('Tenant cannot preview staff bill detail') : fail('Tenant bill access', bad.status);
  });

  await section('6. UC03 — Notify tenants', async () => {
    if (!draftBillId) { skip('UC03', 'no draft bill'); return; }
    const r = await req('POST', `/api/utilities/bills/${draftBillId}/notify`, {}, tokens.manager);
    r.status === 200 && r.body.bill?.status === 'notified'
      ? ok('UC03 bill notified + dispute deadline set')
      : fail('UC03 notify', `${r.status} ${JSON.stringify(r.body?.bill?.status)}`);
    const again = await req('POST', `/api/utilities/bills/${draftBillId}/notify`, {}, tokens.manager);
    again.status === 409 ? ok('UC03 idempotent — cannot re-notify draft') : fail('Re-notify should 409', again.status);
  });

  let splitId;
  await section('7. UC04 — Tenant dispute', async () => {
    const ms = await req('GET', '/api/utilities/my-splits', null, tokens.tenant1);
    if (ms.status !== 200) { fail('GET my-splits', ms.status); return; }
    const open = (ms.body.splits || []).find(s => s.bill_id === draftBillId && s.status === 'notified');
    if (!open) {
      skip('UC04 dispute', 'no notified split for tenant1 on test bill');
      return;
    }
    splitId = open.id;
    const r = await req('POST', `/api/utilities/splits/${splitId}/dispute`, { reason: 'Smoke test dispute — amount seems high' }, tokens.tenant1);
    r.status === 200 && r.body.split?.status === 'disputed'
      ? ok('UC04 tenant disputed share')
      : fail('UC04 dispute', JSON.stringify(r.body));
    const noReason = await req('POST', `/api/utilities/splits/${splitId}/dispute`, { reason: '' }, tokens.tenant1);
    noReason.status === 400 ? ok('UC04 requires reason') : fail('Missing reason should 400', noReason.status);
  });

  await section('8. UC05 — Resolve dispute', async () => {
    if (!splitId) { skip('UC05', 'no disputed split'); return; }
    const reject = await req('POST', `/api/utilities/splits/${splitId}/reject-dispute`, {}, tokens.owner);
    reject.status === 200 ? ok('UC5b manager rejected dispute → notified') : fail('UC5b reject', reject.status);

    await req('POST', `/api/utilities/splits/${splitId}/dispute`, { reason: 'Second smoke dispute' }, tokens.tenant1);
    const waive = await req('POST', `/api/utilities/splits/${splitId}/waive`, {}, tokens.owner);
    waive.status === 200 ? ok('UC5a manager waived share') : fail('UC5a waive', waive.status);
  });

  await section('9. UC06 — Charge (expect skips without bank)', async () => {
    if (!draftBillId) { skip('UC06', 'no bill'); return; }
    const r = await req('POST', `/api/utilities/bills/${draftBillId}/charge`, { force: true }, tokens.owner);
    if (r.status !== 202) {
      fail('UC06 charge endpoint', `${r.status} ${JSON.stringify(r.body)}`);
      return;
    }
    ok(`UC06 charge ran — charged=${r.body.charged?.length || 0} skipped=${r.body.skipped?.length || 0}`);
    if (r.body.skipped?.length) {
      ok(`UC06 skip reasons: ${[...new Set(r.body.skipped.map(s => s.reason))].join(', ')}`);
    }
  });

  await section('10. UC09 — Gmail import', async () => {
    const r = await req('POST', '/api/utilities/gmail/import', { max_messages: 5 }, tokens.manager);
    if (r.status === 401 && r.body.error === 'NOT_CONNECTED') {
      skip('UC09 import', 'Gmail not connected');
      return;
    }
    if (r.status !== 200) {
      fail('UC09 import', `${r.status} ${JSON.stringify(r.body)}`);
      return;
    }
    ok(`UC09 scanned=${r.body.scanned} created=${r.body.created?.length || 0} skipped=${r.body.skipped?.length || 0} errors=${r.body.errors?.length || 0}`);
    if (r.body.errors?.length) {
      r.body.errors.forEach(e => fail('UC09 message error', `${e.message_id}: ${e.error}`));
    }
  });

  await section('11. Tenant portal flows', async () => {
    const lease = await req('GET', '/api/leases/my', null, tokens.tenant2);
    lease.status === 200 ? ok('Tenant lease') : fail('Tenant lease', lease.status);

    const maint = await req('GET', '/api/maintenance/my', null, tokens.tenant2);
    maint.status === 200 ? ok('Tenant maintenance list') : fail('Maintenance', maint.status);

    const pay = await req('GET', '/api/payments/history', null, tokens.tenant2);
    pay.status === 200 ? ok('Tenant payment history') : fail('Payments', pay.status);

    const msg = await req('GET', '/api/messages/threads', null, tokens.tenant2);
    msg.status === 200 ? ok('Tenant messages') : fail('Messages', msg.status);

    const ann = await req('GET', '/api/announcements', null, tokens.tenant2);
    ann.status === 200 ? ok('Tenant announcements') : fail('Announcements', ann.status);

    const lt = await req('POST', '/api/payments/plaid/link-token', null, tokens.tenant1);
    lt.status === 200 && lt.body.linkToken?.startsWith('link-')
      ? ok('Tenant Plaid link-token')
      : fail('Tenant Plaid link-token', `${lt.status} ${JSON.stringify(lt.body).slice(0, 120)}`);
  });

  await section('12. Manager dashboard data', async () => {
    const bills = await req('GET', '/api/utilities/bills?status=draft', null, tokens.owner);
    bills.status === 200 ? ok(`Owner lists bills (${bills.body.bills?.length || 0})`) : fail('Owner bills', bills.status);

    const mq = await req('GET', '/api/maintenance', null, tokens.manager);
    mq.status === 200 ? ok('Manager maintenance queue') : fail('Maintenance queue', mq.status);

    const pay = await req('GET', '/api/payments/manager', null, tokens.manager);
    pay.status === 200 ? ok('Manager payments view') : fail('Manager payments', pay.status);

    const health = await req('GET', '/api/payments/health', null, tokens.manager);
    if (health.status === 200 && health.body.ok) {
      ok(`Payment stack health (${health.body.summary.pass} pass, ${health.body.summary.warn} warn)`);
    } else if (health.status === 503 && health.body.summary) {
      fail('Payment stack health', `${health.body.summary.fail} fail, ${health.body.summary.warn} warn`);
    } else {
      fail('Payment stack health', `${health.status} ${JSON.stringify(health.body).slice(0, 120)}`);
    }
  });

  await section('13. Validation edge cases', async () => {
    const bad = await req('POST', '/api/utilities/bills', { property_id: propertyId }, tokens.owner);
    bad.status === 400 ? ok('Create bill rejects missing fields') : fail('Should 400', bad.status);

    const amt = await req('POST', '/api/utilities/bills', {
      property_id: propertyId, service_type: 'gas', period_start: '2026-01-01',
      period_end: '2026-01-31', total_amount: -5, due_date: '2026-02-01',
    }, tokens.owner);
    amt.status === 400 ? ok('Create bill rejects negative amount') : fail('Negative amount', amt.status);

    const noAuth = await req('GET', '/api/utilities/bills');
    noAuth.status === 401 ? ok('Unauthenticated blocked') : fail('Should 401', noAuth.status);
  });

  // Cleanup smoke test bill
  if (draftBillId) {
    try {
      await pool.query(`DELETE FROM utility_bill_splits WHERE bill_id = $1`, [draftBillId]);
      await pool.query(`DELETE FROM utility_bills WHERE id = $1 AND notes LIKE '%smoke test%'`, [draftBillId]);
      ok('Cleaned up smoke test bill');
    } catch { /* ignore */ }
  }

  await pool.end();

  printSummary('SMOKE TEST');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
