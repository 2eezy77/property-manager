-- 026_site_visit_common_announcement.sql
-- Link automated common-area visit broadcasts; track inbox room notices.

ALTER TABLE announcements
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(40),
    ADD COLUMN IF NOT EXISTS source_id UUID;

ALTER TABLE site_visit_tenant_notices
    DROP CONSTRAINT IF EXISTS site_visit_tenant_notices_channel_check;

ALTER TABLE site_visit_tenant_notices
    ADD CONSTRAINT site_visit_tenant_notices_channel_check
        CHECK (channel IN ('email', 'in_app', 'inbox'));

CREATE INDEX IF NOT EXISTS idx_announcements_source
    ON announcements(source_type, source_id)
    WHERE source_id IS NOT NULL;
