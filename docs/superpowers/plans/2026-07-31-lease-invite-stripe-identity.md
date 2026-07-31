# Lease Invite + Stripe Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers invite new tenants by email+phone when creating a native VA lease; tenants pay for Stripe Identity (DL + SSN); lease activates only when deposit is paid **and** identity is verified; owner/manager notified on fail; verified PII stored encrypted for future collections.

**Architecture:** Extend `POST /api/leases/native` with an `invite` payload that creates the user, draft lease, and password-set email. Add `tenant_identity_verifications` + lease status `awaiting_identity`. Tenant pays a dedicated Identity fee PaymentIntent, then opens a Stripe Identity VerificationSession; webhooks update status and gate `activateNativeLeaseAfterDeposit`. Manager UI gets Existing/Invite toggle; tenant Lease page gets Verify card.

**Tech Stack:** Express + `pg`, Stripe Identity Verification Sessions + existing PaymentIntents, AES-256-GCM for SSN (`IDENTITY_PII_ENCRYPTION_KEY`), existing `password_reset_tokens` + `sendEmail`, React/Vite manager/tenant pages, script-style QA under `scripts/`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-lease-invite-stripe-identity-design.md` (approved).
- Native leases only; no Identity gate for Rocket Lawyer leases.
- Invite requires **email + first_name + phone**; last_name optional.
- Gate C: sign allowed without Identity; **no `active`** until Identity `verified`.
- Deposit before verify → status **`awaiting_identity`** (not `active`).
- Tenant pays Identity: base **$1.50** (150¢) + card processing fee via `computeCardCashAppFee` (same 2.9%+$0.30 as rent card).
- Hosted Stripe Identity URL (not embedded) in v1.
- Invite email reuses `password_reset_tokens` + custom template; after set-password, land on `/tenant/lease`.
- Duplicate tenant email on invite → **409** “use Existing tenant”.
- Never log/email full SSN; manager/owner see `***-**-XXXX` by default.
- Collections agency auto-file is **out of scope** (store profile only).
- Do not commit PII lease PDFs under `documents/`.
- Follow existing script QA style (`scripts/lib/test-helpers.js`); no new Jest suite.

## File structure (create / modify)

| Path | Responsibility |
|------|----------------|
| `src/db/migrations/042_lease_invite_identity.sql` | `awaiting_identity` status; `identity_verification_fee` payment type; `tenant_identity_verifications` table |
| `src/services/identity-pii-crypto.service.js` | Encrypt/decrypt SSN; last4 helper |
| `src/services/tenant-identity.service.js` | Fee intent, VerificationSession, report persistence, activation eligibility |
| `src/services/tenant-invite.service.js` | Create tenant+org, reset token, invite email |
| `src/services/email-templates/tenantLeaseInvite.js` | Invite email copy |
| `src/services/email-templates/identityVerificationAlert.js` | Owner/manager fail/review alert |
| `src/services/stripe.service.js` | `createIdentityVerificationSession`, retrieve report helpers |
| `src/services/native-lease.service.js` | Accept invite path in create; expose identity on lease reads |
| `src/services/native-lease-activate.service.js` | Require verified identity; handle `awaiting_identity` ↔ `active` |
| `src/routes/leases.routes.js` | Invite body; identity fee/session routes; staff identity summary |
| `src/routes/tenants.routes.js` | Lease-create tenant list includes lease-less org tenants |
| `src/webhooks/stripe.webhook.js` | Identity session events + identity fee PI + activation branch |
| `src/config/env.js` | Document/require `IDENTITY_PII_ENCRYPTION_KEY` in prod when Identity enabled |
| `client/src/pages/manager/Leases.jsx` | Existing / Invite toggle; phone required; identity badge |
| `client/src/pages/tenant/Lease.jsx` | Verify identity card + fee + redirect to Stripe |
| `client/src/utils/nativeLeaseHelpers.js` | `awaiting_identity` step |
| `client/src/pages/auth/ResetPassword.jsx` (or equivalent) | Optional `next=/tenant/lease` after reset |
| `scripts/test-identity-crypto.js` | Crypto unit checks |
| `scripts/test-lease-invite-identity.js` | API QA for invite + gate |
| `package.json` | npm scripts |

---

### Task 1: Migration + crypto helper

**Files:**
- Create: `src/db/migrations/042_lease_invite_identity.sql`
- Create: `src/services/identity-pii-crypto.service.js`
- Create: `scripts/test-identity-crypto.js`
- Modify: `package.json` (add `test:identity-crypto`)

**Interfaces:**
- Produces: table `tenant_identity_verifications`; lease status `awaiting_identity`; payment type `identity_verification_fee`
- Produces: `encryptSsn(ssn) → { ciphertext, keyId }`, `decryptSsn(ciphertext) → string`, `ssnLast4(ssn) → string`

- [ ] **Step 1: Write failing crypto test**

```js
// scripts/test-identity-crypto.js
process.env.IDENTITY_PII_ENCRYPTION_KEY =
  process.env.IDENTITY_PII_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');
const { encryptSsn, decryptSsn, ssnLast4 } = require('../src/services/identity-pii-crypto.service');
const enc = encryptSsn('123456789');
if (enc.ciphertext.includes('123456789')) throw new Error('plaintext leaked');
if (decryptSsn(enc.ciphertext) !== '123456789') throw new Error('roundtrip fail');
if (ssnLast4('123456789') !== '6789') throw new Error('last4');
console.log('OK identity crypto');
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

Run: `node scripts/test-identity-crypto.js`  
Expected: `Cannot find module ... identity-pii-crypto.service`

- [ ] **Step 3: Implement crypto + migration**

```sql
-- src/db/migrations/042_lease_invite_identity.sql
ALTER TYPE lease_status ADD VALUE IF NOT EXISTS 'awaiting_identity';

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_payment_type_check
  CHECK (payment_type IN (
    'rent','late_fee','security_deposit','utility','identity_verification_fee','other'
  ));

CREATE TABLE IF NOT EXISTS tenant_identity_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES users(id),
  lease_id UUID NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  stripe_verification_session_id TEXT UNIQUE,
  stripe_fee_payment_intent_id TEXT,
  fee_payment_id UUID REFERENCES payments(id),
  status VARCHAR(32) NOT NULL DEFAULT 'not_started'
    CHECK (status IN (
      'not_started','requires_input','processing','verified','canceled','failed'
    )),
  verified_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_reason TEXT,
  legal_name TEXT,
  date_of_birth DATE,
  address_line1 TEXT,
  address_line2 TEXT,
  address_city TEXT,
  address_state TEXT,
  address_postal TEXT,
  ssn_ciphertext TEXT,
  ssn_last4 VARCHAR(4),
  encryption_key_id TEXT,
  fee_paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lease_id)
);

CREATE INDEX IF NOT EXISTS idx_tiv_tenant ON tenant_identity_verifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tiv_session ON tenant_identity_verifications(stripe_verification_session_id);
```

```js
// src/services/identity-pii-crypto.service.js
const crypto = require('crypto');
const KEY_ID = 'v1';
function getKey() {
  const raw = process.env.IDENTITY_PII_ENCRYPTION_KEY;
  if (!raw) throw Object.assign(new Error('IDENTITY_PII_ENCRYPTION_KEY missing'), { code: 'IDENTITY_KEY_MISSING' });
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('IDENTITY_PII_ENCRYPTION_KEY must be 32 bytes base64');
  return key;
}
function encryptSsn(ssn) {
  const digits = String(ssn).replace(/\D/g, '');
  if (digits.length !== 9) throw new Error('SSN must be 9 digits');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([iv, tag, enc]).toString('base64'), keyId: KEY_ID };
}
function decryptSsn(ciphertext) {
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
function ssnLast4(ssn) {
  const digits = String(ssn).replace(/\D/g, '');
  return digits.slice(-4);
}
module.exports = { encryptSsn, decryptSsn, ssnLast4, KEY_ID };
```

- [ ] **Step 4: Run crypto test — expect PASS**

Run: `node scripts/test-identity-crypto.js`  
Expected: `OK identity crypto`

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/042_lease_invite_identity.sql \
  src/services/identity-pii-crypto.service.js \
  scripts/test-identity-crypto.js package.json
git commit -m "feat(identity): migration and SSN crypto helper"
```

---

### Task 2: Tenant invite service + lease-create list fix

**Files:**
- Create: `src/services/tenant-invite.service.js`
- Create: `src/services/email-templates/tenantLeaseInvite.js`
- Modify: `src/services/native-lease.service.js` — `createNativeLease` accepts optional invite resolution
- Modify: `src/routes/leases.routes.js` — pass `invite` body
- Modify: `src/routes/tenants.routes.js` — `GET /api/tenants?for_lease_create=1` includes org tenants without leases
- Test: `scripts/test-lease-invite-identity.js` (invite section first)

**Interfaces:**
- Consumes: `createNativeLease`, `password_reset_tokens` pattern, `sendEmail`
- Produces: `inviteTenantForLease({ orgId, email, firstName, lastName, phone, createdBy }) → { tenant }`  
  `sendLeaseInviteEmail({ user, orgId, leaseId }) → { sent: boolean }`

- [ ] **Step 1: Write failing invite assertion script skeleton**

```js
// scripts/test-lease-invite-identity.js (partial — invite only)
// Use scripts/lib/test-helpers.js login/req pattern from test-native-lease.js
// Assert POST /api/leases/native with invite lacking phone → 400
// Assert with phone → 201, tenant created, lease draft, user has org_id
// Assert GET /api/tenants?for_lease_create=1 includes that tenant
```

- [ ] **Step 2: Run — expect FAIL on missing invite support**

Run: `node scripts/test-lease-invite-identity.js`  
Expected: FAIL (400/500 on invite body or missing phone validation)

- [ ] **Step 3: Implement invite + route + tenant list**

`tenantLeaseInvite.js`: render subject/text/html with `setPasswordUrl` and lease mention.

`tenant-invite.service.js`:
1. Normalize email; require email, firstName, phone.
2. If user exists with role tenant → throw 409 `USE_EXISTING_TENANT`.
3. If user exists other role → throw 409 `EMAIL_IN_USE`.
4. Insert user with random bcrypt hash, `role='tenant'`, `org_id`, phone.
5. Create password reset token (same as `password-reset.service` insert); build URL `${PORTAL_ORIGIN}/reset-password?token=...&next=/tenant/lease`.
6. `sendEmail` invite template.

`POST /api/leases/native`: if `invite` present, call invite helper then `createNativeLease({ tenantId: tenant.id, ... })`; return `{ lease, inviteSent, tenant }`.

`GET /api/tenants`: when `for_lease_create=1` and staff, query:

```sql
SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.is_active, u.created_at,
       NULL::uuid AS lease_id, NULL::text AS lease_status, ...
  FROM users u
 WHERE u.role = 'tenant' AND u.org_id = $orgId AND u.is_active = true
UNION
-- existing lease-joined query for property-scoped tenants
```

(Exact SQL should match org resolution used elsewhere for the manager’s org.)

- [ ] **Step 4: Run invite tests — expect PASS**

Run: `node scripts/test-lease-invite-identity.js`  
Expected: invite cases pass

- [ ] **Step 5: Commit**

```bash
git add src/services/tenant-invite.service.js \
  src/services/email-templates/tenantLeaseInvite.js \
  src/services/native-lease.service.js src/routes/leases.routes.js \
  src/routes/tenants.routes.js scripts/test-lease-invite-identity.js
git commit -m "feat(leases): invite new tenant by email on native create"
```

---

### Task 3: Stripe Identity session + fee services

**Files:**
- Modify: `src/services/stripe.service.js`
- Create: `src/services/tenant-identity.service.js`
- Modify: `src/routes/leases.routes.js` — fee + session endpoints
- Modify: `package.json` — fee constant if needed

**Interfaces:**
- Consumes: `computeCardCashAppFee`, `getOrCreateCustomer`, `createCardPaymentIntent`
- Produces:
  - `IDENTITY_FEE_BASE_CENTS = 150`
  - `ensureIdentityRow(leaseId, tenantId)`
  - `createIdentityFeeIntent({ leaseId, tenantId }) → { clientSecret, amount, baseAmount, processingFee, paymentId }`
  - `createIdentitySession({ leaseId, tenantId }) → { url, sessionId }` (requires fee paid or grace retry)
  - `isIdentityVerified(leaseId) → boolean`
  - `applyIdentitySessionUpdate(session) → row`
- Grace: if `fee_paid_at` within 72h, allow new session without second charge.

- [ ] **Step 1: Extend test script for fee gate**

Assert `POST /api/leases/:id/identity/session` without fee → 402/400 `IDENTITY_FEE_REQUIRED`.  
Assert `POST .../identity/fee` → 200 with `baseAmount === 1.5` and `processingFee` matching helper.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```js
// stripe.service.js additions
async function createIdentityVerificationSession({ returnUrl, metadata }) {
  return stripe.identity.verificationSessions.create({
    type: 'document',
    options: {
      document: { require_matching_selfie: true },
    },
    provided_details: metadata.email ? { email: metadata.email } : undefined,
    metadata,
    return_url: returnUrl,
  });
}
async function retrieveIdentityVerificationSession(id, { expand = ['verified_outputs'] } = {}) {
  return stripe.identity.verificationSessions.retrieve(id, { expand });
}
```

Fee route (tenantOnly, lease tenant match): create/reuse `payments` row `payment_type='identity_verification_fee'`, PI for `computeCardCashAppFee(150).totalCents`, metadata `payment_type`, `lease_id`.

Session route: require succeeded fee (or grace); create VerificationSession; store `stripe_verification_session_id`; status `requires_input`; return hosted `url`.

- [ ] **Step 4: Run fee/session tests — expect PASS** (session may skip if Stripe restricted)

- [ ] **Step 5: Commit**

```bash
git add src/services/stripe.service.js src/services/tenant-identity.service.js \
  src/routes/leases.routes.js scripts/test-lease-invite-identity.js package.json
git commit -m "feat(identity): tenant-paid Stripe Identity fee and session"
```

---

### Task 4: Webhooks, activation gate, notifications

**Files:**
- Modify: `src/webhooks/stripe.webhook.js`
- Modify: `src/services/native-lease-activate.service.js`
- Create: `src/services/email-templates/identityVerificationAlert.js`
- Modify: `src/services/tenant-identity.service.js` — `tryActivateAfterIdentity`, `notifyIdentityFailure`

**Interfaces:**
- Consumes: deposit success path that calls `activateNativeLeaseAfterDeposit`
- Produces: activation only when deposit paid **and** identity verified; `awaiting_identity` transition

- [ ] **Step 1: Write activation unit-style checks in script**

Simulate DB states (or API): deposit webhook path must not set `active` without verified identity; with verified + deposit → `active`; deposit only → `awaiting_identity`.

- [ ] **Step 2: Run — expect FAIL on current activate (ignores identity)**

- [ ] **Step 3: Implement activation + webhooks**

```js
// native-lease-activate.service.js — replace logic
async function activateNativeLeaseAfterDeposit(client, leaseId) {
  const { rows: [lease] } = await client.query(
    `SELECT id, status, signing_provider FROM leases WHERE id = $1 FOR UPDATE`,
    [leaseId]
  );
  if (!lease || lease.signing_provider !== 'native') return null;
  if (!['awaiting_deposit', 'awaiting_identity'].includes(lease.status)) return null;

  const { rows: [idv] } = await client.query(
    `SELECT status FROM tenant_identity_verifications WHERE lease_id = $1`,
    [leaseId]
  );
  const verified = idv?.status === 'verified';

  if (!verified) {
    const { rows } = await client.query(
      `UPDATE leases SET status = 'awaiting_identity',
              deposit_paid_at = COALESCE(deposit_paid_at, NOW()),
              updated_at = NOW()
        WHERE id = $1 AND signing_provider = 'native'
        RETURNING id, status`,
      [leaseId]
    );
    return rows[0] || null;
  }

  const { rows } = await client.query(
    `UPDATE leases SET status = 'active',
            deposit_paid_at = COALESCE(deposit_paid_at, NOW()),
            updated_at = NOW()
      WHERE id = $1 AND signing_provider = 'native'
        AND status IN ('awaiting_deposit', 'awaiting_identity')
      RETURNING id, status`,
    [leaseId]
  );
  return rows[0] || null;
}
```

On Identity `verified` webhook: persist report (encrypt SSN via `encryptSsn`), set `verified_at`; if lease `awaiting_identity` or deposit already paid, call activate.

On `requires_input` / `canceled` / failed: update status; `sendOperationalStaffEmail` or owner+manager via `getOperationalStaff` + `identityVerificationAlert` template (no SSN in email).

Mark identity fee PI succeeded like other payments (status succeeded on `payments` row).

Also update `SIGNED_LEASE_STATUSES` / rent-charge guards if they need to include `awaiting_identity` for deposit retries.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/webhooks/stripe.webhook.js \
  src/services/native-lease-activate.service.js \
  src/services/tenant-identity.service.js \
  src/services/email-templates/identityVerificationAlert.js \
  src/services/rent-charge.service.js \
  src/services/lease-signing-pay.service.js \
  scripts/test-lease-invite-identity.js
git commit -m "feat(identity): gate native activation and alert on IDV failure"
```

---

### Task 5: Manager UI — invite toggle + badges

**Files:**
- Modify: `client/src/pages/manager/Leases.jsx`
- Modify: `client/src/utils/nativeLeaseHelpers.js` (if badges shared)

**Interfaces:**
- Consumes: `POST /api/leases/native` with `invite` or `tenant_id`; `GET /api/tenants?for_lease_create=1`

- [ ] **Step 1: Manual/UI assert checklist in `scripts/test-payments-card-ui.js` style** (grep for Invite new / phone)

Add `scripts/test-lease-invite-ui.js` that reads `Leases.jsx` source and asserts strings: `Invite new`, `for_lease_create`, phone required.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement CreateLeaseModal**

- State: `tenantMode: 'existing' | 'invite'`
- Existing: select from `api.get('/api/tenants?for_lease_create=1')`
- Invite: inputs email, first_name, phone (required), last_name
- Payload:

```js
nativePath
  ? (tenantMode === 'invite'
      ? { invite: { email, first_name, last_name, phone }, unit_id, room_type, start_date, end_date, ... }
      : { tenant_id, unit_id, room_type, ... })
  : { tenant_id, ... }
```

- Lease table column or chip: identity status from lease payload (`identity_status` or nested `identity.status`)

Ensure lease list API includes identity status join for native leases.

- [ ] **Step 4: Run UI assert script — PASS**

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/manager/Leases.jsx \
  client/src/utils/nativeLeaseHelpers.js \
  src/routes/leases.routes.js \
  scripts/test-lease-invite-ui.js
git commit -m "feat(ui): manager invite-new-tenant on lease create"
```

---

### Task 6: Tenant UI — Verify identity + reset next param

**Files:**
- Modify: `client/src/pages/tenant/Lease.jsx`
- Modify: `client/src/components/leases/FinishLeasePay.jsx` — banner when unverified
- Modify: `client/src/utils/nativeLeaseHelpers.js` — `awaiting_identity` → step `verify_identity` or `pay_deposit`
- Modify: reset-password page to honor `next` query (find actual file under `client/src/pages`)

**Interfaces:**
- Consumes: `POST /api/leases/:id/identity/fee`, `POST /api/leases/:id/identity/session`

- [ ] **Step 1: UI string assert script** for “Verify your identity”, “activation pending identity”

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

On Lease page when status in `awaiting_deposit` | `awaiting_identity` | after tenant signed:
- Card: fee disclosure ($1.50 + processing estimate)
- Button: Pay verification fee → Stripe Payment Element or redirect confirm card (reuse CardPaymentForm pattern)
- On fee success: call session endpoint → `window.location = data.url`
- Return from Stripe Identity (`?identity_return=1`) → poll/GET lease identity status
- FinishLeasePay: show warning copy; if `awaiting_identity`, show deposit received banner

`deriveNativeLeaseStep`:  
`awaiting_identity` → `'verify_identity'` (or keep pay_deposit with substate)

Reset password: after success navigate to `next` if same-origin path starting with `/`.

- [ ] **Step 4: Run UI asserts + `cd client && npm run build`**

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/tenant/Lease.jsx \
  client/src/components/leases/FinishLeasePay.jsx \
  client/src/utils/nativeLeaseHelpers.js \
  client/src/pages/**/ResetPassword*.jsx \
  scripts/test-lease-invite-ui.js
git commit -m "feat(ui): tenant Identity fee and Stripe verify card"
```

---

### Task 7: Wire full QA script + env docs

**Files:**
- Modify: `scripts/test-lease-invite-identity.js` — full flow
- Modify: `scripts/test-native-lease.js` — activation must consider identity (create verified row in test DB before expecting active, or assert awaiting_identity)
- Modify: `package.json` — `test:lease-invite-identity`, `test:identity:all`
- Modify: `.env.example` — `IDENTITY_PII_ENCRYPTION_KEY=`
- Modify: `AGENTS.md` — short Identity note
- Modify: `SETUP.md` — generate key: `openssl rand -base64 32`

- [ ] **Step 1: Expand API script**

Flow:
1. Staff invites new tenant + creates native lease
2. Tenant sets password (optional skip if test sets hash)
3. Sign path (reuse native lease helpers) OR mark signatures in DB if faster
4. Fee + session (skip if Stripe restricted)
5. Insert/simulate verified identity row → deposit activate → `active`
6. Without verified → after deposit helper → `awaiting_identity`

- [ ] **Step 2: Run `npm run test:identity-crypto && npm run test:lease-invite-identity && npm run test:native-lease:all`**

- [ ] **Step 3: Fix native-lease test breakage** (existing test activates on deposit without identity — update to seed `tenant_identity_verifications` status `verified` before expecting active, **or** assert `awaiting_identity` then verify then active)

- [ ] **Step 4: Commit**

```bash
git add scripts/ package.json .env.example AGENTS.md SETUP.md \
  scripts/test-native-lease.js
git commit -m "test(identity): invite + activation gate QA and env docs"
```

---

### Task 8: Production enablement checklist (no code beyond webhook events)

**Files:**
- Modify: `scripts/update-stripe-webhook-events.js` if it enumerates events — add:
  - `identity.verification_session.verified`
  - `identity.verification_session.requires_input`
  - `identity.verification_session.canceled`
  - `identity.verification_session.processing` (if handled)

- [ ] **Step 1: Ensure webhook script includes Identity events**

- [ ] **Step 2: Document in PR body:** enable Stripe Identity in Dashboard; set `IDENTITY_PII_ENCRYPTION_KEY` on Railway; run `npm run stripe:webhook-events` / sync; migrate `042`.

- [ ] **Step 3: Commit**

```bash
git add scripts/update-stripe-webhook-events.js
git commit -m "chore(stripe): include Identity verification webhook events"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Invite email + phone on create | 2, 5 |
| Existing tenant path unchanged | 2, 5 |
| Tenant list includes lease-less | 2 |
| Stripe Identity DL + SSN | 3, 4, 6 |
| Tenant pays fee $1.50 + card fee | 3, 6 |
| Sign without IDV | (no change to sign) + 6 copy |
| `awaiting_identity` / no active until verified | 1, 4, 7 |
| Notify owner+manager on fail | 4 |
| Encrypted SSN + redaction | 1, 4 |
| Collections auto-file deferred | (non-goal, no task) |
| Hosted Identity URL | 3, 6 |
| Reset next → `/tenant/lease` | 2, 6 |
| Tests + migrate 042 | 1, 7, 8 |

## Placeholder / consistency self-review

- Fee base locked at **150 cents**; processing via existing helper.
- Status name **`awaiting_identity`** used consistently.
- Payment type **`identity_verification_fee`** used in migration + services.
- Crypto env **`IDENTITY_PII_ENCRYPTION_KEY`** (32-byte base64).
- No TBD left in task steps; open Stripe Dashboard clicks are Task 8 ops notes only.
