-- Tenant move-out / offboarding checklist (per lease).

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS offboarding_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboarding_started_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offboard_forwarding_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboard_keys_returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboard_final_charges_ack_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboard_moveout_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboard_vivint_revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboard_vivint_revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offboard_bank_unlinked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboard_bank_unlinked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offboard_utilities_settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboard_utilities_settled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offboard_portal_disabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboard_portal_disabled_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Manager playbook: move-out offboarding oversight.
DO $migration$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM users WHERE role IN ('owner', 'property_manager')
  LOOP
    INSERT INTO manager_playbook_checklist (
      manager_id, category, label, notes, sort_order
    ) VALUES (
      r.id,
      'tenant_offboarding',
      'Complete move-out offboarding per tenant',
      'When a tenant leaves 743 A Ave: start offboarding on their lease, revoke Vivint codes/keys, unlink bank, settle final utilities and deposit, disable portal. Track each step under Manager → Tenants → Move-out checklist.',
      11
    )
    ON CONFLICT (manager_id, category) DO NOTHING;
  END LOOP;
END $migration$;
