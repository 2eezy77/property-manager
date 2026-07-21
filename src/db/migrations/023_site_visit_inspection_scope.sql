-- 023_site_visit_inspection_scope.sql
-- Inspection scope, multi-photo proof, tenant 24h notices.

ALTER TABLE manager_site_visits
    ADD COLUMN IF NOT EXISTS planned_visit_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS scope_common JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS site_visit_room_targets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id    UUID NOT NULL REFERENCES manager_site_visits(id) ON DELETE CASCADE,
    unit_id     UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    room_label  VARCHAR(255) NOT NULL,
    tenant_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (visit_id, unit_id)
);

CREATE TABLE IF NOT EXISTS site_visit_photos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id        UUID NOT NULL REFERENCES manager_site_visits(id) ON DELETE CASCADE,
    area_type       VARCHAR(20) NOT NULL CHECK (area_type IN ('common', 'tenant_room')),
    area_key        VARCHAR(80),
    unit_id         UUID REFERENCES units(id) ON DELETE SET NULL,
    photo_path      TEXT NOT NULL,
    photo_mime      VARCHAR(100),
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_visit_tenant_notices (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id          UUID NOT NULL REFERENCES manager_site_visits(id) ON DELETE CASCADE,
    tenant_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    unit_ids          UUID[] NOT NULL DEFAULT '{}',
    room_labels       TEXT[] NOT NULL DEFAULT '{}',
    channel           VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'in_app')),
    planned_visit_at  TIMESTAMPTZ,
    sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at      TIMESTAMPTZ,
    external_id       VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_site_visit_targets_visit
    ON site_visit_room_targets(visit_id);

CREATE INDEX IF NOT EXISTS idx_site_visit_photos_visit
    ON site_visit_photos(visit_id);

CREATE INDEX IF NOT EXISTS idx_site_visit_notices_visit
    ON site_visit_tenant_notices(visit_id);
