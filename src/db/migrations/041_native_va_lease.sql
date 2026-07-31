-- 041_native_va_lease.sql
-- Native Montero VA room lease: statuses, columns, envelope provider.

ALTER TYPE lease_status ADD VALUE IF NOT EXISTS 'pending_tenant_signature';
ALTER TYPE lease_status ADD VALUE IF NOT EXISTS 'pending_manager_signature';
ALTER TYPE lease_status ADD VALUE IF NOT EXISTS 'awaiting_deposit';

ALTER TABLE signature_envelopes
  DROP CONSTRAINT IF EXISTS signature_envelopes_provider_check;

ALTER TABLE signature_envelopes
  ADD CONSTRAINT signature_envelopes_provider_check
    CHECK (provider IN (
      'rocket_lawyer', 'docusign', 'dropbox_sign', 'rocketsign', 'local', 'native'
    ));

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS signing_provider VARCHAR(32),
  ADD COLUMN IF NOT EXISTS room_type VARCHAR(20)
    CHECK (room_type IS NULL OR room_type IN ('regular', 'master')),
  ADD COLUMN IF NOT EXISTS nsf_fee NUMERIC(10,2) DEFAULT 50,
  ADD COLUMN IF NOT EXISTS house_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS signed_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS tenant_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manager_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMPTZ;

ALTER TABLE envelope_signers
  ADD COLUMN IF NOT EXISTS signature_image TEXT,
  ADD COLUMN IF NOT EXISTS signed_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS signer_ip INET,
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

CREATE INDEX IF NOT EXISTS idx_leases_signing_provider
  ON leases (signing_provider)
  WHERE signing_provider IS NOT NULL;
