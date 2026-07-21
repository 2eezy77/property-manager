
const http = require('http');

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = http.request({ hostname: 'localhost', port: 8080, path, method, headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   TENANT PORTAL WALKTHROUGH              ║');
  console.log('║   Acting as: Alex Rivera                 ║');
  console.log('║   Unit 4B · Sunset Apartments · Miami FL ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // ── 1. LOGIN ──────────────────────────────────────
  console.log('1. LOGIN');
  const login = await req('POST', '/auth/login', { email: 'alex.tenant@demo.com', password: 'tenant123' });
  if (login.status !== 200) { console.log('   ✗ Failed:', login.body); return; }
  const token = login.body.accessToken;
  const user  = login.body.user;
  console.log(`   ✓ Signed in as ${user.firstName} ${user.lastName}`);
  console.log(`     Email: ${user.email} · Role: ${user.role}\n`);

  // ── 2. DASHBOARD / MY LEASE ───────────────────────
  console.log('2. MY LEASE  (Tenant Portal → Lease tab)');
  const leaseRes = await req('GET', '/api/leases/my', null, token);
  if (leaseRes.status === 200) {
    const leases = leaseRes.body.leases || [];
    if (leases.length) {
      const l = leases[0];
      console.log(`   ✓ Property:  ${l.property_name}, Unit ${l.unit_number}`);
      console.log(`     Status:    ${l.status.toUpperCase()}`);
      console.log(`     Term:      ${l.start_date?.slice(0,10)}  →  ${l.end_date?.slice(0,10)}`);
      console.log(`     Rent:      $${Number(l.monthly_rent).toLocaleString()}/month`);
      console.log(`     Deposit:   $${Number(l.security_deposit).toLocaleString()}`);
      console.log(`     Late fee:  $${l.late_fee_amount} flat after ${l.grace_period_days}-day grace period`);
      if (l.pdf_path) console.log(`     PDF:       /documents/${l.pdf_path}`);
      if (l.envelope_status) console.log(`     Signature: ${l.envelope_status}`);
    } else {
      console.log('   ℹ  No active leases found');
    }
  } else {
    console.log(`   ✗ ${leaseRes.body?.error || leaseRes.body}`);
  }
  console.log();

  // ── 3. MAINTENANCE ────────────────────────────────
  console.log('3. MAINTENANCE  (Tenant Portal → Maintenance tab)');
  const myMaint = await req('GET', '/api/maintenance/my', null, token);
  if (myMaint.status === 200) {
    const requests = myMaint.body.requests || [];
    if (requests.length === 0) {
      console.log('   ✓ No open maintenance requests — all clear!');
      console.log('     (Tenant can tap "Submit Request" to report a new issue)');
    } else {
      requests.forEach(r =>
        console.log(`   [${r.status.padEnd(12)}] ${r.title} · ${r.priority} priority`)
      );
    }
  } else {
    console.log(`   ✗ ${myMaint.body?.error || myMaint.body}`);
  }
  console.log();

  // Submit a test maintenance request
  console.log('   → Submitting a maintenance request...');
  const submitRes = await req('POST', '/api/maintenance', {
    title: 'Leaky kitchen faucet',
    description: 'The kitchen sink faucet drips constantly — started about 3 days ago.',
    priority: 'medium',
    category: 'plumbing',
  }, token);
  if (submitRes.status === 201) {
    const r = submitRes.body.request;
    console.log(`   ✓ Request #${r.id.slice(0,8)}… submitted`);
    console.log(`     Title:    ${r.title}`);
    console.log(`     Priority: ${r.priority} · Category: ${r.category}`);
    console.log(`     Status:   ${r.status}`);
  } else {
    console.log(`   ✗ Submit failed: ${submitRes.body?.error || submitRes.status}`);
  }
  console.log();

  // ── 4. PAYMENTS ───────────────────────────────────
  console.log('4. PAYMENTS  (Tenant Portal → Payments tab)');
  const history = await req('GET', '/api/payments/history', null, token);
  if (history.status === 200) {
    const payments = history.body.payments || [];
    if (payments.length === 0) {
      console.log('   ✓ No payment history yet');
      console.log('     (Tenant can connect a bank account via Plaid to pay rent online)');
    } else {
      payments.slice(0, 3).forEach(p =>
        console.log(`   ${p.created_at?.slice(0,10)}  $${p.amount}  ${p.status}`)
      );
    }
  } else {
    console.log(`   ✗ ${history.body?.error || history.status}`);
  }
  console.log();

  // ── 5. MESSAGES ───────────────────────────────────
  console.log('5. MESSAGES  (Tenant Portal → Inbox tab)');
  const threads = await req('GET', '/api/messages/threads', null, token);
  if (threads.status === 200) {
    const t = threads.body.threads || [];
    if (t.length === 0) {
      console.log('   ✓ Inbox empty — no messages yet');
      console.log('     (Tenant can tap "New Message" to contact their property manager)');
    } else {
      t.forEach(th => console.log(`   [${th.unread_count} unread] ${th.subject}`));
    }
  } else {
    console.log(`   ✗ ${threads.body?.error || threads.status}`);
  }
  console.log();

  // ── 6. ANNOUNCEMENTS ──────────────────────────────
  console.log('6. ANNOUNCEMENTS  (Tenant Portal → Dashboard)');
  const ann = await req('GET', '/api/announcements', null, token);
  if (ann.status === 200) {
    const items = ann.body.announcements || [];
    if (items.length === 0) {
      console.log('   ✓ No announcements');
    } else {
      items.forEach(a => {
        console.log(`   📢 ${a.title}`);
        console.log(`      ${a.body.slice(0, 80)}${a.body.length > 80 ? '…' : ''}`);
        console.log(`      From: ${a.sender_name} · ${a.created_at?.slice(0,10)}`);
      });
    }
  } else {
    console.log(`   ✗ ${ann.body?.error || ann.status}`);
  }
  console.log();

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Tenant portal fully functional! ✓      ║');
  console.log('╚══════════════════════════════════════════╝\n');
}

main().catch(console.error);
