#!/usr/bin/env node
/**
 * Plaid Link update-mode (re-auth) gates by scope.
 * Wrong scope / missing row must 404 NOT_FOUND before decrypt or token mint.
 * Successful update path must request updateMode Link tokens and clear needs_relink.
 *
 * Run: node scripts/test-plaid-bank-link.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const poolPath = require.resolve('../src/db/client');
const plaidPath = require.resolve('../src/services/plaid.service');
const bankLinkPath = require.resolve('../src/services/plaid-bank-link.service');
const encryptionPath = require.resolve('../src/utils/encryption');

async function withBankLink({ poolQuery, plaidMock, encryptionMock }, fn) {
  const originals = {
    pool: require.cache[poolPath],
    plaid: require.cache[plaidPath],
    bank: require.cache[bankLinkPath],
    enc: require.cache[encryptionPath],
  };

  delete require.cache[bankLinkPath];
  require.cache[poolPath] = {
    id: poolPath,
    filename: poolPath,
    loaded: true,
    exports: { query: poolQuery },
  };
  require.cache[plaidPath] = {
    id: plaidPath,
    filename: plaidPath,
    loaded: true,
    exports: plaidMock,
  };
  require.cache[encryptionPath] = {
    id: encryptionPath,
    filename: encryptionPath,
    loaded: true,
    exports: encryptionMock,
  };

  try {
    const mod = require(bankLinkPath);
    return await fn(mod);
  } finally {
    delete require.cache[bankLinkPath];
    if (originals.bank) require.cache[bankLinkPath] = originals.bank;
    else delete require.cache[bankLinkPath];
    if (originals.pool) require.cache[poolPath] = originals.pool;
    else delete require.cache[poolPath];
    if (originals.plaid) require.cache[plaidPath] = originals.plaid;
    else delete require.cache[plaidPath];
    if (originals.enc) require.cache[encryptionPath] = originals.enc;
    else delete require.cache[encryptionPath];
  }
}

async function expectNotFound(promise) {
  try {
    await promise;
    assert.fail('expected NOT_FOUND');
  } catch (err) {
    assert.strictEqual(err.code, 'NOT_FOUND');
    assert.strictEqual(err.statusCode, 404);
    assert.match(err.message, /Bank account not found/i);
  }
}

const denyCrypto = {
  encrypt() {
    throw new Error('encrypt must not run');
  },
  decrypt() {
    throw new Error('decrypt must not run on NOT_FOUND');
  },
};

async function run() {
  for (const scope of ['tenant', 'owner_property', 'manager_payout']) {
    const sqlSeen = [];
    await withBankLink(
      {
        async poolQuery(sql) {
          sqlSeen.push(sql.replace(/\s+/g, ' ').trim());
          return { rows: [] };
        },
        plaidMock: {
          async createLinkToken() {
            throw new Error('createLinkToken must not run on NOT_FOUND');
          },
        },
        encryptionMock: denyCrypto,
      },
      async ({ createUpdateLinkTokenForAccount }) => {
        await expectNotFound(
          createUpdateLinkTokenForAccount({
            userId: 'user-1',
            bankAccountId: 'ba-missing',
            scope,
          })
        );
      }
    );

    const joined = sqlSeen.join('\n');
    if (scope === 'owner_property') {
      assert.ok(joined.includes("purpose = 'property_operating'"), 'owner scope queries property_operating');
    } else if (scope === 'manager_payout') {
      assert.ok(joined.includes("purpose = 'manager_payout'"), 'manager scope queries manager_payout');
    } else {
      assert.ok(joined.includes('user_id = $2'), 'tenant scope binds bank to user');
      assert.ok(!joined.includes("purpose = 'property_operating'"), 'tenant scope is not property_operating');
    }
  }

  {
    const sqlSeen = [];
    await withBankLink(
      {
        async poolQuery(sql) {
          sqlSeen.push(sql);
          return { rows: [] };
        },
        plaidMock: {
          async createLinkToken() {
            throw new Error('unreachable');
          },
        },
        encryptionMock: denyCrypto,
      },
      async ({ createUpdateLinkTokenForAccount }) => {
        await expectNotFound(
          createUpdateLinkTokenForAccount({ userId: 'u', bankAccountId: 'ba' })
        );
      }
    );
    assert.ok(
      !sqlSeen.some((s) => s.includes("purpose = 'manager_payout'")),
      'default scope is not manager_payout'
    );
  }

  await withBankLink(
    {
      async poolQuery() {
        return {
          rows: [{
            id: 'ba-1',
            user_id: 'user-1',
            plaid_access_token_encrypted: 'enc-token',
            link_status: 'needs_relink',
          }],
        };
      },
      plaidMock: {
        async createLinkToken(userId, opts) {
          assert.strictEqual(userId, 'user-1');
          assert.strictEqual(opts.updateMode, true);
          assert.strictEqual(opts.accessToken, 'access-live-token');
          return 'link-sandbox-token';
        },
      },
      encryptionMock: {
        encrypt() {
          throw new Error('encrypt unused on create token');
        },
        decrypt(blob) {
          assert.strictEqual(blob, 'enc-token');
          return 'access-live-token';
        },
      },
    },
    async ({ createUpdateLinkTokenForAccount }) => {
      const result = await createUpdateLinkTokenForAccount({
        userId: 'user-1',
        bankAccountId: 'ba-1',
        scope: 'tenant',
      });
      assert.strictEqual(result.linkToken, 'link-sandbox-token');
      assert.strictEqual(result.bankAccountId, 'ba-1');
      assert.strictEqual(result.linkStatus, 'needs_relink');
    }
  );

  await withBankLink(
    {
      async poolQuery() {
        return { rows: [] };
      },
      plaidMock: {
        async exchangePublicToken() {
          throw new Error('exchange must not run on NOT_FOUND');
        },
      },
      encryptionMock: denyCrypto,
    },
    async ({ completePlaidLinkUpdate }) => {
      await expectNotFound(
        completePlaidLinkUpdate({
          userId: 'user-1',
          bankAccountId: 'ba-missing',
          publicToken: 'public-x',
          scope: 'owner_property',
        })
      );
    }
  );

  await withBankLink(
    {
      async poolQuery(sql, params = []) {
        const text = sql.replace(/\s+/g, ' ').trim();
        if (text.startsWith('SELECT')) {
          return {
            rows: [{
              id: 'ba-2',
              user_id: 'mgr-1',
              plaid_access_token_encrypted: 'old',
              link_status: 'needs_relink',
              status: 'failed',
            }],
          };
        }
        if (text.startsWith('UPDATE bank_accounts')) {
          assert.strictEqual(params[0], 'enc-new');
          assert.strictEqual(params[1], 'item-99');
          assert.strictEqual(params[2], 'ba-2');
          return {
            rows: [{
              id: 'ba-2',
              institution_name: 'Test Bank',
              status: 'verified',
              link_status: 'active',
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${text.slice(0, 80)}`);
      },
      plaidMock: {
        async exchangePublicToken(publicToken) {
          assert.strictEqual(publicToken, 'public-ok');
          return { accessToken: 'access-new', itemId: 'item-99' };
        },
      },
      encryptionMock: {
        encrypt(plaintext) {
          assert.strictEqual(plaintext, 'access-new');
          return 'enc-new';
        },
        decrypt() {
          throw new Error('decrypt unused on complete');
        },
      },
    },
    async ({ completePlaidLinkUpdate }) => {
      const updated = await completePlaidLinkUpdate({
        userId: 'mgr-1',
        bankAccountId: 'ba-2',
        publicToken: 'public-ok',
        scope: 'manager_payout',
      });
      assert.strictEqual(updated.id, 'ba-2');
      assert.strictEqual(updated.link_status, 'active');
    }
  );

  const calls = [];
  await withBankLink(
    {
      async poolQuery(sql, params = []) {
        calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
        return { rowCount: 2 };
      },
      plaidMock: {},
      encryptionMock: {
        encrypt() {
          return 'x';
        },
        decrypt() {
          return 'x';
        },
      },
    },
    async ({ markAccountsNeedsRelinkByItemId, clearLinkStatusByItemId }) => {
      assert.strictEqual(await markAccountsNeedsRelinkByItemId('item-1'), 2);
      assert.ok(calls[0].sql.includes("link_status = 'needs_relink'"));
      assert.deepStrictEqual(calls[0].params, ['item-1']);

      assert.strictEqual(await clearLinkStatusByItemId('item-1'), 2);
      assert.ok(calls[1].sql.includes("link_status = 'active'"));
      assert.ok(calls[1].sql.includes("link_status = 'needs_relink'"));
    }
  );

  console.log('test-plaid-bank-link: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
