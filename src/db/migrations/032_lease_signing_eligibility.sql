-- 032_lease_signing_eligibility.sql
-- Track rent months toward eligibility; cancel if tenant leaves early.

ALTER TYPE lease_signing_fee_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE manager_lease_signing_fees
  ADD COLUMN IF NOT EXISTS eligible_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rent_months_paid INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

UPDATE manager_lease_signing_fees
   SET status = 'pending_rent'
 WHERE status = 'owed';

ALTER TABLE manager_lease_signing_fees
  ALTER COLUMN status SET DEFAULT 'pending_rent';
