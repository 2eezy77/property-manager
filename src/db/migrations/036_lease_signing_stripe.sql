-- 036_lease_signing_stripe.sql
-- Stripe PaymentIntent tracking for lease-signing fee payouts.

ALTER TABLE manager_lease_signing_fees
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT;

CREATE INDEX IF NOT EXISTS idx_lease_signing_fees_stripe_pi
  ON manager_lease_signing_fees(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
