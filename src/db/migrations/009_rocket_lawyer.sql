-- 009_rocket_lawyer.sql
-- Rocket Lawyer is the sole lease/document provider going forward.

ALTER TABLE signature_envelopes
  DROP CONSTRAINT IF EXISTS signature_envelopes_provider_check;

ALTER TABLE signature_envelopes
  ADD CONSTRAINT signature_envelopes_provider_check
    CHECK (provider IN ('rocket_lawyer', 'docusign', 'dropbox_sign', 'rocketsign', 'local'));

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS rl_document_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS rl_interview_url TEXT;

CREATE INDEX IF NOT EXISTS idx_leases_rl_document ON leases(rl_document_id)
  WHERE rl_document_id IS NOT NULL;
