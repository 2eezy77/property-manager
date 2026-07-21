-- 005_users_org_id.sql
-- Add org_id to users so super_admin/owner can resolve their accessible properties.
-- Every staff route's accessiblePropertyIds() helper relies on this column;
-- without it the JOIN users u ON u.org_id = p.org_id fails silently for owners
-- and only property_manager users (via property_assignments) see anything.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

-- Backfill: any existing super_admin user becomes member of the first org
-- (preserves admin's existing implicit org membership without changing ownership).
UPDATE users u
   SET org_id = (SELECT o.id FROM organizations o WHERE o.owner_id = u.id LIMIT 1)
 WHERE u.org_id IS NULL
   AND u.role = 'super_admin';
