#!/usr/bin/env node
/**
 * Property / maintenance access helpers (owner vs assignment vs tenant).
 * Run: node scripts/test-property-access.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const dbPath = path.resolve(__dirname, '../src/db/client.js');
const accessPath = path.resolve(__dirname, '../src/utils/property-access.js');

const calls = [];
const mockPool = {
  async query(sql, params = []) {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (sql.includes('FROM properties p') && sql.includes('JOIN users u')) {
      return { rows: [{ id: 'prop-org-1' }, { id: 'prop-org-2' }] };
    }
    if (sql.includes('FROM property_assignments')) {
      return { rows: [{ id: 'prop-assigned-1' }] };
    }
    if (sql.includes('FROM maintenance_requests WHERE id') && sql.includes('tenant_id')) {
      const [requestId, tenantId] = params;
      if (requestId === 'mr-tenant' && tenantId === 'tenant-1') {
        return { rows: [{ '?column?': 1 }] };
      }
      return { rows: [] };
    }
    if (sql.includes('FROM maintenance_requests mr') && sql.includes('property_id = ANY')) {
      const [requestId, propIds] = params;
      if (requestId === 'mr-staff' && Array.isArray(propIds) && propIds.includes('prop-assigned-1')) {
        return { rows: [{ '?column?': 1 }] };
      }
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL in property-access mock: ${sql.slice(0, 100)}`);
  },
};

delete require.cache[dbPath];
delete require.cache[accessPath];
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: mockPool,
};

const {
  accessiblePropertyIds,
  maintenanceRequestAccessible,
} = require('../src/utils/property-access');

async function run() {
  calls.length = 0;
  const ownerProps = await accessiblePropertyIds('owner-1', 'owner');
  assert.deepStrictEqual(ownerProps, ['prop-org-1', 'prop-org-2']);
  assert.ok(calls[0].sql.includes('FROM properties p'), 'owner uses org properties');

  calls.length = 0;
  const adminProps = await accessiblePropertyIds('admin-1', 'super_admin');
  assert.deepStrictEqual(adminProps, ['prop-org-1', 'prop-org-2']);

  calls.length = 0;
  const mgrProps = await accessiblePropertyIds('mgr-1', 'property_manager');
  assert.deepStrictEqual(mgrProps, ['prop-assigned-1']);
  assert.ok(calls[0].sql.includes('property_assignments'), 'manager uses assignments');

  assert.strictEqual(
    await maintenanceRequestAccessible('mr-tenant', 'tenant-1', 'tenant'),
    true,
    'tenant can see own request'
  );
  assert.strictEqual(
    await maintenanceRequestAccessible('mr-other', 'tenant-1', 'tenant'),
    false,
    'tenant cannot see others'
  );

  assert.strictEqual(
    await maintenanceRequestAccessible('mr-staff', 'mgr-1', 'property_manager'),
    true,
    'manager can see request on assigned property'
  );
  assert.strictEqual(
    await maintenanceRequestAccessible('mr-elsewhere', 'mgr-1', 'property_manager'),
    false,
    'manager cannot see request outside assignments'
  );

  // Empty assignment list → no access without querying maintenance by id alone.
  const emptyPool = {
    async query(sql) {
      if (sql.includes('FROM property_assignments')) return { rows: [] };
      throw new Error(`Should not query further: ${sql.slice(0, 80)}`);
    },
  };
  delete require.cache[accessPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: emptyPool,
  };
  const accessEmpty = require('../src/utils/property-access');
  assert.strictEqual(
    await accessEmpty.maintenanceRequestAccessible('mr-staff', 'mgr-2', 'property_manager'),
    false,
    'no assignments → no maintenance access'
  );

  console.log('test-property-access: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
