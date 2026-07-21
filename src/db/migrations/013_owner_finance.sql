-- Owner personal finance: payment checklist + mortgage statement archive (RAG source)

CREATE TABLE IF NOT EXISTS owner_payment_checklist (
    id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category         VARCHAR(32)    NOT NULL,
    label            VARCHAR(255)   NOT NULL,
    amount_estimate  NUMERIC(10,2),
    due_day          SMALLINT       CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 28)),
    payment_method   VARCHAR(64),
    notes            TEXT,
    last_paid_at     TIMESTAMPTZ,
    last_verified_at TIMESTAMPTZ,
    sort_order       SMALLINT       NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, category)
);

CREATE INDEX IF NOT EXISTS idx_owner_checklist_owner
  ON owner_payment_checklist (owner_id, sort_order);

CREATE TABLE IF NOT EXISTS mortgage_statements (
    id                 UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id           UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    statement_date     DATE           NOT NULL,
    due_date           DATE,
    amount_due         NUMERIC(10,2),
    monthly_payment    NUMERIC(10,2),
    principal_balance  NUMERIC(12,2),
    escrow_balance     NUMERIC(10,2),
    interest_rate      NUMERIC(7,4),
    account_number     VARCHAR(32),
    servicer           VARCHAR(128)   NOT NULL DEFAULT 'Newrez LLC',
    raw_text           TEXT           NOT NULL,
    source_file        TEXT,
    metadata           JSONB          NOT NULL DEFAULT '{}'::jsonb,
    imported_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, statement_date, account_number)
);

CREATE INDEX IF NOT EXISTS idx_mortgage_statements_owner_date
  ON mortgage_statements (owner_id, statement_date DESC);
