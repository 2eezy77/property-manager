-- Announcements: manager broadcasts to tenants
CREATE TABLE IF NOT EXISTS announcements (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    property_id     UUID         REFERENCES properties(id),
    sender_id       UUID         NOT NULL REFERENCES users(id),
    title           VARCHAR(255) NOT NULL,
    body            TEXT         NOT NULL,
    channel         message_channel NOT NULL DEFAULT 'in_app',
    recipient_count INTEGER      NOT NULL DEFAULT 0,
    send_at         TIMESTAMPTZ,
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_announcements_org ON announcements(org_id, created_at DESC);
