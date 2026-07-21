-- Tenant opt-in automatic ACH rent on billing day
ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS autopay_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS autopay_bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leases_autopay
  ON leases (id) WHERE autopay_enabled = TRUE;
