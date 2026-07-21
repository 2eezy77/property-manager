-- 037_plaid_link_status.sql
-- Track Plaid Item health for re-link (ITEM_LOGIN_REQUIRED, PENDING_EXPIRATION webhooks).

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS link_status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (link_status IN ('active', 'needs_relink'));

CREATE INDEX IF NOT EXISTS idx_bank_accounts_link_status
  ON bank_accounts (link_status)
  WHERE link_status = 'needs_relink';
