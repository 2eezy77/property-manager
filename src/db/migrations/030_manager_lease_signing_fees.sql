-- 030_manager_lease_signing_fees.sql
-- Manager compensation: $350 per fully signed lease (Konstantin).

DO $$ BEGIN
  CREATE TYPE lease_signing_fee_status AS ENUM ('owed', 'paid');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS manager_lease_signing_fees (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    manager_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lease_id        UUID NOT NULL UNIQUE REFERENCES leases(id) ON DELETE CASCADE,
    amount_cents    INTEGER NOT NULL DEFAULT 35000 CHECK (amount_cents > 0),
    signed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status          lease_signing_fee_status NOT NULL DEFAULT 'owed',
    payment_method  site_visit_payout_method,
    paid_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    paid_at         TIMESTAMPTZ,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lease_signing_fees_org_status
    ON manager_lease_signing_fees(org_id, status, signed_at DESC);

CREATE INDEX IF NOT EXISTS idx_lease_signing_fees_manager
    ON manager_lease_signing_fees(manager_id, status, signed_at DESC);
