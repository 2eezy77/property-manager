-- 031_lease_signing_pending_rent.sql
-- Pay $350 only after tenant has paid 3 months rent.

ALTER TYPE lease_signing_fee_status ADD VALUE IF NOT EXISTS 'pending_rent';
