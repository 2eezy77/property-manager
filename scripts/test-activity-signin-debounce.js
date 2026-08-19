#!/usr/bin/env node
/**
 * Regression: successful sign-in / session-open share a 24h portal-open debounce
 * so Activity log is not login spam (PR #41).
 *
 * Run: npm run test:activity-signin-debounce
 */
'use strict';

const assert = require('assert');

const dbPath = require.resolve('../src/db/client');
const servicePath = require.resolve('../src/services/activity-audit.service');

function loadWithPoolMock(queryImpl) {
  delete require.cache[dbPath];
  delete require.cache[servicePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { query: queryImpl },
  };
  return require('../src/services/activity-audit.service');
}

async function run() {
  const { SESSION_OPEN_DEBOUNCE_HOURS } = loadWithPoolMock(async () => ({ rows: [] }));
  assert.strictEqual(SESSION_OPEN_DEBOUNCE_HOURS, 24);

  // Missing userId → no DB work
  {
    let calls = 0;
    const { logSignIn, logSessionOpen } = loadWithPoolMock(async () => {
      calls += 1;
      return { rows: [] };
    });
    assert.strictEqual(await logSignIn({ userId: null }), null);
    assert.strictEqual(await logSessionOpen({ userId: undefined }), null);
    assert.strictEqual(calls, 0, 'blank userId must not query');
  }

  // Recent portal open → skip both login and session lines
  {
    const queries = [];
    const { logSignIn, logSessionOpen } = loadWithPoolMock(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [{ '?column?': 1 }] };
    });
    assert.strictEqual(await logSignIn({ userId: 'u-1', email: 'a@b.com' }), null);
    assert.strictEqual(await logSessionOpen({ userId: 'u-1' }), null);
    assert.ok(queries.length >= 2, 'debounce check runs for login and session');
    for (const q of queries) {
      assert.ok(
        /action IN \('login', 'session'\)/i.test(q.sql),
        'debounce looks for login or session'
      );
      assert.strictEqual(q.params[0], 'u-1');
      assert.strictEqual(q.params[1], 24, 'debounce window is 24 hours');
    }
  }

  // No recent open → sign-in proceeds into logActivity (org lookup + insert)
  {
    const queries = [];
    const { logSignIn } = loadWithPoolMock(async (sql, params) => {
      const text = String(sql).replace(/\s+/g, ' ');
      queries.push({ sql: text, params });
      if (/action IN \('login', 'session'\)/i.test(text)) {
        return { rows: [] };
      }
      if (/SELECT id, email, first_name, last_name, role FROM users/i.test(text)) {
        return {
          rows: [{
            id: 'u-1',
            email: 'a@b.com',
            role: 'tenant',
            first_name: 'Ada',
            last_name: 'Tenant',
          }],
        };
      }
      if (/AS org_id/i.test(text)) {
        return { rows: [{ org_id: 'org-1' }] };
      }
      if (/INSERT INTO activity_audit_log/i.test(text)) {
        return { rows: [{ id: 'log-1', created_at: new Date().toISOString() }] };
      }
      throw new Error(`Unexpected SQL in debounce mock: ${text.slice(0, 120)}`);
    });

    const row = await logSignIn({ userId: 'u-1', email: 'a@b.com', ip: '1.2.3.4' });
    assert.ok(row, 'sign-in without recent open should write a log row');
    assert.strictEqual(row.id, 'log-1');
    assert.ok(
      queries.some((q) => /INSERT INTO activity_audit_log/i.test(q.sql)),
      'expected activity_audit_log insert'
    );
  }

  console.log('test-activity-signin-debounce: OK');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
