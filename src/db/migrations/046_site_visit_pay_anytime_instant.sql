-- 046_site_visit_pay_anytime_instant.sql
-- Allow multiple manager payrolls in the same month (pay whenever visits complete)
-- and record Stripe Instant Payouts to Konstantin's bank.

ALTER TABLE manager_site_visit_payouts
    DROP CONSTRAINT IF EXISTS manager_site_visit_payouts_org_id_manager_id_period_year_period_month_key;

DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'manager_site_visit_payouts'::regclass
     AND contype = 'u'
     AND pg_get_constraintdef(oid) ILIKE '%period_year%'
     AND pg_get_constraintdef(oid) ILIKE '%period_month%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE manager_site_visit_payouts DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE manager_site_visit_payouts
    ADD COLUMN IF NOT EXISTS stripe_instant_payout_id TEXT,
    ADD COLUMN IF NOT EXISTS instant_payout_status TEXT,
    ADD COLUMN IF NOT EXISTS instant_payout_error TEXT,
    ADD COLUMN IF NOT EXISTS instant_payout_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_visit_payouts_period
    ON manager_site_visit_payouts(org_id, manager_id, period_year, period_month, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visit_payouts_instant
    ON manager_site_visit_payouts(stripe_instant_payout_id)
    WHERE stripe_instant_payout_id IS NOT NULL;
