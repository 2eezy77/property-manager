/**
 * Announcements, inbox (messages), and maintenance smoke test.
 * Usage: npm run test:comms
 */
const pool = require('../src/db/client');
const {
  ACCOUNTS, createReporter, req, login, section,
} = require('./lib/test-helpers');

const TEST_TAG = 'comms-smoke-test';
const { ok, fail, printSummary } = createReporter();

async function cleanup() {
  await pool.query(
    `DELETE FROM notifications WHERE related_entity_id IN (
       SELECT id FROM announcements WHERE title LIKE $1
     )`,
    [`${TEST_TAG}%`]
  );
  await pool.query(`DELETE FROM announcements WHERE title LIKE $1`, [`${TEST_TAG}%`]);

  const { rows: threads } = await pool.query(
    `SELECT id FROM message_threads WHERE subject LIKE $1`,
    [`${TEST_TAG}%`]
  );
  for (const t of threads) {
    await pool.query(`DELETE FROM messages WHERE thread_id = $1`, [t.id]);
    await pool.query(`DELETE FROM message_threads WHERE id = $1`, [t.id]);
  }

  const { rows: mrs } = await pool.query(
    `SELECT id FROM maintenance_requests WHERE title LIKE $1`,
    [`${TEST_TAG}%`]
  );
  for (const mr of mrs) {
    await pool.query(`DELETE FROM maintenance_status_history WHERE request_id = $1`, [mr.id]);
    await pool.query(`DELETE FROM maintenance_requests WHERE id = $1`, [mr.id]);
  }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  ANNOUNCEMENTS · INBOX · MAINTENANCE                 ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  await cleanup();

  let tokens = {};
  await section('0. Auth', async () => {
    for (const [role, account] of Object.entries(ACCOUNTS)) {
      const { email, pw } = account;
      tokens[role] = await login(email, pw);
      ok(`${role} login`);
    }
  });

  let propertyId;
  await section('1. Announcements', async () => {
    const props = await req('GET', '/api/properties', null, tokens.owner);
    propertyId = props.body.properties?.find(p => p.address_line1?.includes('743'))?.id
      || props.body.properties?.[0]?.id;
    if (!propertyId) { fail('Find property'); return; }

    const bad = await req('POST', '/api/announcements', { title: '', body: '' }, tokens.owner);
    bad.status === 400 ? ok('Rejects empty title/body') : fail('Validation', bad.status);

    const tenantPost = await req('POST', '/api/announcements', {
      title: `${TEST_TAG} hack`, body: 'nope',
    }, tokens.tenant1);
    tenantPost.status === 403 ? ok('Tenant blocked from creating announcements') : fail('Tenant POST', tenantPost.status);

    const created = await req('POST', '/api/announcements', {
      title: `${TEST_TAG} Water shutoff Tuesday`,
      body: 'City work on A Ave — water off 9am–noon Tuesday.',
      channel: 'in_app',
      property_id: propertyId,
    }, tokens.manager);
    if (created.status !== 201) {
      fail('Manager creates announcement', `${created.status} ${JSON.stringify(created.body)}`);
      return;
    }
    const annId = created.body.announcement?.id;
    ok(`Created announcement (${created.body.announcement?.recipient_count} recipients)`);

    const staffList = await req('GET', '/api/announcements', null, tokens.manager);
    const inStaff = (staffList.body.announcements || []).some(a => a.id === annId);
    inStaff ? ok('Manager sees announcement in list') : fail('Staff list', 'not found');

    for (const [name, tok] of [['tenant1', tokens.tenant1], ['tenant2', tokens.tenant2]]) {
      const r = await req('GET', '/api/announcements', null, tok);
      const found = (r.body.announcements || []).some(a => a.id === annId);
      found ? ok(`${name} sees property announcement`) : fail(`${name} announcements`, 'not found');
    }

    const { rows: [notif] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM notifications
        WHERE type = 'announcement' AND related_entity_id = $1`,
      [annId]
    );
    notif.n >= 1 ? ok(`In-app notifications sent (${notif.n})`) : fail('Notifications', 'none created');
  });

  let threadId;
  await section('2. Inbox / Messages', async () => {
    const bad = await req('POST', '/api/messages/threads', { body: '' }, tokens.tenant1);
    bad.status === 400 ? ok('Rejects empty message body') : fail('Empty body', bad.status);

    const created = await req('POST', '/api/messages/threads', {
      subject: `${TEST_TAG} Kitchen sink drip`,
      body: 'The kitchen faucet has been dripping for two days. Can someone take a look?',
    }, tokens.tenant1);
    if (created.status !== 201) {
      fail('Tenant starts thread', `${created.status} ${JSON.stringify(created.body)}`);
      return;
    }
    threadId = created.body.thread?.id;
    ok(`Tenant created thread ${threadId?.slice(0, 8)}…`);

    const tenantInbox = await req('GET', '/api/messages/inbox', null, tokens.tenant1);
    tenantInbox.status === 403 ? ok('Tenant blocked from manager inbox') : fail('Tenant inbox', tenantInbox.status);

    const mgrInbox = await req('GET', '/api/messages/inbox', null, tokens.manager);
    const inInbox = (mgrInbox.body.threads || []).some(t => t.id === threadId);
    inInbox ? ok('Manager inbox shows tenant thread') : fail('Manager inbox', 'thread missing');

    const reply = await req('POST', `/api/messages/threads/${threadId}/reply`, {
      body: 'Thanks Buckley — Konstantin will schedule a plumber this week.',
    }, tokens.manager);
    reply.status === 201 ? ok('Manager replied to thread') : fail('Manager reply', reply.status);

    const thread = await req('GET', `/api/messages/threads/${threadId}`, null, tokens.tenant1);
    const msgs = thread.body.messages || [];
    msgs.length >= 2 && msgs.some(m => m.direction === 'outbound')
      ? ok(`Tenant sees ${msgs.length} messages including manager reply`)
      : fail('Thread messages', JSON.stringify(msgs.map(m => m.direction)));

    const cross = await req('GET', `/api/messages/threads/${threadId}`, null, tokens.tenant2);
    cross.status === 403 ? ok('Other tenant blocked from thread') : fail('Cross-tenant access', cross.status);

    const tenantReply = await req('POST', `/api/messages/threads/${threadId}`, {
      body: 'Thank you! Any day works except Thursday.',
    }, tokens.tenant1);
    tenantReply.status === 201 ? ok('Tenant replied in thread') : fail('Tenant reply', tenantReply.status);

    const urgency = await req('PATCH', `/api/messages/threads/${threadId}/urgency`, {
      urgency: 'medium',
    }, tokens.manager);
    urgency.status === 200 ? ok('Manager set urgency to medium') : fail('Set urgency', urgency.status);

    const close = await req('PATCH', `/api/messages/threads/${threadId}/close`, {}, tokens.manager);
    close.status === 200 ? ok('Manager closed thread') : fail('Close thread', close.status);

    const closedReply = await req('POST', `/api/messages/threads/${threadId}`, {
      body: 'Should not work',
    }, tokens.tenant1);
    closedReply.status === 400 ? ok('Tenant cannot reply to closed thread') : fail('Closed reply', closedReply.status);
  });

  let maintId;
  await section('3. Maintenance', async () => {
    const badCat = await req('POST', '/api/maintenance', {
      title: `${TEST_TAG} bad`,
      category: 'not-a-category',
    }, tokens.tenant2);
    badCat.status === 400 ? ok('Rejects invalid category') : fail('Bad category', badCat.status);

    const created = await req('POST', '/api/maintenance', {
      title: `${TEST_TAG} AC not cooling`,
      description: 'Bedroom AC runs but room stays warm.',
      category: 'hvac',
      priority: 'high',
    }, tokens.tenant2);
    if (created.status !== 201) {
      fail('Tenant submits request', `${created.status} ${JSON.stringify(created.body)}`);
      return;
    }
    maintId = created.body.request?.id;
    ok(`Tenant submitted request (${created.body.request?.status})`);

    const myList = await req('GET', '/api/maintenance/my', null, tokens.tenant2);
    const inMy = (myList.body.requests || []).some(r => r.id === maintId);
    inMy ? ok('Tenant sees request in /my') : fail('Tenant my list', 'not found');

    const queue = await req('GET', '/api/maintenance?priority=high', null, tokens.manager);
    const inQueue = (queue.body.requests || []).some(r => r.id === maintId);
    inQueue ? ok('Manager queue shows high-priority request') : fail('Manager queue', 'not found');

    const cross = await req('GET', `/api/maintenance/${maintId}`, null, tokens.tenant1);
    cross.status === 403 ? ok('Other tenant blocked from request detail') : fail('Cross-tenant maint', cross.status);

    const progress = await req('PATCH', `/api/maintenance/${maintId}`, {
      status: 'in_progress',
      note: 'HVAC tech scheduled for Thursday',
    }, tokens.manager);
    progress.status === 200 && progress.body.request?.status === 'in_progress'
      ? ok('Manager moved to in_progress')
      : fail('Status update', progress.status);

    const detail = await req('GET', `/api/maintenance/${maintId}`, null, tokens.tenant2);
    const hist = detail.body.history || [];
    hist.some(h => h.new_status === 'in_progress')
      ? ok(`Status history recorded (${hist.length} entries)`)
      : fail('Status history', JSON.stringify(hist));

    const resolved = await req('PATCH', `/api/maintenance/${maintId}`, {
      status: 'resolved',
      note: 'Filter replaced, cooling restored',
    }, tokens.manager);
    resolved.status === 200 ? ok('Manager resolved request') : fail('Resolve', resolved.status);

    const earlyRate = await req('POST', `/api/maintenance/${maintId}/rating`, {
      rating: 5,
    }, tokens.tenant2);
    // Should work now that resolved

    earlyRate.status === 200 ? ok('Tenant rated resolved request (5 stars)') : fail('Rating', earlyRate.status);

    const badRate = await req('POST', `/api/maintenance/${maintId}/rating`, {
      rating: 3,
    }, tokens.tenant1);
    badRate.status === 403 ? ok('Other tenant blocked from rating') : fail('Cross rating', badRate.status);
  });

  await cleanup();
  ok('Cleaned up test data');
  await pool.end();

  printSummary('COMMS TEST');
}

main().catch(e => { console.error(e); process.exit(1); });
