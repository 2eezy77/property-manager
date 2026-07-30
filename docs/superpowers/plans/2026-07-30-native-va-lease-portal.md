# Native VA Room Lease Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers create a Montero Virginia room lease in-portal; tenant then property manager e-sign; tenant pays deposit (card / ACH / Cash App Pay) to activate; card also available for ongoing rent; Autopay stays ACH-only; Rocket Lawyer soft-deprecated for new native leases.

**Architecture:** Additive lease statuses + `signing_provider='native'`. Server generates PDFKit room-lease PDFs, stores signature audit on `envelope_signers`, flattens signed PDF. Deposit PaymentIntents (card/Cash App/ACH) allowed while lease is `awaiting_deposit`; Stripe webhook activates lease when deposit succeeds. Tenant Payments gains Stripe Payment Element for card rent.

**Tech Stack:** Express + `pg`, PDFKit, Stripe PaymentIntents + Payment Element (`@stripe/react-stripe-js`), existing Plaid Link, React/Vite client, script-style QA under `scripts/`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-30-native-va-lease-portal-design.md` (approved).
- Property defaults: 743 A Ave, Norfolk, VA 23504; landlords Jose Isaac Montero & Trevor McManas; PM Konstantin Patchell Hazlett.
- Room defaults: `regular` rent/deposit **$900**; `master` rent/deposit **$1,200**.
- Defaults: grace **0** days; late fee **$150** flat; NSF **$50**.
- Status path (native): `draft` → `pending_tenant_signature` → `pending_manager_signature` → `awaiting_deposit` → `active`.
- Pay methods for deposit + rent: **card · ACH · Cash App Pay**. Autopay: **ACH only**.
- Do not commit PII lease PDFs under `documents/leases/`.
- Keep RL readable for historical leases; hide RL create/interview for `signing_provider='native'`.
- Keep manager $350 signing fee via `ensureLeaseSigningFee` when native lease becomes fully signed / active (same hook point as RL completion — call when entering `awaiting_deposit` or `active`; prefer after both signatures).
- Follow existing script QA style (`scripts/lib/test-helpers.js`); no new Jest suite.
- Client already has `@stripe/stripe-js`; add `@stripe/react-stripe-js` for Payment Element.
- Do not break existing RL leases using `pending_signature` / `rocket_lawyer`.

## File structure (create / modify)

| Path | Responsibility |
|------|----------------|
| `src/db/migrations/041_native_va_lease.sql` | Status enum values + native lease columns + provider `native` |
| `src/services/native-lease.constants.js` | Room defaults, parties, property address |
| `src/services/lease-pdf.service.js` | Rebuild as Virginia **room** lease PDF (+ signed flatten helper) |
| `src/services/native-lease.service.js` | Create native draft, send for sign, apply signatures, ensure deposit row, activate |
| `src/routes/leases.routes.js` | Native create/PDF/sign/status endpoints; gate RL for native |
| `src/services/stripe.service.js` | `createCardPaymentIntent` |
| `src/services/rent-charge.service.js` | Allow `awaiting_deposit` for deposit charges |
| `src/routes/payments.routes.js` | Card create-intent; Cash App + ACH deposit while awaiting_deposit |
| `src/webhooks/stripe.webhook.js` | On deposit success → activate native lease |
| `client/package.json` | Add `@stripe/react-stripe-js` |
| `client/src/components/payments/CardPaymentForm.jsx` | Stripe Payment Element wrapper |
| `client/src/pages/manager/Leases.jsx` | Native create form; hide RL for native |
| `client/src/pages/tenant/Lease.jsx` | Preview, sign, finish-lease pay step |
| `client/src/pages/tenant/Payments.jsx` | Card method for rent/deposit |
| `client/src/utils/nativeLeaseHelpers.js` | Step derivation for native status |
| `scripts/test-native-lease.js` | API QA for status + defaults + deposit gate |
| `package.json` | `test:native-lease` script |

---

### Task 1: Migration + constants + room defaults helper

**Files:**
- Create: `src/db/migrations/041_native_va_lease.sql`
- Create: `src/services/native-lease.constants.js`
- Create: `scripts/test-native-lease-defaults.js`
- Modify: `package.json` (add script)

**Interfaces:**
- Produces: `ROOM_DEFAULTS`, `LEASE_PARTIES`, `PROPERTY_ADDRESS`, `defaultTermsForRoomType(roomType)` → `{ monthlyRent, securityDeposit, gracePeriodDays, lateFeeAmount, nsfFee }`
- Produces DB columns on `leases`: `signing_provider`, `room_type`, `nsf_fee`, `house_rules` (JSONB), `signed_pdf_path`, `tenant_signed_at`, `manager_signed_at`, `deposit_paid_at`
- Produces enum values: `pending_tenant_signature`, `pending_manager_signature`, `awaiting_deposit`
- Produces envelope provider allowlist includes `native`

- [ ] **Step 1: Write failing defaults test script**

Create `scripts/test-native-lease-defaults.js`:

```js
#!/usr/bin/env node
require('../src/config/env');
const assert = require('assert');
const { defaultTermsForRoomType, ROOM_DEFAULTS } = require('../src/services/native-lease.constants');

const regular = defaultTermsForRoomType('regular');
assert.strictEqual(regular.monthlyRent, 900);
assert.strictEqual(regular.securityDeposit, 900);
assert.strictEqual(regular.gracePeriodDays, 0);
assert.strictEqual(regular.lateFeeAmount, 150);
assert.strictEqual(regular.nsfFee, 50);

const master = defaultTermsForRoomType('master');
assert.strictEqual(master.monthlyRent, 1200);
assert.strictEqual(master.securityDeposit, 1200);

assert.throws(() => defaultTermsForRoomType('suite'), /room type/i);
console.log('OK native lease defaults');
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

Run: `node scripts/test-native-lease-defaults.js`  
Expected: `Cannot find module '../src/services/native-lease.constants'`

- [ ] **Step 3: Add constants module**

Create `src/services/native-lease.constants.js`:

```js
'use strict';

const PROPERTY_ADDRESS = {
  line1: '743 A Ave',
  city: 'Norfolk',
  state: 'VA',
  zip: '23504',
  full: '743 A Ave, Norfolk, VA 23504',
};

const LEASE_PARTIES = {
  landlords: [
    { name: 'Jose Isaac Montero' },
    { name: 'Trevor McManas' },
  ],
  propertyManager: {
    name: 'Konstantin Patchell Hazlett',
    title: 'Property Manager (as agent for Landlord)',
  },
};

const ROOM_DEFAULTS = {
  regular: { monthlyRent: 900, securityDeposit: 900 },
  master:  { monthlyRent: 1200, securityDeposit: 1200 },
};

const SHARED_DEFAULTS = {
  gracePeriodDays: 0,
  lateFeeType: 'flat',
  lateFeeAmount: 150,
  nsfFee: 50,
};

function defaultTermsForRoomType(roomType) {
  const key = String(roomType || '').toLowerCase();
  const room = ROOM_DEFAULTS[key];
  if (!room) {
    const err = new Error(`Unsupported room type: ${roomType}`);
    err.code = 'INVALID_ROOM_TYPE';
    throw err;
  }
  return {
    roomType: key,
    monthlyRent: room.monthlyRent,
    securityDeposit: room.securityDeposit,
    gracePeriodDays: SHARED_DEFAULTS.gracePeriodDays,
    lateFeeType: SHARED_DEFAULTS.lateFeeType,
    lateFeeAmount: SHARED_DEFAULTS.lateFeeAmount,
    nsfFee: SHARED_DEFAULTS.nsfFee,
  };
}

module.exports = {
  PROPERTY_ADDRESS,
  LEASE_PARTIES,
  ROOM_DEFAULTS,
  SHARED_DEFAULTS,
  defaultTermsForRoomType,
};
```

- [ ] **Step 4: Add migration `041_native_va_lease.sql`**

```sql
-- 041_native_va_lease.sql
-- Native Montero VA room lease: statuses, columns, envelope provider.

ALTER TYPE lease_status ADD VALUE IF NOT EXISTS 'pending_tenant_signature';
ALTER TYPE lease_status ADD VALUE IF NOT EXISTS 'pending_manager_signature';
ALTER TYPE lease_status ADD VALUE IF NOT EXISTS 'awaiting_deposit';

ALTER TABLE signature_envelopes
  DROP CONSTRAINT IF EXISTS signature_envelopes_provider_check;

ALTER TABLE signature_envelopes
  ADD CONSTRAINT signature_envelopes_provider_check
    CHECK (provider IN (
      'rocket_lawyer', 'docusign', 'dropbox_sign', 'rocketsign', 'local', 'native'
    ));

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS signing_provider VARCHAR(32),
  ADD COLUMN IF NOT EXISTS room_type VARCHAR(20)
    CHECK (room_type IS NULL OR room_type IN ('regular', 'master')),
  ADD COLUMN IF NOT EXISTS nsf_fee NUMERIC(10,2) DEFAULT 50,
  ADD COLUMN IF NOT EXISTS house_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS signed_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS tenant_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manager_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMPTZ;

ALTER TABLE envelope_signers
  ADD COLUMN IF NOT EXISTS signature_image TEXT,
  ADD COLUMN IF NOT EXISTS signed_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS signer_ip INET,
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

CREATE INDEX IF NOT EXISTS idx_leases_signing_provider
  ON leases (signing_provider)
  WHERE signing_provider IS NOT NULL;
```

- [ ] **Step 5: Wire npm script + migrate + pass defaults test**

In root `package.json` scripts add:
`"test:native-lease-defaults": "node scripts/test-native-lease-defaults.js"`

Run:
```bash
npm run db:migrate
npm run test:native-lease-defaults
```
Expected: migrate applies `041_…`; defaults script prints `OK native lease defaults`.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/041_native_va_lease.sql \
  src/services/native-lease.constants.js \
  scripts/test-native-lease-defaults.js package.json
git commit -m "feat(leases): native VA lease migration and room defaults"
```

---

### Task 2: Room lease PDF generator

**Files:**
- Modify: `src/services/lease-pdf.service.js` (rebuild primary export)
- Create: `scripts/test-native-lease-pdf.js`

**Interfaces:**
- Consumes: `LEASE_PARTIES`, `PROPERTY_ADDRESS` from constants
- Produces: `generateRoomLeasePdf(data)` → `{ filename, filepath, relativePath }`
  - `data`: `{ leaseId, tenantName, roomType, unitNumber, startDate, endDate, monthlyRent, securityDeposit, gracePeriodDays, lateFeeAmount, nsfFee, houseRules?, furnishings?, damageCharges? }`
- Produces: `flattenSignaturesOntoPdf({ sourcePath, outputFilename, signatures })` where `signatures` is `[{ role, name, signedAt, imageDataUrl? }]`
- Keep legacy `generateLeasePdf` as thin wrapper calling `generateRoomLeasePdf` with mapped fields OR replace callers (none today) — prefer rename export `generateLeasePdf = generateRoomLeasePdf` for compatibility.

- [ ] **Step 1: Write PDF smoke test (fails until generator exists)**

```js
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { generateRoomLeasePdf } = require('../src/services/lease-pdf.service');

(async () => {
  const result = await generateRoomLeasePdf({
    leaseId: '00000000-0000-4000-8000-000000000099',
    tenantName: 'Test Tenant',
    roomType: 'regular',
    unitNumber: 'A',
    startDate: '2026-08-01',
    endDate: '2027-07-31',
    monthlyRent: 900,
    securityDeposit: 900,
    gracePeriodDays: 0,
    lateFeeAmount: 150,
    nsfFee: 50,
    houseRules: { smoking: false, pets: false, quietHours: '10pm-8am', guestNights: 7 },
  });
  assert.ok(result.filepath);
  assert.ok(fs.existsSync(result.filepath));
  const buf = fs.readFileSync(result.filepath);
  assert.ok(buf.slice(0, 4).toString() === '%PDF');
  assert.ok(buf.length > 2000);
  // cleanup test artifact
  fs.unlinkSync(result.filepath);
  console.log('OK room lease PDF');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run — FAIL until export exists**

Run: `node scripts/test-native-lease-pdf.js`

- [ ] **Step 3: Implement room lease PDF**

Rebuild `lease-pdf.service.js` to generate a **Virginia Room Lease** titled for Montero Rentals with sections:

1. Parties (landlords + PM agent + tenant)  
2. Property / room type at 743 A Ave  
3. Term (start/end)  
4. Rent & payment (portal: card / ACH / Cash App Pay; late fee $150; grace 0; NSF)  
5. Security deposit  
6. Utilities (shared; billed/paid in Montero portal)  
7. Entry  
8. House rules (from `houseRules`)  
9. Furnishings / damage schedule (defaults OK)  
10. Governing law (VRLTA)  
11. Signature blocks (Tenant; Property Manager as agent)

Payment clause must **not** promote mail-to-NC / PayPal as primary.

Export:
```js
async function generateRoomLeasePdf(data) { /* PDFKit write to documents/lease-{id}.pdf */ }
async function flattenSignaturesOntoPdf({ sourcePath, outputFilename, signatures }) {
  // Minimal approach acceptable for v1: append a final signature page with names/timestamps
  // and optional PNG from data URL via PDFKit.image(Buffer). Prefer not adding pdf-lib unless needed.
}
module.exports = { generateRoomLeasePdf, generateLeasePdf: generateRoomLeasePdf, flattenSignaturesOntoPdf };
```

Write under `documents/` (existing static mount). Filename `lease-{leaseId}.pdf`; signed `lease-{leaseId}-signed.pdf`.

- [ ] **Step 4: Pass PDF test + commit**

```bash
node scripts/test-native-lease-pdf.js
git add src/services/lease-pdf.service.js scripts/test-native-lease-pdf.js
git commit -m "feat(leases): Montero Virginia room lease PDF generator"
```

---

### Task 3: Native lease service + API (create, PDF, send, sign)

**Files:**
- Create: `src/services/native-lease.service.js`
- Modify: `src/routes/leases.routes.js`
- Create: `client/src/utils/nativeLeaseHelpers.js`
- Extend: `scripts/test-native-lease.js` (API flow with local seed users)

**Interfaces:**
- `createNativeLease({ unitId, tenantId, roomType, startDate, endDate, overrides, houseRules, createdBy })` → lease row with `signing_provider='native'`, status `draft`, rent/deposit from defaults unless overrides
- `generateAndAttachPdf(leaseId)` → updates `pdf_path`, returns path
- `sendNativeForSignature(leaseId)` → creates `signature_envelopes` provider `native` with tenant (order 1) + manager (order 2); status → `pending_tenant_signature`
- `applyNativeSignature({ leaseId, userId, role, signedName, signatureImage, ip, userAgent })`  
  - Tenant only when `pending_tenant_signature` and `userId === tenant_id` → then `pending_manager_signature`  
  - Manager/staff when `pending_manager_signature` → flatten PDF, `awaiting_deposit`, create pending `security_deposit` payment, `ensureLeaseSigningFee(leaseId)`
- Routes (all under `/api/leases`, authenticate):
  - `POST /native` staffOnly — body includes `unit_id`, `tenant_id`, `room_type`, dates, optional money fields, `house_rules`
  - `POST /:id/native/pdf` staffOnly — generate PDF for native draft
  - `POST /:id/native/send` staffOnly — send for signature
  - `GET /:id/native/document` anyRole with access — stream/serve PDF URL (`/documents/...`)
  - `POST /:id/native/sign` anyRole — body `{ signedName, signatureImage? }` (type or draw)
  - Gate: `POST /:id/documents` and RL envelope create return **400** if `signing_provider='native'`

- [ ] **Step 1: Implement `native-lease.service.js` with the functions above**

Use transactions. Default `house_rules`:
```js
{ smoking: false, pets: false, quietHours: '10:00pm–8:00am', guestNights: 7 }
```

Pending deposit insert:
```sql
INSERT INTO payments (lease_id, tenant_id, amount, payment_type, status, period_start, period_end, due_date, metadata)
VALUES ($1, $2, $3, 'security_deposit', 'pending', $4, $4, $4,
        '{"source":"native_lease_activation"}'::jsonb);
```
(`period_start`/`due_date` = lease `start_date`).

- [ ] **Step 2: Wire routes in `leases.routes.js` BEFORE `/:id` catch-alls where needed**

Place `POST /native` next to `POST /`. For `POST /:id/native/*` mount after authenticate; ensure `GET /my` still first.

On RL `POST /:id/documents`:
```js
if (lease.signing_provider === 'native') {
  return res.status(400).json({ error: 'This lease uses native Montero signing, not Rocket Lawyer.' });
}
```

- [ ] **Step 3: Add `nativeLeaseHelpers.js`**

```js
export function deriveNativeLeaseStep(lease) {
  if (!lease || lease.signing_provider !== 'native') return null;
  switch (lease.status) {
    case 'draft': return 'draft';
    case 'pending_tenant_signature': return 'sign_tenant';
    case 'pending_manager_signature': return 'sign_manager';
    case 'awaiting_deposit': return 'pay_deposit';
    case 'active': return 'active';
    default: return lease.status;
  }
}
```

- [ ] **Step 4: API test script**

Create `scripts/test-native-lease.js` using `createReporter` + `req` from `scripts/lib/test-helpers.js` **or** local seed login (`owner@example.com` / `SMOKE_TEST_PASSWORD`) if smoke accounts absent. Flow:

1. Staff login  
2. Find a unit + tenant (seed)  
3. `POST /api/leases/native` room_type `regular` → assert rent 900  
4. `POST /api/leases/:id/native/pdf` → 200  
5. `POST /api/leases/:id/native/send` → status `pending_tenant_signature`  
6. Tenant `POST .../native/sign` → `pending_manager_signature`  
7. Manager sign → `awaiting_deposit`  
8. Assert pending security_deposit payment exists  
9. Assert `POST /api/leases/:id/documents` → 400  

Add `"test:native-lease": "node scripts/test-native-lease.js"` to `package.json`.

Run with API up: `npm run test:native-lease`

- [ ] **Step 5: Commit**

```bash
git add src/services/native-lease.service.js src/routes/leases.routes.js \
  client/src/utils/nativeLeaseHelpers.js scripts/test-native-lease.js package.json
git commit -m "feat(leases): native create, PDF, and e-sign API"
```

---

### Task 4: Deposit pay + activate (ACH / Cash App / card) + webhook

**Files:**
- Modify: `src/services/rent-charge.service.js`
- Modify: `src/services/stripe.service.js`
- Modify: `src/routes/payments.routes.js`
- Modify: `src/webhooks/stripe.webhook.js`
- Create: `src/services/native-lease-activate.service.js` (small)

**Interfaces:**
- `prepareTenantCharge`: for `paymentType==='security_deposit'`, allow lease status `IN ('active','awaiting_deposit')`; for rent keep `active` only.
- Same status relaxation on ACH charge path in `payments.routes.js` that duplicates the active check.
- `createCashAppPaymentIntent` route: allow `paymentType` `rent` | `security_deposit` (deposit only if lease `awaiting_deposit` or `active` with pending deposit).
- `createCardPaymentIntent({ amountCents, customerId, metadata, description })` → PI with `payment_method_types: ['card']`, `capture_method: 'automatic'`.
- New route `POST /api/payments/card/create-intent` tenantOnly — body `{ leaseId, paymentType: 'rent'|'security_deposit', includeFirstMonth?: boolean }`  
  - If `includeFirstMonth` and deposit: amount = deposit + monthly_rent; metadata `include_first_month=true`; may create/update pending rows so webhook can settle both (v1 acceptable: single PI amount covering deposit+rent with metadata; webhook marks deposit succeeded and inserts succeeded rent payment OR creates two pending rows linked by `metadata.bundle_id` — **prefer single deposit PI for activate + optional separate rent PI**; simplest v1: `includeFirstMonth` adds rent into one PI with `payment_type=security_deposit` and metadata `bundled_first_month_rent`, webhook activates + inserts succeeded rent payment for `monthly_rent`).
- `activateNativeLeaseAfterDeposit(client, leaseId)` → set `active`, `deposit_paid_at=NOW()` if status was `awaiting_deposit`.
- Webhook `onSucceeded`: if payment_type security_deposit (or metadata `payment_kind`) and lease `awaiting_deposit`, call activate helper.

- [ ] **Step 1: Implement activate helper**

```js
// src/services/native-lease-activate.service.js
async function activateNativeLeaseAfterDeposit(client, leaseId) {
  const { rows } = await client.query(
    `UPDATE leases
        SET status = 'active',
            deposit_paid_at = COALESCE(deposit_paid_at, NOW()),
            updated_at = NOW()
      WHERE id = $1
        AND signing_provider = 'native'
        AND status = 'awaiting_deposit'
      RETURNING id, status`,
    [leaseId]
  );
  return rows[0] || null;
}
module.exports = { activateNativeLeaseAfterDeposit };
```

- [ ] **Step 2: Relax deposit charge prep + ACH/Cash App routes; add card PI**

Stripe:
```js
async function createCardPaymentIntent({ amountCents, customerId, metadata = {}, description }) {
  return stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    customer: customerId,
    payment_method_types: ['card'],
    description,
    metadata,
  });
}
```

Export it from `module.exports`.

Card route mirrors Cash App create-intent: use `prepareTenantCharge` (extended), attach `stripe_payment_intent_id` on payment row, return `{ clientSecret, paymentIntentId, publishableKey }`.

- [ ] **Step 3: Webhook activation**

Inside `onSucceeded` after marking payment succeeded, if `payment_type === 'security_deposit'`:
```js
await activateNativeLeaseAfterDeposit(client, lease_id);
```
(same transaction as payment update when possible).

Handle bundled first month per metadata if implemented.

- [ ] **Step 4: Extend `scripts/test-native-lease.js`**

Add assertion: while `awaiting_deposit`, `prepare` path via `POST /api/payments/card/create-intent` with `{ leaseId, paymentType:'security_deposit' }` returns 200 + `clientSecret` (skip confirm if no charges_enabled — accept 200 create OR document skip when Stripe `charges_enabled` false).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(payments): deposit card/ACH/Cash App + activate native lease"
```

---

### Task 5: Manager UI — native create + soft-deprecate RL

**Files:**
- Modify: `client/src/pages/manager/Leases.jsx`

**Interfaces:**
- Create form adds `room_type` select (`regular`|`master`); prefills rent/deposit via client-side copy of defaults (900/1200); grace default 0; late fee 150.
- Submit calls `POST /api/leases/native` (not legacy `POST /api/leases`) when “Native VA room lease” path selected (default for new creates).
- After create: buttons Generate PDF / Send for signature (`/native/pdf`, `/native/send`).
- If `lease.signing_provider === 'native'`: hide “Start Rocket Lawyer interview” and RL send; show native status + PDF link.
- If RL historical (`rl_document_id` or provider rocket_lawyer): keep existing RL UI.

- [ ] **Step 1: Update create form + detail actions as above**
- [ ] **Step 2: Manual check in browser (manager login) — create regular lease, see $900 defaults**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(manager): native VA room lease create UI"
```

---

### Task 6: Tenant UI — e-sign + Finish lease pay

**Files:**
- Modify: `client/src/pages/tenant/Lease.jsx`
- Create: `client/src/components/leases/NativeSignPad.jsx` (type name + optional canvas draw → data URL)
- Create: `client/src/components/leases/FinishLeasePay.jsx`
- Create: `client/src/components/payments/CardPaymentForm.jsx`
- Modify: `client/package.json` — add `@stripe/react-stripe-js` matching stripe-js major as feasible

**Interfaces:**
- When `signing_provider==='native'`:
  - Show PDF iframe/link from `/documents/{pdf_path}` or API URL
  - If `pending_tenant_signature`: `NativeSignPad` → `POST /api/leases/:id/native/sign`
  - If `awaiting_deposit`: `FinishLeasePay` progress Signed → Pay deposit → Active; methods Card / ACH (Plaid) / Cash App; optional include first month; optional Autopay toggle (ACH bank required; does not block activate)
- Manager signing: manager opens same lease detail (Task 5) or tenant page N/A — manager signs from manager Leases detail via same `POST .../native/sign`

`CardPaymentForm`: props `{ clientSecret, onSuccess, onError }`; uses `Elements` + `PaymentElement` + `confirmPayment`.

`FinishLeasePay`:
1. Card → `POST /api/payments/card/create-intent` then `CardPaymentForm`
2. ACH → existing charge endpoint with `paymentType:'security_deposit'` (after bank linked via `usePlaidLink`)
3. Cash App → `POST /api/payments/cashapp/create-intent` with `paymentType:'security_deposit'`

- [ ] **Step 1: `npm install @stripe/react-stripe-js --prefix client`**
- [ ] **Step 2: Build components + wire Lease.jsx / manager sign UI**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(tenant): native e-sign and finish-lease deposit pay"
```

---

### Task 7: Card on ongoing tenant Payments + Autopay guard

**Files:**
- Modify: `client/src/pages/tenant/Payments.jsx`
- Modify: `src/routes/payments.routes.js` if rent card intent not fully covered in Task 4

**Interfaces:**
- Rent due UI offers **Card** alongside ACH and Cash App Pay.
- Card uses `POST /api/payments/card/create-intent` with `paymentType:'rent'`.
- Autopay toggle unchanged: requires linked bank; server autopay runner still `chargeACH` only — no card autopay path.
- Deposit card on Payments page also works when pending deposit exists (active or awaiting_deposit).

- [ ] **Step 1: Add Card button + CardPaymentForm to Payments.jsx**
- [ ] **Step 2: Verify Autopay copy still says bank/ACH only**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(payments): card Payment Element for tenant rent and deposit"
```

---

### Task 8: End-to-end QA script hardening + docs touch

**Files:**
- Modify: `scripts/test-native-lease.js` (full happy path assertions)
- Optional note in plan/spec only if needed — do not invent README novels

**Interfaces:**
- Script covers: defaults, native create, dual sign → awaiting_deposit, RL gated 400, card intent create for deposit.
- Run: `npm run test:native-lease-defaults && npm run test:native-lease-pdf && npm run test:native-lease`

- [ ] **Step 1: Ensure all three scripts pass against local API + DB**
- [ ] **Step 2: Commit any script fixes**

```bash
git commit -m "test(leases): harden native VA lease QA scripts"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Manager form + room defaults 900/1200 | 1, 3, 5 |
| VA room lease PDF | 2 |
| Tenant → PM e-sign | 3, 5, 6 |
| Awaiting deposit → pay → active | 3, 4, 6 |
| Card / ACH / Cash App deposit | 4, 6 |
| Card for ongoing rent; Autopay ACH-only | 4, 7 |
| Soft-deprecate RL for native | 3, 5 |
| Manager $350 fee hook | 3 (`ensureLeaseSigningFee`) |
| No PII PDFs in git | Global; tests delete artifacts |

**Placeholder scan:** none intentional.  
**Type consistency:** `signing_provider='native'`; statuses as listed; `paymentType` `security_deposit`|`rent`.
