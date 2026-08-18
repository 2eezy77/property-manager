-- 047_site_visit_custom_pay.sql
-- Owner can pay any amount for other manager work, not only $20 visits.

ALTER TABLE manager_site_visit_payouts
    ADD COLUMN IF NOT EXISTS payout_kind TEXT NOT NULL DEFAULT 'visits';

ALTER TABLE manager_site_visit_payouts
    DROP CONSTRAINT IF EXISTS manager_site_visit_payouts_payout_kind_check;

ALTER TABLE manager_site_visit_payouts
    ADD CONSTRAINT manager_site_visit_payouts_payout_kind_check
    CHECK (payout_kind IN ('visits', 'custom', 'mixed'));
