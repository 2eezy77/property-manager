-- Dominion electric: owner prepaid history vs tenant billing start (743 A Ave reset).

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS dominion_owner_paid_through DATE,
  ADD COLUMN IF NOT EXISTS dominion_tenant_billing_from DATE;

COMMENT ON COLUMN properties.dominion_owner_paid_through IS
  'Owner paid Dominion through this date; earlier imported bills are settled/waived in app.';
COMMENT ON COLUMN properties.dominion_tenant_billing_from IS
  'First bill period_start on or after this date is split to tenants.';
