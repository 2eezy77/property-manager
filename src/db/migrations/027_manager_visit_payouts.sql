-- 027_manager_visit_payouts.sql
-- Manager site-visit monthly payroll: payout bank accounts + owner mark-paid records.

DO $$ BEGIN
  CREATE TYPE bank_account_purpose AS ENUM ('tenant_rent', 'manager_payout');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS purpose bank_account_purpose NOT NULL DEFAULT 'tenant_rent';

DO $$ BEGIN
  CREATE TYPE site_visit_payout_status AS ENUM ('pending', 'paid', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE site_visit_payout_method AS ENUM (
    'manual', 'zelle', 'check', 'cash_app', 'ach', 'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS manager_site_visit_payouts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    manager_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_year     INTEGER NOT NULL CHECK (period_year >= 2020 AND period_year <= 2100),
    period_month    INTEGER NOT NULL CHECK (period_month >= 1 AND period_month <= 12),
    amount_cents    INTEGER NOT NULL CHECK (amount_cents >= 0),
    visit_count     INTEGER NOT NULL CHECK (visit_count >= 0),
    status          site_visit_payout_status NOT NULL DEFAULT 'paid',
    payment_method  site_visit_payout_method NOT NULL DEFAULT 'manual',
    bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
    paid_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    paid_at         TIMESTAMPTZ,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, manager_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_visit_payouts_org_period
    ON manager_site_visit_payouts(org_id, period_year DESC, period_month DESC);

CREATE INDEX IF NOT EXISTS idx_visit_payouts_manager
    ON manager_site_visit_payouts(manager_id, period_year DESC, period_month DESC);

ALTER TABLE manager_site_visits
    ADD COLUMN IF NOT EXISTS payout_id UUID REFERENCES manager_site_visit_payouts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_site_visits_payout
    ON manager_site_visits(payout_id)
    WHERE payout_id IS NOT NULL;
