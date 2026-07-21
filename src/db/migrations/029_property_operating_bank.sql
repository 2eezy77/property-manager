-- 029_property_operating_bank.sql
-- Org-level joint property operating account columns + indexes.

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_accounts_org_property_operating
  ON bank_accounts(org_id)
  WHERE purpose = 'property_operating'
    AND org_id IS NOT NULL
    AND status <> 'revoked';

CREATE INDEX IF NOT EXISTS idx_bank_accounts_org_purpose
  ON bank_accounts(org_id, purpose)
  WHERE org_id IS NOT NULL;
