# Utilities Portal-Pay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Montero’s utilities collections UX so tenants pay only in the portal, Autopay is the only auto-debit, managers remind/reconcile (no charge buttons), and off-app Cash App is soft-killed but still importable as labeled “off-app.”

**Architecture:** UI/copy-only cycle on existing Express + React portals. Keep `POST /api/utilities/bills/:id/charge` (UC06) in the API as emergency/legacy; remove it from Manager Utilities UI. Keep Gmail Cash App import; label `cash_app_import` rows. Add a tiny static guard script (no Jest in repo) that fails CI/local if the utilities scheduler gains ACH calls or charge buttons return to the UI.

**Tech Stack:** React 18 + Vite (`client/`), Express (`src/`), existing Stripe/Plaid/Autopay — no new processors.

**Spec:** `docs/superpowers/specs/2026-07-30-utilities-portal-pay-design.md`

## Global Constraints

- Montero-only portfolio — no multi-landlord packaging.
- Autopay is the **only** automatic debit path.
- Utilities workers: import → notify → remind — **never ACH**.
- Soft-kill off-app Cash App (hide cashtag guidance; keep import).
- Prefer UI/copy renames for status `charging` → label **Processing** (no schema rename).
- Do not delete UC06 API this cycle.
- No new unified Pay hub or rent+utilities collections cockpit this cycle.
- Repo has no Jest/Vitest; use `scripts/assert-portal-pay-guards.js` + manual UI checks.

## File map

| File | Responsibility |
|------|----------------|
| `scripts/assert-portal-pay-guards.js` | Static guards: scheduler never charges; Manager Utilities has no charge CTAs; tenant surfaces don’t promote cashtag |
| `package.json` | Add `npm run assert:portal-pay` script |
| `client/src/pages/manager/Utilities.jsx` | Remove ACH UI; rename Charging → Processing; fix ACH-initiated copy |
| `client/src/pages/tenant/Utilities.jsx` | Portal-pay + Autopay-only copy |
| `client/src/pages/tenant/Dashboard.jsx` | Remove outside-cashtag guidance |
| `client/src/pages/tenant/Payments.jsx` | Soft-kill outside cashtag / Venmo / Zelle promo line |
| `client/src/pages/manager/Payments.jsx` | Label `cash_app_import` as “Cash App (off-app)” |
| `client/src/pages/manager/Playbook.jsx` | Soften offline-payment help toward portal-first |
| `src/use-cases/utilities/catalog.js` | Mark UC06 legacy/emergency |
| `client/src/pages/manager/Utilities.jsx` header comment | UC06 not happy path |

---

### Task 1: Portal-pay static guard script

**Files:**
- Create: `scripts/assert-portal-pay-guards.js`
- Modify: `package.json` (scripts section)

**Interfaces:**
- Consumes: filesystem reads of known source files
- Produces: `npm run assert:portal-pay` exit 0 on pass, exit 1 on fail

- [ ] **Step 1: Write the failing guard script**

Create `scripts/assert-portal-pay-guards.js`:

```js
/**
 * Static guards for portal-pay / Autopay-only utilities model.
 * Run: npm run assert:portal-pay
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function mustNotContain(rel, patterns, why) {
  const src = read(rel);
  for (const p of patterns) {
    if (src.includes(p)) failures.push(`${rel}: must not contain ${JSON.stringify(p)} — ${why}`);
  }
}

function mustContain(rel, patterns, why) {
  const src = read(rel);
  for (const p of patterns) {
    if (!src.includes(p)) failures.push(`${rel}: must contain ${JSON.stringify(p)} — ${why}`);
  }
}

// Workers never ACH
mustNotContain(
  'src/services/utilities-scheduler.service.js',
  ['executeChargeBill', '/charge', 'chargeACH'],
  'utilities worker must never ACH'
);

// Manager Utilities UI must not expose charge CTAs (after Task 2)
mustNotContain(
  'client/src/pages/manager/Utilities.jsx',
  ['Charge all eligible', 'Charge this share', 'Retry charge', 'Advanced ACH', 'landlord ACH'],
  'manager utilities must not expose landlord ACH'
);

// Soft-kill cashtag on tenant surfaces (after Task 4)
mustNotContain(
  'client/src/pages/tenant/Dashboard.jsx',
  ['cashtag'],
  'do not promote off-app cashtag'
);
mustNotContain(
  'client/src/pages/tenant/Payments.jsx',
  ['Outside cashtag', 'cashtag'],
  'do not promote off-app cashtag'
);

// Processing label (after Task 2)
mustContain(
  'client/src/pages/manager/Utilities.jsx',
  ["label: 'Processing'", "['charging', 'Processing']"],
  'charging status shown as Processing in UI'
);

if (failures.length) {
  console.error('assert:portal-pay FAILED:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('assert:portal-pay OK');
```

Add to `package.json` scripts:

```json
"assert:portal-pay": "node scripts/assert-portal-pay-guards.js"
```

- [ ] **Step 2: Run guard — expect FAIL** (charge UI + cashtag still present)

```bash
npm run assert:portal-pay
```

Expected: exit 1 with failures mentioning `Charge all eligible` and/or `cashtag`.

- [ ] **Step 3: Commit**

```bash
git add scripts/assert-portal-pay-guards.js package.json
git commit -m "test: add static portal-pay guards for utilities ACH and cashtag"
```

---

### Task 2: Manager Utilities — remove ACH UI; Charging → Processing

**Files:**
- Modify: `client/src/pages/manager/Utilities.jsx`

**Interfaces:**
- Consumes: existing `/api/utilities/*` notify/waive/reject/remind/balances (unchanged)
- Produces: Manager UI with no charge controls; status label Processing

- [ ] **Step 1: Update file header use-case list**

Replace the UC6 line in the top comment block:

```js
 *   UC6  Charge ACH                  → legacy/emergency API only (not shown in UI)
```

- [ ] **Step 2: Rename status labels Charging → Processing**

In `BILL_STATUS_META` and `SPLIT_STATUS_META`, change:

```js
charging:  { label: 'Processing', color: 'bg-amber-100 text-amber-700' },
```

In balances filter chips, change:

```js
['charging', 'Processing'],
```

- [ ] **Step 3: Remove per-split Advanced ACH block from `TenantCard`**

Delete `canCharge` and the entire `<details>…Advanced ACH…</details>` block (charge / retry buttons).

Change charging detail copy from ACH-initiated to portal processing:

```js
{split.status === 'charging' && (
  <p className="text-xs text-blue-600 mb-3">Payment processing — usually settles in a few business days</p>
)}
```

- [ ] **Step 4: Remove charge-all from `BillDetail`**

1. Delete `handleChargeAll` function entirely.
2. In `handleSplitAction`, remove the `charge` / `retry` branches (keep waive / reject).
3. Delete `canCharge` variable usage and the entire `<details>Advanced — landlord ACH…</details>` block.
4. Ensure Notify / Remind / dispute actions remain.

- [ ] **Step 5: Manual UI check**

```bash
cd client && npm run dev
# open Manager → Utilities with a notified bill if available
```

Expected: no “Charge”, “Advanced ACH”, or “landlord ACH” text; filter shows Processing.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/manager/Utilities.jsx
git commit -m "feat(utilities): hide landlord ACH; show Processing instead of Charging"
```

---

### Task 3: Tenant Utilities — portal-pay copy

**Files:**
- Modify: `client/src/pages/tenant/Utilities.jsx`

**Interfaces:**
- Consumes: `GET /api/utilities/my-splits` (unchanged)
- Produces: Copy that Autopay is the only auto-debit; CTA to `/tenant/payments`

- [ ] **Step 1: Update How-to-pay banner**

Replace the indigo “How to pay” paragraph + CTA block copy with:

```jsx
<div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-slate-700">
  <p className="font-medium text-slate-900">Pay in the portal</p>
  <p className="mt-1 text-xs leading-relaxed text-slate-600">
    Open shares are paid under{' '}
    <Link to="/tenant/payments" className="font-medium text-indigo-700 hover:underline">Payments</Link>
    {' '}(bank ACH or Cash App Pay). We only auto-debit if you turn on Autopay.
  </p>
  {openTotal > 0 && (
    <Link
      to="/tenant/payments"
      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
    >
      <CreditCard size={16} strokeWidth={2} />
      Pay {fmt(openTotal)} in Payments
    </Link>
  )}
</div>
```

Keep per-row `Pay in Payments` links and dispute flow unchanged.

- [ ] **Step 2: Manual check**

Open `/tenant/utilities` (seed/impersonate a tenant if needed). Confirm CTA and Autopay sentence; no cashtag mention.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/tenant/Utilities.jsx
git commit -m "feat(utilities): clarify tenant portal-pay and Autopay-only debit"
```

---

### Task 4: Soft-kill off-app cashtag on tenant Dashboard + Payments

**Files:**
- Modify: `client/src/pages/tenant/Dashboard.jsx`
- Modify: `client/src/pages/tenant/Payments.jsx`

**Interfaces:**
- Consumes: existing rent balance / pay flows
- Produces: Portal-first copy; no cashtag promotion

- [ ] **Step 1: Fix Dashboard pay card copy**

Replace the blue “Pay rent in the portal” body paragraph (~lines 354–356) with:

```jsx
<p className="mt-1 text-xs leading-relaxed text-blue-900/80">
  Autopay waives late fees. Pay with bank ACH or Cash App Pay on Payments — we only auto-debit if Autopay is on.
  {balance?.securityDepositPayment
    ? ` Security deposit still due (${fmt(balance.securityDepositPayment.amount)}).`
    : ''}
</p>
```

- [ ] **Step 2: Fix Payments “Pay here” list**

In the `Pay here for the cleanest record` `<ul>`, replace the third `<li>` (Outside cashtag…) with:

```jsx
<li>
  <strong className="font-semibold">Autopay is opt-in</strong>
  {' — we never auto-debit rent or utilities unless Autopay is enabled.'}
</li>
```

Keep the Autopay + bank and Cash App **in this page** bullets. Do not remove portal Cash App Pay buttons.

- [ ] **Step 3: Grep check**

```bash
rg -n 'cashtag' client/src/pages/tenant/
```

Expected: no matches under `client/src/pages/tenant/`.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/tenant/Dashboard.jsx client/src/pages/tenant/Payments.jsx
git commit -m "feat(payments): soft-kill off-app cashtag guidance for tenants"
```

---

### Task 5: Manager Payments — label off-app Cash App imports

**Files:**
- Modify: `client/src/pages/manager/Payments.jsx`
- Modify: `client/src/pages/manager/Playbook.jsx` (portal-first offline help)

**Interfaces:**
- Consumes: payment list fields `source`, `payment_method` (unchanged API)
- Produces: Method column distinguishes portal vs off-app Cash App

- [ ] **Step 1: Update `paymentMethodLabel`**

```js
function paymentMethodLabel(p) {
  if (p.payment_method) {
    const base = METHOD_LABEL[p.payment_method] || p.payment_method;
    return p.partial_rent === 'true' ? `${base} (partial)` : base;
  }
  if (p.source === 'cash_app_import') return 'Cash App (off-app)';
  if (p.source === 'stripe_cashapp') return 'Cash App Pay';
  if (p.stripe_payment_intent_id) return 'Bank (ACH)';
  if (p.status === 'succeeded') return 'ACH';
  return '—';
}
```

- [ ] **Step 2: Keep Sync; tighten empty-state (already portal-first)**

Empty state text already says portal ACH / Cash App Pay — leave it. Optionally add under the Sync button a one-line hint if none exists:

```jsx
<p className="text-xs text-slate-500">Safety net for off-app Cash App emails — prefer tenants pay in the portal.</p>
```

Place it near the Sync Cash App control without changing sync behavior.

- [ ] **Step 3: Playbook offline-payments help**

In `Playbook.jsx` `cashapp_imports.help`, replace with:

```js
help: 'Prefer tenants pay in the portal (ACH or Cash App Pay). If someone paid outside the app (Cash App, Zelle, check), record or sync it under Payments so the ledger matches.',
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/manager/Payments.jsx client/src/pages/manager/Playbook.jsx
git commit -m "feat(payments): label off-app Cash App imports for managers"
```

---

### Task 6: Catalog — UC06 legacy/emergency

**Files:**
- Modify: `src/use-cases/utilities/catalog.js`

**Interfaces:**
- Consumes: none at runtime from UI
- Produces: Documented UC06 as legacy so future agents don’t re-add charge UI as happy path

- [ ] **Step 1: Update UC06 entry**

```js
UC06: {
  id: 'UC06',
  name: 'Charge ACH (legacy / emergency)',
  actor: 'Owner, Property Manager',
  goal: 'Emergency debit of non-disputed shares via Stripe ACH — not the happy path. Tenants normally pay in the portal; Autopay is the only automatic debit.',
  preconditions: ['Bill is notified or charging', 'Tenant has verified bank account', 'Staff intentionally using emergency API'],
  postconditions: ['Payment row created', 'Split status is charging'],
  endpoint: 'POST /api/utilities/bills/:id/charge',
  ui: 'Not shown in Manager Utilities (portal-pay model)',
},
```

- [ ] **Step 2: Commit**

```bash
git add src/use-cases/utilities/catalog.js
git commit -m "docs(utilities): mark UC06 charge ACH as legacy emergency API"
```

---

### Task 7: Guards green + end-to-end smoke checklist

**Files:**
- Modify: `scripts/assert-portal-pay-guards.js` only if Task 2/4 changed string shapes (e.g. Processing label patterns)

**Interfaces:**
- Consumes: Tasks 1–6 deliverables
- Produces: `npm run assert:portal-pay` exit 0

- [ ] **Step 1: Align guard patterns with final UI strings**

If Processing is set via object form only, ensure `mustContain` matches actual source, for example:

```js
mustContain(
  'client/src/pages/manager/Utilities.jsx',
  ["label: 'Processing'", "['charging', 'Processing']"],
  'charging status shown as Processing in UI'
);
```

If one of those strings isn’t present, adjust the guard to the exact final source (not the product requirement).

- [ ] **Step 2: Run guards**

```bash
npm run assert:portal-pay
```

Expected: `assert:portal-pay OK`

- [ ] **Step 3: Manual acceptance checklist**

1. Manager → Utilities: Balances filters include Processing; no Charge / Advanced ACH.
2. Manager → bill detail: Notify/Remind/Waive/Reject only.
3. Tenant → Utilities: Pay CTA → `/tenant/payments`; Autopay-only auto-debit copy.
4. Tenant → Dashboard/Payments: no cashtag / “outside” payment promo.
5. Manager → Payments: imported Cash App shows **Cash App (off-app)**; portal Stripe Cash App shows **Cash App Pay**.
6. Confirm `src/services/utilities-scheduler.service.js` still has no charge calls (`rg 'executeChargeBill|/charge|chargeACH' src/services/utilities-scheduler.service.js` → no matches).

- [ ] **Step 4: Final commit if guard tweaks needed**

```bash
git add scripts/assert-portal-pay-guards.js
git commit -m "test: finalize portal-pay guard patterns"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Manager balances board; no charge UI | Task 2 |
| Charging → Processing UI label | Task 2 |
| Tenant Utilities → Payments CTA + Autopay copy | Task 3 |
| Soft-kill cashtag on tenant surfaces | Task 4 |
| Label off-app imports; keep Sync | Task 5 |
| Workers never ACH (guard + existing scheduler) | Tasks 1, 7 |
| UC06 API remains, marked legacy | Task 6 |
| Autopay-only auto-debit messaging | Tasks 3, 4 |
| No Pay hub / collections cockpit | Out of scope (honored) |

## Placeholder / consistency check

- No TBD/TODO left in tasks.
- Guard script patterns must match final strings from Tasks 2 and 4.
- UC06 endpoint path unchanged: `POST /api/utilities/bills/:id/charge`.
