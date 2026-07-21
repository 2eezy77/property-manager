-- Tenant onboarding checklist progress (bank link derived from bank_accounts)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS maintenance_viewed_at TIMESTAMPTZ;
