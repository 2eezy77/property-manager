-- 022_manager_site_visits.sql
-- Manager on-site visit pay: owner pre-approval, photo proof, $20/visit, $100/mo cap.

DO $$ BEGIN
  CREATE TYPE site_visit_status AS ENUM (
    'pending_approval',
    'approved',
    'rejected',
    'completed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS manager_site_visits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    property_id     UUID REFERENCES properties(id) ON DELETE SET NULL,
    manager_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          site_visit_status NOT NULL DEFAULT 'pending_approval',
    requested_note  TEXT,
    approved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at     TIMESTAMPTZ,
    rejected_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    rejected_at     TIMESTAMPTZ,
    rejection_note  TEXT,
    visited_at      TIMESTAMPTZ,
    photo_path      TEXT,
    photo_mime      VARCHAR(100),
    amount_cents    INTEGER NOT NULL DEFAULT 2000 CHECK (amount_cents > 0),
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_visits_org_status
    ON manager_site_visits(org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_visits_manager
    ON manager_site_visits(manager_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_visits_completed_month
    ON manager_site_visits(org_id, visited_at DESC)
    WHERE status = 'completed';
