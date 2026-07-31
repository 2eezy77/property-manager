-- src/db/migrations/042_lease_invite_identity.sql
ALTER TYPE lease_status ADD VALUE IF NOT EXISTS 'awaiting_identity';

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_payment_type_check
  CHECK (payment_type IN (
    'rent','late_fee','security_deposit','utility','identity_verification_fee','other'
  ));

CREATE TABLE IF NOT EXISTS tenant_identity_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES users(id),
  lease_id UUID NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  stripe_verification_session_id TEXT UNIQUE,
  stripe_fee_payment_intent_id TEXT,
  fee_payment_id UUID REFERENCES payments(id),
  status VARCHAR(32) NOT NULL DEFAULT 'not_started'
    CHECK (status IN (
      'not_started','requires_input','processing','verified','canceled','failed'
    )),
  verified_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_reason TEXT,
  legal_name TEXT,
  date_of_birth DATE,
  address_line1 TEXT,
  address_line2 TEXT,
  address_city TEXT,
  address_state TEXT,
  address_postal TEXT,
  ssn_ciphertext TEXT,
  ssn_last4 VARCHAR(4),
  encryption_key_id TEXT,
  fee_paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lease_id)
);

CREATE INDEX IF NOT EXISTS idx_tiv_tenant ON tenant_identity_verifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tiv_session ON tenant_identity_verifications(stripe_verification_session_id);
