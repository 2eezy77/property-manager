-- 021_activity_audit_log.sql
-- Org-scoped activity trail (all roles except primary owner actions).

CREATE TABLE IF NOT EXISTS activity_audit_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email         VARCHAR(255),
    actor_role          VARCHAR(32),
    impersonator_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action              VARCHAR(64) NOT NULL,
    category            VARCHAR(32) NOT NULL DEFAULT 'api',
    summary             TEXT NOT NULL,
    method              VARCHAR(10),
    path                TEXT,
    status_code         INT,
    resource_type       VARCHAR(64),
    resource_id         UUID,
    metadata            JSONB,
    ip_address          VARCHAR(45),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_audit_org_created
    ON activity_audit_log(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_audit_actor_created
    ON activity_audit_log(actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_audit_category
    ON activity_audit_log(category, created_at DESC);
