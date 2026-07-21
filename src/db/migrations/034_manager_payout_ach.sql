-- 034_manager_payout_ach.sql
-- Real ACH for manager site-visit payroll (property bank → Connect → manager bank).

ALTER TYPE site_visit_payout_status ADD VALUE IF NOT EXISTS 'processing';

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT;

ALTER TABLE manager_site_visit_payouts
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT;

CREATE INDEX IF NOT EXISTS idx_visit_payouts_stripe_pi
  ON manager_site_visit_payouts(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
