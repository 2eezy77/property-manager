/**
 * manager-playbook.service.js — Property manager operational playbook checklist.
 */

const pool = require('../db/client');

const DEFAULT_ITEMS = [
  {
    category: 'tenant_passwords',
    label: 'Confirm tenants changed default passwords',
    notes: '743 A Ave tenants should set unique passwords before live handoff — check Account settings for each tenant.',
    sort_order: 1,
  },
  {
    category: 'bank_links',
    label: 'Verify tenant bank links (Plaid → Stripe ACH)',
    notes: 'Each tenant links a real bank via Tenant → Payments (Plaid → Stripe ACH). On Manager → Payments, watch for “Bank relink” badges when Plaid needs re-auth.',
    sort_order: 2,
  },
  {
    category: 'vivint_access',
    label: 'Configure Vivint access for all tenants',
    notes:
      'Vivint Smart Home: assign door codes, key fobs, or mobile access per unit at 743 A Ave. Confirm all active tenants can enter and arm/disarm, then mark each tenant under Manager → Tenants → Move-in checklist.',
    sort_order: 3,
  },
  {
    category: 'lease_review',
    label: 'Review active leases with tenants',
    notes: 'Confirm each tenant viewed their lease in the portal; Rocket Lawyer signing when API is live.',
    sort_order: 4,
  },
  {
    category: 'maintenance_intro',
    label: 'Walk tenants through maintenance requests',
    notes: 'Ensure each tenant visited Maintenance and knows how to submit urgent vs routine requests.',
    sort_order: 5,
  },
  {
    category: 'rent_collection',
    label: 'Check June rent collection status',
    notes: 'Review Manager → Payments rent-status panel — succeeded ACH, Cash App Pay, pending debits, failed charges, and bank relink warnings.',
    sort_order: 6,
  },
  {
    category: 'utilities',
    label: 'Process utility bills and tenant splits',
    notes: '743 A Ave electric/water/trash — create bills, notify tenants, charge splits under Utilities.',
    sort_order: 7,
  },
  {
    category: 'announcements',
    label: 'Post move-in announcement',
    notes: 'House rules, trash day, Wi-Fi, emergency contacts — send via Announcements to all units.',
    sort_order: 8,
  },
  {
    category: 'inbox_sla',
    label: 'Respond to inbox within 24 hours',
    notes: 'Triage tenant messages daily; escalate emergencies to owner if needed.',
    sort_order: 9,
  },
  {
    category: 'cashapp_imports',
    label: 'Sync Cash App rent from Gmail',
    notes: 'Portal Cash App Pay posts automatically. For off-app Cash App receipts, run Sync Cash App from Gmail on Manager → Payments.',
    sort_order: 10,
  },
  {
    category: 'tenant_offboarding',
    label: 'Complete move-out offboarding per tenant',
    notes:
      'When a tenant leaves 743 A Ave: start offboarding on their lease, revoke Vivint codes/keys, unlink bank, settle final utilities and deposit, disable portal. Track under Manager → Tenants → Move-out checklist.',
    sort_order: 11,
  },
];

async function seedDefaults(managerId) {
  for (const item of DEFAULT_ITEMS) {
    await pool.query(
      `INSERT INTO manager_playbook_checklist (
         manager_id, category, label, notes, sort_order
       ) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (manager_id, category) DO NOTHING`,
      [managerId, item.category, item.label, item.notes, item.sort_order]
    );
  }
}

async function listPlaybook(managerId) {
  const { rows: existing } = await pool.query(
    `SELECT 1 FROM manager_playbook_checklist WHERE manager_id = $1 LIMIT 1`,
    [managerId]
  );
  if (!existing.length) await seedDefaults(managerId);

  const { rows } = await pool.query(
    `SELECT id, category, label, notes, sort_order,
            last_completed_at, last_verified_at, created_at, updated_at
     FROM manager_playbook_checklist
     WHERE manager_id = $1
     ORDER BY sort_order, label`,
    [managerId]
  );
  return rows;
}

async function playbookSummary(managerId) {
  const items = await listPlaybook(managerId);
  const total = items.length;
  const completed = items.filter((i) => i.last_completed_at).length;
  const verified = items.filter((i) => i.last_verified_at).length;
  return { items, total, completed, verified };
}

async function updatePlaybookItem(managerId, itemId, patch) {
  const allowed = ['label', 'notes', 'last_completed_at', 'last_verified_at'];
  const sets = [];
  const vals = [managerId, itemId];
  let i = 3;

  for (const key of allowed) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = $${i++}`);
      vals.push(patch[key]);
    }
  }

  if (!sets.length) {
    const err = new Error('No valid fields to update');
    err.code = 'VALIDATION';
    throw err;
  }

  sets.push('updated_at = NOW()');

  const { rows } = await pool.query(
    `UPDATE manager_playbook_checklist
     SET ${sets.join(', ')}
     WHERE id = $2 AND manager_id = $1
     RETURNING *`,
    vals
  );

  if (!rows[0]) {
    const err = new Error('Playbook item not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return rows[0];
}

async function resetPlaybookProgress(client) {
  const { rowCount } = await client.query(
    `UPDATE manager_playbook_checklist
        SET last_completed_at = NULL,
            last_verified_at = NULL,
            updated_at = NOW()`
  );
  return rowCount;
}

module.exports = {
  listPlaybook,
  playbookSummary,
  updatePlaybookItem,
  seedDefaults,
  resetPlaybookProgress,
  DEFAULT_ITEMS,
};
