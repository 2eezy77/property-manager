# Lease invite + Stripe Identity (design)

**Status:** Approved for implementation planning (2026-07-31)  
**Product:** Montero Rentals — native VA room lease portal  
**Depends on:** Native VA lease portal (`041_native_va_lease.sql`, deposit → activate)

## Problem

1. Manager lease create only selects tenants from `GET /api/tenants`, which joins existing leases — **new people cannot be invited by email** from the lease form.
2. Plaid/Stripe today verify **payment rails** (bank Auth, card/Cash App), **not** government identity.
3. Owners want **driver’s license + SSN** verification at signing time, notifications on fail/fraud, activation blocked until verified, and **collections-ready PII** retained after verify. Tenants should **pay** for Identity. Full automatic collections agency filing is **later** (after agency API research).

## Goals

- Invite a new tenant by **email + first name + phone** during native lease create; email them a link to set password and open the lease.
- Keep selecting **existing tenants** for renewals / known people.
- Run **Stripe Identity** (document/DL + selfie/liveness + US SSN) around signing.
- **Gate C:** tenant may **sign** without Identity; lease **must not become `active`** until Identity is `verified` (even if deposit already succeeded).
- Notify **owner + manager** on failed / needs-review / fraudulent outcomes.
- On verify: persist collections-ready profile (legal name, DOB, address, full SSN encrypted).
- Tenant pays Stripe Identity cost (charged via portal before or with the verification step).
- Fix tenant picker so invited users without prior leases are visible.

## Non-goals (v1)

- Plaid Identity / income / credit screening.
- Automatic collections agency API filing (future; v1 only stores export-ready verified identity).
- Identity gate for legacy Rocket Lawyer leases.
- Charging Montero for Identity (tenant pays).

## Decisions

| Topic | Choice |
|--------|--------|
| Provider | Stripe Identity |
| New tenant | Invite email (create portal user + draft lease + send link) |
| Phone | **Required** on invite |
| Sign vs Identity | Sign allowed before verify |
| Activation | Blocked until Identity `verified` |
| Deposit before verify | Payment recorded; activation held; clear tenant banner |
| Who pays Identity | **Tenant** |
| Collections auto-file | **Later** — research agency API; v1 = encrypted profile only |
| Notify | Owner + manager on fail / requires review / canceled-after-attempts; verified may be quiet or in-app only |

## End-to-end flow

```text
Manager: New Lease
  ├─ Existing tenant → POST /api/leases/native { tenant_id, ... }
  └─ Invite new → POST /api/leases/native { invite: { email, first_name, last_name?, phone }, ... }
         → create users row (tenant, org_id, phone)
         → create native draft lease
         → send invite email (set-password → /tenant/lease)

Tenant: set password → review PDF → sign (allowed without IDV)
     → Verify identity card (pay Identity fee → Stripe Identity session)
     → Pay deposit (card / ACH / Cash App) anytime after signatures

Activation:
  deposit succeeded AND identity verified → active
  else if deposit succeeded AND identity not verified → held (not active) + banner
  identity failed / needs review → notify owner+manager; do not activate
```

## UI

### Manager — New Lease modal

- Toggle: **Existing tenant** | **Invite new**
- Invite fields: email*, first name*, phone*, last name optional
- Submit creates user + draft + sends invite; toast “Invite sent to …”
- Lease list / detail: identity badge `Not started` | `Pending` | `Verified` | `Failed — review`

### Invite email

- Subject: invite to Montero Rentals / review lease
- CTA: set password (or login) → `/tenant/lease`
- Copy: review & sign; verify ID with driver’s license + SSN (tenant-paid)

### Tenant — Lease page

- After signing path reaches deposit/identity phase: **Verify your identity** card
- Flow: disclose fee → charge tenant for Identity → open Stripe Identity (DL + selfie + SSN)
- States: Start · In progress · Verified · Action needed · Failed
- Deposit UI warns: lease activates only after identity verified
- If deposit posts while unverified: “Deposit received — activation pending identity verification”

## Data model

New table (name illustrative): `tenant_identity_verifications`

| Column | Notes |
|--------|--------|
| id | UUID PK |
| tenant_id | FK users |
| lease_id | FK leases (native) |
| stripe_verification_session_id | unique |
| stripe_identity_payment_id | optional FK/metadata for tenant-paid fee PaymentIntent |
| status | `not_started` \| `requires_input` \| `processing` \| `verified` \| `canceled` \| `failed` |
| verified_at | timestamptz |
| last_error_code / last_error_reason | text |
| legal_name, dob, address_* | from verified report |
| ssn_ciphertext / ssn_last4 | full SSN encrypted at rest; last4 for display |
| encryption_key_id | key version |
| created_at / updated_at | |

Optional lease column or derived: `identity_status` for fast badges (or join verification row).

**Security**

- AES (or app-level) encryption for SSN; key in env / secret manager (`IDENTITY_PII_ENCRYPTION_KEY`).
- Never log SSN, never put SSN in emails/toasts.
- Tenant APIs never return full SSN; manager/owner get redacted `***-**-1234` by default.
- Access to decrypted SSN restricted (owner/manager); audit later if needed.

## APIs

- `POST /api/leases/native` — accept `tenant_id` **or** `invite: { email, first_name, last_name?, phone }` (phone required). Set `org_id` on invite. 409 if email exists with incompatible role; if existing tenant email, clear error or attach per product rule (prefer: error with “use Existing tenant”).
- Fix `GET /api/tenants` (or add `?for_lease_create=1`) so **org tenants without leases** appear in the picker.
- `POST /api/leases/:id/identity/fee` — create PaymentIntent for Identity fee (tenant-paid); amount = Stripe Identity cost + optional small portal markup (document exact cents in plan; default: pass-through Stripe list price rounded up, or fixed portal fee covering $1.50).
- `POST /api/leases/:id/identity/session` — create Stripe VerificationSession after fee paid (or bundle fee into session start); return client secret / URL.
- Webhook: `identity.verification_session.verified` / `.requires_input` / `.canceled` — update row; on verified pull report and encrypt SSN fields; on fail/needs review notify owner+manager.
- Activation hook (`native-lease-activate` / Stripe deposit success): require `identity.status === 'verified'` before setting lease `active`.

## Identity fee (tenant-paid)

- Charge tenant via existing Stripe customer before starting VerificationSession (or immediately prior in the same UI step).
- Ledger: separate payment type e.g. `identity_verification_fee` (not rent/deposit).
- If Identity session fails after fee paid: v1 policy = fee not auto-refunded; allow retry of session without second charge within a grace window (e.g. same lease, 72h) — document in plan.
- Card/Cash App processing fee policy: Identity fee may use same 2.9%+$0.30 as other card rails, or ACH if bank linked — prefer card for simplicity in v1.

## Notifications

- **Failed / requires review / canceled after attempts:** email + in-app to owner and property manager (tenant name, unit, lease id, Stripe status, deep link).
- **Verified:** in-app / quiet; optional email off by default.
- Reuse existing email transport (`EMAIL_ENABLED`, Resend/Gmail patterns).

## Activation state machine (native)

Existing: `draft → pending_tenant_signature → pending_manager_signature → awaiting_deposit → active`

Addition:

- From `awaiting_deposit`: deposit success **and** identity verified → `active`.
- Deposit success **without** identity verified → remain non-active (stay `awaiting_deposit` or introduce `awaiting_identity` if clearer in UI; prefer explicit `awaiting_identity` only if it simplifies badges — otherwise keep `awaiting_deposit` + `identity_status` flag).
- Recommendation: add status **`awaiting_identity`** when deposit is paid but identity not verified; when identity verifies first, stay `awaiting_deposit` until deposit; when both true → `active`.

## Future: collections agency filing

Out of v1 implementation. When researched:

- Use stored verified profile (name, DOB, address, SSN) + ledger balances.
- One-click or automated handoff to chosen agency API.
- Spec/plan for that feature is separate.

## Testing

- Unit/script: invite create requires phone; duplicate email; activation blocked without verified identity; verified + deposit → active.
- Stripe Identity test mode fixtures for verified / requires_input / failed.
- Fee PaymentIntent created and linked before session.
- SSN not present in API list responses or logs (assert redaction).
- Extend `test:native-lease` (or sibling script) for invite + identity gate.

## Rollout

1. Migration for identity table + optional lease status `awaiting_identity`.
2. Invite path + tenant list fix (unblocks new tenants immediately).
3. Identity fee + Stripe Identity session + webhooks.
4. Activation gate + notifications.
5. Manager badges + tenant Verify card.
6. Enable Stripe Identity in live mode; monitor first real verification.

## Open implementation details (resolve in plan, not blockers)

- Exact Identity fee cents and whether card processing fee stacks on the Identity fee.
- Hosted Stripe Identity URL vs embedded.
- Whether manager signature can complete before tenant Identity (yes per Gate C).
- Password-reset vs one-time invite token table (reuse existing reset tokens if suitable).
