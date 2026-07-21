-- Gmail OAuth tokens (encrypted refresh token per staff user) + bill dedup by message id.

CREATE TABLE IF NOT EXISTS gmail_oauth_tokens (
    user_id                  UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_encrypted  TEXT         NOT NULL,
    gmail_address            VARCHAR(255),
    scopes                   TEXT,
    connected_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE utility_bills
  ADD COLUMN IF NOT EXISTS gmail_message_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_utility_bills_gmail_message
    ON utility_bills(gmail_message_id)
    WHERE gmail_message_id IS NOT NULL;

COMMENT ON COLUMN properties.dominion_account_number IS
  'Dominion electric account — used to match e-bill emails to this property.';
COMMENT ON COLUMN properties.norfolk_utilities_account_number IS
  'HRSD/Norfolk utilities account — used to match e-bill emails to this property.';
