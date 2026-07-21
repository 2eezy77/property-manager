-- =============================================================================
-- PROPERTY MANAGER PLATFORM — COMPLETE PostgreSQL SCHEMA
-- =============================================================================
-- Domains: Auth, Properties, Leases + E-Signatures, Payments (Plaid/Stripe ACH),
--          Smart Home (Vivint), AI Communication Agent, Maintenance, Notifications
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =============================================================================
-- SECTION 1: ENUMS
-- =============================================================================

CREATE TYPE user_role             AS ENUM ('super_admin', 'owner', 'property_manager', 'tenant');
CREATE TYPE lease_status          AS ENUM ('draft', 'pending_signature', 'active', 'expired', 'terminated');
CREATE TYPE envelope_status       AS ENUM ('created', 'sent', 'delivered', 'completed', 'declined', 'voided');
CREATE TYPE signer_status         AS ENUM ('pending', 'sent', 'delivered', 'signed', 'declined', 'voided');
CREATE TYPE payment_method_status AS ENUM ('pending_verification', 'verified', 'failed', 'revoked');
CREATE TYPE payment_status        AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'refunded', 'partially_refunded');
CREATE TYPE late_fee_status       AS ENUM ('pending', 'applied', 'waived', 'paid');
CREATE TYPE payout_status         AS ENUM ('pending', 'processing', 'paid', 'failed');
CREATE TYPE device_type           AS ENUM ('smart_lock', 'camera', 'door_sensor', 'window_sensor', 'water_leak_sensor', 'thermostat');
CREATE TYPE device_status         AS ENUM ('online', 'offline', 'error', 'unknown');
CREATE TYPE access_code_status    AS ENUM ('active', 'inactive', 'expired', 'revoked');
CREATE TYPE message_channel       AS ENUM ('sms', 'email', 'in_app', 'push', 'phone');
CREATE TYPE message_direction     AS ENUM ('inbound', 'outbound');
CREATE TYPE message_sender_type   AS ENUM ('tenant', 'manager', 'owner', 'ai_agent', 'system');
CREATE TYPE triage_status         AS ENUM ('pending', 'triaged', 'auto_responded', 'escalated', 'resolved');
CREATE TYPE urgency_level         AS ENUM ('low', 'medium', 'high', 'emergency');
CREATE TYPE maintenance_status    AS ENUM ('submitted', 'triaged', 'assigned', 'in_progress', 'pending_tenant', 'resolved', 'cancelled');
CREATE TYPE maintenance_priority  AS ENUM ('low', 'medium', 'high', 'emergency');

-- =============================================================================
-- SECTION 2: AUTH & USERS
-- =============================================================================

CREATE TABLE users (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email             VARCHAR(255) UNIQUE NOT NULL,
    password_hash     VARCHAR(255) NOT NULL,
    role              user_role    NOT NULL DEFAULT 'tenant',
    first_name        VARCHAR(100),
    last_name         VARCHAR(100),
    phone             VARCHAR(25),
    avatar_url        TEXT,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    email_verified_at TIMESTAMPTZ,
    last_login_at     TIMESTAMPTZ,
    fcm_token         TEXT,
    apns_token        TEXT,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ  NOT NULL,
    revoked_at TIMESTAMPTZ,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user    ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;

-- =============================================================================
-- SECTION 3: ORGANIZATIONS, PROPERTIES & UNITS
-- =============================================================================

CREATE TABLE organizations (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name              VARCHAR(255) NOT NULL,
    owner_id          UUID         NOT NULL REFERENCES users(id),
    subscription_tier VARCHAR(50)  NOT NULL DEFAULT 'basic',
    stripe_customer_id VARCHAR(255),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE properties (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name          VARCHAR(255) NOT NULL,
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city          VARCHAR(100),
    state         VARCHAR(50),
    zip           VARCHAR(20),
    country       CHAR(2)      NOT NULL DEFAULT 'US',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE units (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    unit_number  VARCHAR(50) NOT NULL,
    bedrooms     SMALLINT,
    bathrooms    NUMERIC(3,1),
    square_feet  INTEGER,
    floor_number SMALLINT,
    is_occupied  BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(property_id, unit_number)
);

CREATE TABLE property_assignments (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(property_id, user_id)
);

CREATE INDEX idx_properties_org       ON properties(org_id);
CREATE INDEX idx_units_property       ON units(property_id);
CREATE INDEX idx_assignments_user     ON property_assignments(user_id);
CREATE INDEX idx_assignments_property ON property_assignments(property_id);

-- =============================================================================
-- SECTION 4: LEASES + E-SIGNATURES (DocuSign / Dropbox Sign)
-- =============================================================================

CREATE TABLE leases (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id           UUID          NOT NULL REFERENCES units(id),
    tenant_id         UUID          NOT NULL REFERENCES users(id),
    status            lease_status  NOT NULL DEFAULT 'draft',
    start_date        DATE          NOT NULL,
    end_date          DATE          NOT NULL,
    monthly_rent      NUMERIC(10,2) NOT NULL,
    security_deposit  NUMERIC(10,2),
    grace_period_days SMALLINT      NOT NULL DEFAULT 5,
    late_fee_type     VARCHAR(10)   NOT NULL DEFAULT 'flat'
                      CHECK (late_fee_type IN ('flat','percent')),
    late_fee_amount   NUMERIC(10,2),
    late_fee_cap      NUMERIC(10,2),
    document_url      TEXT,
    created_by        UUID          REFERENCES users(id),
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE signature_envelopes (
    id                   UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    lease_id             UUID            NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
    provider             VARCHAR(50)     NOT NULL CHECK (provider IN ('docusign','dropbox_sign')),
    provider_envelope_id VARCHAR(255)    UNIQUE,
    status               envelope_status NOT NULL DEFAULT 'created',
    subject              TEXT,
    message              TEXT,
    signed_document_url  TEXT,
    sent_at              TIMESTAMPTZ,
    completed_at         TIMESTAMPTZ,
    voided_at            TIMESTAMPTZ,
    void_reason          TEXT,
    raw_webhook_payload  JSONB,
    created_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE envelope_signers (
    id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    envelope_id        UUID          NOT NULL REFERENCES signature_envelopes(id) ON DELETE CASCADE,
    user_id            UUID          REFERENCES users(id),
    signer_role        VARCHAR(100)  NOT NULL,
    email              VARCHAR(255)  NOT NULL,
    name               VARCHAR(255)  NOT NULL,
    routing_order      SMALLINT      NOT NULL DEFAULT 1,
    status             signer_status NOT NULL DEFAULT 'pending',
    signed_at          TIMESTAMPTZ,
    declined_reason    TEXT,
    provider_signer_id VARCHAR(255),
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leases_unit           ON leases(unit_id);
CREATE INDEX idx_leases_tenant         ON leases(tenant_id);
CREATE INDEX idx_leases_status         ON leases(status);
CREATE INDEX idx_envelopes_lease       ON signature_envelopes(lease_id);
CREATE INDEX idx_envelopes_provider_id ON signature_envelopes(provider_envelope_id);
CREATE INDEX idx_signers_envelope      ON envelope_signers(envelope_id);

-- =============================================================================
-- SECTION 5: PAYMENTS & FINANCIALS (Plaid -> Stripe ACH)
-- =============================================================================

CREATE TABLE bank_accounts (
    id                           UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                      UUID                  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plaid_item_id                VARCHAR(255),
    plaid_account_id             VARCHAR(255)          UNIQUE,
    -- AES-256-GCM ciphertext -- never store raw Plaid access tokens in plaintext
    plaid_access_token_encrypted TEXT                  NOT NULL,
    institution_name             VARCHAR(255),
    institution_id               VARCHAR(100),
    account_name                 VARCHAR(255),
    account_mask                 VARCHAR(10),
    account_type                 VARCHAR(20)           CHECK (account_type IN ('checking','savings')),
    stripe_customer_id           VARCHAR(255),
    stripe_bank_account_id       VARCHAR(255),
    stripe_fingerprint           VARCHAR(255),
    status                       payment_method_status NOT NULL DEFAULT 'pending_verification',
    is_default                   BOOLEAN               NOT NULL DEFAULT FALSE,
    verified_at                  TIMESTAMPTZ,
    created_at                   TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

CREATE TABLE payments (
    id                       UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    lease_id                 UUID           NOT NULL REFERENCES leases(id),
    tenant_id                UUID           NOT NULL REFERENCES users(id),
    bank_account_id          UUID           REFERENCES bank_accounts(id),
    stripe_payment_intent_id VARCHAR(255)   UNIQUE,
    stripe_charge_id         VARCHAR(255),
    amount                   NUMERIC(10,2)  NOT NULL,
    currency                 CHAR(3)        NOT NULL DEFAULT 'USD',
    status                   payment_status NOT NULL DEFAULT 'pending',
    payment_type             VARCHAR(30)    NOT NULL
                             CHECK (payment_type IN ('rent','late_fee','security_deposit','other')),
    period_start             DATE,
    period_end               DATE,
    due_date                 DATE,
    paid_at                  TIMESTAMPTZ,
    failure_reason           TEXT,
    stripe_webhook_event_id  VARCHAR(255),
    metadata                 JSONB,
    created_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TABLE late_fees (
    id           UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    lease_id     UUID            NOT NULL REFERENCES leases(id),
    payment_id   UUID            REFERENCES payments(id),
    amount       NUMERIC(10,2)   NOT NULL,
    days_overdue INTEGER         NOT NULL,
    status       late_fee_status NOT NULL DEFAULT 'pending',
    applied_at   TIMESTAMPTZ,
    waived_by    UUID            REFERENCES users(id),
    waived_at    TIMESTAMPTZ,
    waive_reason TEXT,
    created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE vendors (
    id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                    UUID         NOT NULL REFERENCES organizations(id),
    name                      VARCHAR(255) NOT NULL,
    email                     VARCHAR(255),
    phone                     VARCHAR(25),
    stripe_connect_account_id VARCHAR(255),
    default_split_type        VARCHAR(10)  CHECK (default_split_type IN ('flat','percent')),
    default_split_value       NUMERIC(10,2),
    is_active                 BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE payment_splits (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id          UUID          NOT NULL REFERENCES payments(id),
    recipient_type      VARCHAR(20)   NOT NULL
                        CHECK (recipient_type IN ('owner','vendor','platform','manager')),
    recipient_user_id   UUID          REFERENCES users(id),
    recipient_vendor_id UUID          REFERENCES vendors(id),
    amount              NUMERIC(10,2) NOT NULL,
    stripe_transfer_id  VARCHAR(255),
    payout_status       payout_status NOT NULL DEFAULT 'pending',
    processed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_one_recipient CHECK (
        (recipient_user_id IS NOT NULL)::INT + (recipient_vendor_id IS NOT NULL)::INT = 1
    )
);

CREATE INDEX idx_bank_accounts_user       ON bank_accounts(user_id);
CREATE INDEX idx_bank_accounts_plaid_acct ON bank_accounts(plaid_account_id);
CREATE INDEX idx_payments_lease           ON payments(lease_id);
CREATE INDEX idx_payments_tenant          ON payments(tenant_id);
CREATE INDEX idx_payments_status          ON payments(status);
CREATE INDEX idx_payments_stripe_intent   ON payments(stripe_payment_intent_id);
CREATE INDEX idx_late_fees_lease          ON late_fees(lease_id);
CREATE INDEX idx_late_fees_status         ON late_fees(status) WHERE status IN ('pending','applied');
CREATE INDEX idx_payment_splits_payment   ON payment_splits(payment_id);

-- =============================================================================
-- SECTION 6: SMART HOME / VIVINT
-- =============================================================================

CREATE TABLE smart_devices (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id              UUID          REFERENCES units(id),
    property_id          UUID          NOT NULL REFERENCES properties(id),
    device_type          device_type   NOT NULL,
    vivint_device_id     VARCHAR(255)  UNIQUE,
    name                 VARCHAR(255),
    location_description VARCHAR(255),
    status               device_status NOT NULL DEFAULT 'unknown',
    firmware_version     VARCHAR(50),
    is_active            BOOLEAN       NOT NULL DEFAULT TRUE,
    last_seen_at         TIMESTAMPTZ,
    metadata             JSONB,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Latest state per device (UNIQUE on device_id enforces one row per device)
CREATE TABLE device_states (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id   UUID        NOT NULL REFERENCES smart_devices(id) ON DELETE CASCADE UNIQUE,
    state       JSONB       NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutable time-series event log partitioned by quarter
CREATE TABLE device_events (
    id              UUID         NOT NULL DEFAULT gen_random_uuid(),
    device_id       UUID         NOT NULL REFERENCES smart_devices(id),
    unit_id         UUID         REFERENCES units(id),
    event_type      VARCHAR(100) NOT NULL,
    triggered_by    VARCHAR(50),
    actor_user_id   UUID         REFERENCES users(id),
    payload         JSONB,
    severity        VARCHAR(10)  NOT NULL DEFAULT 'info'
                    CHECK (severity IN ('info','warning','critical')),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID         REFERENCES users(id),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE device_events_2025_q1 PARTITION OF device_events FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE device_events_2025_q2 PARTITION OF device_events FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE device_events_2025_q3 PARTITION OF device_events FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE device_events_2025_q4 PARTITION OF device_events FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
CREATE TABLE device_events_2026_q1 PARTITION OF device_events FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE device_events_2026_q2 PARTITION OF device_events FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE device_events_2026_q3 PARTITION OF device_events FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE device_events_2026_q4 PARTITION OF device_events FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

CREATE TABLE access_codes (
    id               UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id        UUID               NOT NULL REFERENCES smart_devices(id),
    unit_id          UUID               REFERENCES units(id),
    user_id          UUID               REFERENCES users(id),
    code_label       VARCHAR(100)       NOT NULL,
    code_hash        VARCHAR(255)       NOT NULL,
    vivint_code_slot SMALLINT,
    status           access_code_status NOT NULL DEFAULT 'active',
    valid_from       TIMESTAMPTZ,
    valid_until      TIMESTAMPTZ,
    max_uses         INTEGER,
    use_count        INTEGER            NOT NULL DEFAULT 0,
    created_by       UUID               NOT NULL REFERENCES users(id),
    revoked_by       UUID               REFERENCES users(id),
    revoked_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_smart_devices_property  ON smart_devices(property_id);
CREATE INDEX idx_smart_devices_unit      ON smart_devices(unit_id);
CREATE INDEX idx_smart_devices_vivint    ON smart_devices(vivint_device_id);
CREATE INDEX idx_device_events_device    ON device_events(device_id, created_at DESC);
CREATE INDEX idx_device_events_severity  ON device_events(severity, created_at DESC)
    WHERE severity IN ('warning','critical');
CREATE INDEX idx_device_events_unacked   ON device_events(created_at DESC)
    WHERE acknowledged_at IS NULL AND severity IN ('warning','critical');
CREATE INDEX idx_access_codes_device     ON access_codes(device_id);
CREATE INDEX idx_access_codes_user       ON access_codes(user_id);
CREATE INDEX idx_access_codes_active     ON access_codes(device_id, status) WHERE status = 'active';

-- =============================================================================
-- SECTION 7: AI COMMUNICATION AGENT & MESSAGE LEDGER
-- =============================================================================

CREATE TABLE message_threads (
    id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id                UUID          REFERENCES units(id),
    lease_id               UUID          REFERENCES leases(id),
    tenant_id              UUID          NOT NULL REFERENCES users(id),
    subject                VARCHAR(500),
    category               VARCHAR(50)   CHECK (category IN ('maintenance','payment','lease','noise','general','emergency')),
    urgency                urgency_level NOT NULL DEFAULT 'low',
    triage_status          triage_status NOT NULL DEFAULT 'pending',
    is_open                BOOLEAN       NOT NULL DEFAULT TRUE,
    ai_summary             TEXT,
    escalated_to           UUID          REFERENCES users(id),
    escalated_at           TIMESTAMPTZ,
    maintenance_request_id UUID,          -- FK added after maintenance_requests table (see ALTER below)
    closed_at              TIMESTAMPTZ,
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
    id                  UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id           UUID                NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    sender_type         message_sender_type NOT NULL,
    sender_user_id      UUID                REFERENCES users(id),
    direction           message_direction   NOT NULL,
    channel             message_channel     NOT NULL DEFAULT 'in_app',
    body                TEXT                NOT NULL,
    body_html           TEXT,
    is_internal         BOOLEAN             NOT NULL DEFAULT FALSE,
    is_ai_generated     BOOLEAN             NOT NULL DEFAULT FALSE,
    ai_model_version    VARCHAR(100),
    ai_confidence_score NUMERIC(4,3)        CHECK (ai_confidence_score BETWEEN 0 AND 1),
    read_at             TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ,
    external_message_id VARCHAR(255),
    metadata            JSONB,
    created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_agent_logs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id       UUID        REFERENCES message_threads(id),
    message_id      UUID        REFERENCES messages(id),
    action          VARCHAR(50) NOT NULL
                    CHECK (action IN ('classify','auto_respond','escalate','create_maintenance',
                                      'update_triage','update_urgency','summarize','notify')),
    model_used      VARCHAR(100) NOT NULL,
    prompt_version  VARCHAR(50),
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    latency_ms      INTEGER,
    input_context   JSONB,
    output_result   JSONB,
    was_overridden  BOOLEAN     NOT NULL DEFAULT FALSE,
    override_by     UUID        REFERENCES users(id),
    override_at     TIMESTAMPTZ,
    override_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type                VARCHAR(60)     NOT NULL,
    title               VARCHAR(255),
    body                TEXT,
    channel             message_channel NOT NULL,
    is_read             BOOLEAN         NOT NULL DEFAULT FALSE,
    read_at             TIMESTAMPTZ,
    action_url          TEXT,
    related_entity_type VARCHAR(50),
    related_entity_id   UUID,
    sent_at             TIMESTAMPTZ,
    failed_at           TIMESTAMPTZ,
    failure_reason      TEXT,
    external_id         VARCHAR(255),
    metadata            JSONB,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_threads_tenant          ON message_threads(tenant_id);
CREATE INDEX idx_threads_triage_open     ON message_threads(triage_status) WHERE is_open = TRUE;
CREATE INDEX idx_threads_urgency_open    ON message_threads(urgency) WHERE is_open = TRUE;
CREATE INDEX idx_messages_thread_asc     ON messages(thread_id, created_at ASC);
CREATE INDEX idx_messages_sender         ON messages(sender_user_id, created_at DESC);
CREATE INDEX idx_messages_tenant_visible ON messages(thread_id) WHERE is_internal = FALSE;
CREATE INDEX idx_ai_logs_thread          ON ai_agent_logs(thread_id, created_at DESC);
CREATE INDEX idx_notif_user_unread       ON notifications(user_id, created_at DESC) WHERE is_read = FALSE;
CREATE INDEX idx_notif_type              ON notifications(type, created_at DESC);

-- =============================================================================
-- SECTION 8: MAINTENANCE REQUESTS
-- =============================================================================

CREATE TABLE maintenance_requests (
    id                     UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id                UUID                 NOT NULL REFERENCES units(id),
    lease_id               UUID                 REFERENCES leases(id),
    tenant_id              UUID                 NOT NULL REFERENCES users(id),
    assigned_to            UUID                 REFERENCES users(id),
    vendor_id              UUID                 REFERENCES vendors(id),
    thread_id              UUID                 REFERENCES message_threads(id),
    title                  VARCHAR(255)         NOT NULL,
    description            TEXT,
    status                 maintenance_status   NOT NULL DEFAULT 'submitted',
    priority               maintenance_priority NOT NULL DEFAULT 'medium',
    category               VARCHAR(50)
                           CHECK (category IN ('plumbing','hvac','electrical','appliance',
                                               'structural','pest','exterior','other')),
    is_ai_triaged          BOOLEAN              NOT NULL DEFAULT FALSE,
    ai_priority_suggestion maintenance_priority,
    ai_category_suggestion VARCHAR(50),
    ai_triage_reason       TEXT,
    estimated_cost         NUMERIC(10,2),
    actual_cost            NUMERIC(10,2),
    scheduled_at           TIMESTAMPTZ,
    completed_at           TIMESTAMPTZ,
    tenant_rating          SMALLINT             CHECK (tenant_rating BETWEEN 1 AND 5),
    tenant_rating_comment  TEXT,
    created_at             TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE TABLE maintenance_status_history (
    id         UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID               NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
    changed_by UUID               NOT NULL REFERENCES users(id),
    old_status maintenance_status,
    new_status maintenance_status NOT NULL,
    note       TEXT,
    created_at TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE TABLE maintenance_notes (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id  UUID        NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
    author_id   UUID        NOT NULL REFERENCES users(id),
    note        TEXT        NOT NULL,
    is_internal BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE maintenance_attachments (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID        NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
    uploaded_by     UUID        NOT NULL REFERENCES users(id),
    file_url        TEXT        NOT NULL,
    s3_key          TEXT,
    file_name       VARCHAR(255),
    mime_type       VARCHAR(100),
    file_size_bytes INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Close forward-reference FK: message_threads -> maintenance_requests
ALTER TABLE message_threads
    ADD CONSTRAINT fk_thread_maintenance_request
    FOREIGN KEY (maintenance_request_id)
    REFERENCES maintenance_requests(id);

CREATE INDEX idx_maintenance_unit        ON maintenance_requests(unit_id);
CREATE INDEX idx_maintenance_tenant      ON maintenance_requests(tenant_id);
CREATE INDEX idx_maintenance_status_open ON maintenance_requests(status)
    WHERE status NOT IN ('resolved','cancelled');
CREATE INDEX idx_maintenance_priority    ON maintenance_requests(priority, created_at DESC);
CREATE INDEX idx_maintenance_assigned    ON maintenance_requests(assigned_to)
    WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_maint_notes_request     ON maintenance_notes(request_id);
CREATE INDEX idx_maint_attach_request    ON maintenance_attachments(request_id);

-- =============================================================================
-- SECTION 9: AUTO-UPDATE updated_at TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'users','organizations','properties','units',
        'leases','signature_envelopes','envelope_signers',
        'bank_accounts','payments','vendors',
        'smart_devices','access_codes',
        'message_threads','maintenance_requests'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%I_updated_at
             BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            t, t
        );
    END LOOP;
END;
$$;

-- =============================================================================
-- SECTION 10: LATE FEE CALCULATION FUNCTION
-- =============================================================================
-- Call daily: SELECT cron.schedule('late-fee-calc', '0 8 * * *',
--                                  $$SELECT calculate_and_insert_late_fees();$$);

CREATE OR REPLACE FUNCTION calculate_and_insert_late_fees()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    rec      RECORD;
    fee_amt  NUMERIC(10,2);
    inserted INTEGER := 0;
BEGIN
    FOR rec IN
        SELECT
            p.id                        AS payment_id,
            p.lease_id,
            p.amount                    AS rent_amount,
            p.due_date,
            l.late_fee_type,
            l.late_fee_amount,
            l.late_fee_cap,
            l.grace_period_days,
            (CURRENT_DATE - p.due_date) AS days_overdue
        FROM  payments p
        JOIN  leases   l ON l.id = p.lease_id
        WHERE p.payment_type = 'rent'
          AND p.status        = 'pending'
          AND p.due_date      IS NOT NULL
          AND (CURRENT_DATE - p.due_date) > l.grace_period_days
          AND l.autopay_enabled IS NOT TRUE
          AND NOT EXISTS (SELECT 1 FROM late_fees lf WHERE lf.payment_id = p.id)
    LOOP
        IF rec.late_fee_type = 'flat' THEN
            fee_amt := rec.late_fee_amount;
        ELSE
            fee_amt := ROUND(rec.rent_amount * rec.late_fee_amount / 100.0, 2);
            IF rec.late_fee_cap IS NOT NULL THEN
                fee_amt := LEAST(fee_amt, rec.late_fee_cap);
            END IF;
        END IF;

        INSERT INTO late_fees (lease_id, payment_id, amount, days_overdue, status, applied_at)
        VALUES (rec.lease_id, rec.payment_id, fee_amt, rec.days_overdue, 'applied', NOW());

        inserted := inserted + 1;
    END LOOP;

    RETURN inserted;
END;
$$;
