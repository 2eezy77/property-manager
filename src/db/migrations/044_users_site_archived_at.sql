-- Soft-hide former tenants from the live site (keep rows for ledger/archives).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS site_archived_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_users_site_archived_at
  ON users (site_archived_at)
  WHERE site_archived_at IS NOT NULL;

COMMENT ON COLUMN users.site_archived_at IS
  'When set, user is hidden from manager/tenant/admin UI lists (Payments, Tenants, Leases, Inbox, etc.). Historical payments remain; see archive/.';
