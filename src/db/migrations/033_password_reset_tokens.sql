-- 033_password_reset_tokens.sql — self-service password reset (email link)

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(64) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    ip_address  VARCHAR(45),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user
    ON password_reset_tokens(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_reset_active
    ON password_reset_tokens(token_hash)
    WHERE used_at IS NULL;
