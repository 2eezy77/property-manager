-- Property manager operational playbook (743 A Ave move-in / oversight checklist)

CREATE TABLE IF NOT EXISTS manager_playbook_checklist (
    id                 UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id         UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category           VARCHAR(32)    NOT NULL,
    label              VARCHAR(255)   NOT NULL,
    notes              TEXT,
    sort_order         SMALLINT       NOT NULL DEFAULT 0,
    last_completed_at  TIMESTAMPTZ,
    last_verified_at   TIMESTAMPTZ,
    created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    UNIQUE (manager_id, category)
);

CREATE INDEX IF NOT EXISTS idx_manager_playbook_manager
  ON manager_playbook_checklist (manager_id, sort_order);
