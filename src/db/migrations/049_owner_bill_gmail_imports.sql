-- Idempotency + audit for Owner Finance Gmail payment confirmations.
-- Worker marks checklist items paid/verified. Never charges anyone.
-- Unique on (owner_id, gmail_message_id) and (owner_id, category, confirmation).

CREATE TABLE IF NOT EXISTS owner_bill_gmail_imports (
    id                   UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id             UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category             VARCHAR(32)    NOT NULL,
    gmail_message_id     VARCHAR(255)   NOT NULL,
    confirmation         VARCHAR(64),
    posted_at            TIMESTAMPTZ,
    applied_last_paid_at TIMESTAMPTZ,
    applied_verified     BOOLEAN        NOT NULL DEFAULT FALSE,
    subject              TEXT,
    from_address         TEXT,
    metadata             JSONB          NOT NULL DEFAULT '{}'::jsonb,
    created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, gmail_message_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_bill_gmail_confirmation
  ON owner_bill_gmail_imports (owner_id, category, confirmation)
  WHERE confirmation IS NOT NULL AND confirmation <> '';

CREATE INDEX IF NOT EXISTS idx_owner_bill_gmail_message
  ON owner_bill_gmail_imports (gmail_message_id);
