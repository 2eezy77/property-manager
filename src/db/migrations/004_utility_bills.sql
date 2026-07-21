-- 004_utility_bills.sql
-- Utility bill splitter: manager uploads a bill for a property, system splits it
-- equally across leases active during the bill period, notifies tenants with a
-- 48-hour dispute window, then auto-debits each non-disputed share via Stripe ACH
-- (reusing the existing payments / chargeACH rails).
--
-- Tables added: utility_bills, utility_bill_splits
-- Enums added : utility_service_type, utility_bill_status, utility_split_status
-- Altered     : payments.payment_type check now includes 'utility'

-- ── Enums (guarded so re-runs don't fail) ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'utility_service_type') THEN
    CREATE TYPE utility_service_type AS ENUM
      ('electric','water','gas','internet','trash','sewer','other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'utility_bill_status') THEN
    CREATE TYPE utility_bill_status AS ENUM
      ('draft','notified','charging','settled','cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'utility_split_status') THEN
    CREATE TYPE utility_split_status AS ENUM
      ('pending','notified','disputed','charging','paid','failed','waived');
  END IF;
END $$;

-- ── utility_bills ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS utility_bills (
    id                  UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id         UUID                 NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    created_by          UUID                 NOT NULL REFERENCES users(id),
    service_type        utility_service_type NOT NULL,
    provider_name       VARCHAR(255),
    period_start        DATE                 NOT NULL,
    period_end          DATE                 NOT NULL,
    total_amount        NUMERIC(10,2)        NOT NULL CHECK (total_amount > 0),
    due_date            DATE                 NOT NULL,
    notes               TEXT,
    bill_document_url   TEXT,
    status              utility_bill_status  NOT NULL DEFAULT 'draft',
    notified_at         TIMESTAMPTZ,
    dispute_deadline_at TIMESTAMPTZ,
    settled_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_period_order CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_utility_bills_property
    ON utility_bills(property_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_utility_bills_status_open
    ON utility_bills(status) WHERE status IN ('draft','notified','charging');

-- ── utility_bill_splits ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS utility_bill_splits (
    id              UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id         UUID                 NOT NULL REFERENCES utility_bills(id) ON DELETE CASCADE,
    lease_id        UUID                 NOT NULL REFERENCES leases(id),
    tenant_id       UUID                 NOT NULL REFERENCES users(id),
    amount          NUMERIC(10,2)        NOT NULL CHECK (amount >= 0),
    status          utility_split_status NOT NULL DEFAULT 'pending',
    payment_id      UUID                 REFERENCES payments(id),
    disputed_at     TIMESTAMPTZ,
    dispute_reason  TEXT,
    waived_by       UUID                 REFERENCES users(id),
    waived_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    UNIQUE (bill_id, lease_id)
);

CREATE INDEX IF NOT EXISTS idx_utility_splits_tenant
    ON utility_bill_splits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_utility_splits_bill
    ON utility_bill_splits(bill_id);
CREATE INDEX IF NOT EXISTS idx_utility_splits_open
    ON utility_bill_splits(status) WHERE status IN ('pending','notified','disputed','charging');

-- ── Extend payments.payment_type to include 'utility' ─────────────────────────
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_type_check;
ALTER TABLE payments
  ADD CONSTRAINT payments_payment_type_check
  CHECK (payment_type IN ('rent','late_fee','security_deposit','utility','other'));

-- ── updated_at triggers (idempotent) ──────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_utility_bills_updated_at'
  ) THEN
    CREATE TRIGGER trg_utility_bills_updated_at
      BEFORE UPDATE ON utility_bills
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_utility_bill_splits_updated_at'
  ) THEN
    CREATE TRIGGER trg_utility_bill_splits_updated_at
      BEFORE UPDATE ON utility_bill_splits
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
