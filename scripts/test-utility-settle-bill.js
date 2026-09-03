#!/usr/bin/env node
/**
 * UC07 settle-bill: only mark settled when every split is terminal.
 *
 * Run: npm run test:utility-settle-bill
 */
'use strict';

const { maybeSettleBill } = require('../src/use-cases/utilities/uc07-settle-bill');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

function mockDb(splitStatuses) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (/SELECT status FROM utility_bill_splits/i.test(sql)) {
        return { rows: splitStatuses.map((status) => ({ status })) };
      }
      if (/UPDATE utility_bills/i.test(sql) && /settled/i.test(sql)) {
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

async function run() {
  {
    const db = mockDb([]);
    await maybeSettleBill(db, 'bill-empty');
    check(db.calls.length === 1, 'empty splits: only SELECT, no settle UPDATE');
    check(!db.calls.some((c) => /UPDATE/i.test(c.sql)), 'empty splits: no UPDATE');
  }

  {
    const db = mockDb(['paid', 'notified']);
    await maybeSettleBill(db, 'bill-open');
    check(!db.calls.some((c) => /UPDATE/i.test(c.sql)),
      'mixed open split: does not settle');
  }

  {
    const db = mockDb(['paid', 'waived', 'failed']);
    await maybeSettleBill(db, 'bill-done');
    const upd = db.calls.find((c) => /UPDATE utility_bills/i.test(c.sql));
    check(Boolean(upd), 'all terminal (paid/waived/failed): settles bill');
    check(upd.params[0] === 'bill-done', 'settle UPDATE uses bill id');
    check(/status = 'settled'/i.test(upd.sql), 'settle UPDATE sets settled');
    check(/status <> 'settled'/i.test(upd.sql), 'settle UPDATE is idempotent (skip already settled)');
  }

  {
    const db = mockDb(['paid', 'paid']);
    await maybeSettleBill(db, 'bill-paid');
    check(db.calls.some((c) => /UPDATE/i.test(c.sql)), 'all paid: settles');
  }

  {
    const db = mockDb(['charging', 'paid']);
    await maybeSettleBill(db, 'bill-charging');
    check(!db.calls.some((c) => /UPDATE/i.test(c.sql)),
      'charging is non-terminal: does not settle');
  }

  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll utility-settle-bill checks passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
