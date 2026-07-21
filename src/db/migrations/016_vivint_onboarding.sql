-- Staff-tracked Vivint access per tenant + manager playbook step for Konstantin.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS vivint_access_configured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vivint_access_configured_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Insert Vivint playbook step for existing owner/manager checklists (sort after bank links).
DO $migration$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM users WHERE role IN ('owner', 'property_manager')
  LOOP
    UPDATE manager_playbook_checklist
       SET sort_order = sort_order + 1
     WHERE manager_id = r.id
       AND category <> 'vivint_access'
       AND sort_order >= 3;

    INSERT INTO manager_playbook_checklist (
      manager_id, category, label, notes, sort_order
    ) VALUES (
      r.id,
      'vivint_access',
      'Configure Vivint access for all tenants',
      'In the Vivint Smart Home app: assign door codes, key fobs, or mobile login per unit at 743 A Ave. Confirm Master Bedroom, Room 2, and Room 3 tenants can enter and arm/disarm. Mark each tenant done under Manager → Tenants → Move-in checklist.',
      3
    )
    ON CONFLICT (manager_id, category) DO NOTHING;
  END LOOP;
END $migration$;
