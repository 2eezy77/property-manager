-- 003_rocketsign_provider.sql
-- Update signature_envelopes provider constraint to include rocketsign
-- and add pdf_path column to leases for locally generated PDFs

ALTER TABLE signature_envelopes
  DROP CONSTRAINT IF EXISTS signature_envelopes_provider_check;

ALTER TABLE signature_envelopes
  ADD CONSTRAINT signature_envelopes_provider_check
  CHECK (provider IN ('docusign', 'dropbox_sign', 'rocketsign', 'local'));

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS pdf_path TEXT;
