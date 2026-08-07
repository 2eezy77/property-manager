# Utility House Cover (Monthly Pool) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For 743 A Ave, subtract `$100 × active tenants` from each calendar month’s combined utilities, then split only the leftover to tenants (vacant rooms don’t count; other properties unchanged).

**Architecture:** Add a property setting `utility_house_cover_per_tenant`, pure allocation helpers in utilities domain, and route all split create/refresh paths through a month-wide cover allocator before existing occupancy/electric splitters. Persist per-bill `house_cover_applied` / `tenant_pool_amount` for UI. Freeze `paid` / `waived` / `charging` splits on recalc.

**Tech Stack:** Express + `pg` (`src/`), React/Vite client, SQL migrations under `src/db/migrations/`, Node assert scripts (no Jest).

**Spec:** `docs/superpowers/specs/2026-08-07-utility-house-cover-monthly-pool-design.md`

## Global Constraints

- Scope: **743 A Ave only** seeded to `$100`; other properties default `0`.
- Rate: **`$100 × active leases overlapping the bill month`**.
- Application: **monthly combined pool**, pro-rated onto that month’s bills.
- Vacant rooms do **not** get a `$100`.
- Already-`paid` / `waived` / `charging` splits are **frozen** (no clawback).
- Do not reuse `dominion_owner_paid_through` or `tenant_charge_amount` for house cover.
- Portal-pay / Autopay / dispute rules unchanged.
- Repo has no Jest — use `scripts/test-*.js` assert scripts.

## File map

| File | Responsibility |
|------|----------------|
| `src/db/migrations/043_utility_house_cover.sql` | Columns + seed 743 |
| `src/use-cases/utilities/house-cover.js` | Pure month allocation math (testable without DB) |
| `scripts/test-utility-house-cover.js` | Unit asserts for allocation + worked July example |
| `src/use-cases/utilities/domain.js` | Wire cover into `computeSplitsForBill` / refresh / insert; preserve frozen splits; month-wide refresh |
| `src/use-cases/utilities/monthly-billing.js` | Use shared refresh that applies cover |
| `src/use-cases/utilities/uc-recalculate-splits.js` | Recalc via month-aware refresh |
| `src/use-cases/utilities/queries.js` | Expose cover fields on bill detail + tenant splits |
| `src/routes/properties.routes.js` | Allow PATCH `utility_house_cover_per_tenant` |
| `client/src/pages/manager/Utilities.jsx` | Show bill − house cover → tenant pool |
| `client/src/pages/tenant/Utilities.jsx` | Show covered / $0 copy on shares |
| `package.json` | Add `test:utility-house-cover` script |

---

### Task 1: Pure allocation helpers + failing tests

**Files:**
- Create: `src/use-cases/utilities/house-cover.js`
- Create: `scripts/test-utility-house-cover.js`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: bill-like objects with `id`, amounts via caller-provided `getAmount(bill)`
- Produces:
  - `billingMonthKey(dateStr) → 'YYYY-MM' | null`
  - `leasesOverlapMonth(lease, yearMonth) → boolean`
  - `countActiveLeasesForMonth(leases, yearMonth) → number`
  - `allocateMonthlyHouseCover({ bills, coverPerTenant, activeLeaseCount, getAmount }) → { combined, coverTotal, tenantPool, byBillId: { [billId]: { houseCoverApplied, tenantPoolAmount } } }`

- [ ] **Step 1: Write the failing test script**

Create `scripts/test-utility-house-cover.js`:

```js
/**
 * Unit tests for utility house-cover monthly pool math.
 * Run: npm run test:utility-house-cover
 */
const assert = require('assert');
const {
  billingMonthKey,
  leasesOverlapMonth,
  countActiveLeasesForMonth,
  allocateMonthlyHouseCover,
} = require('../src/use-cases/utilities/house-cover');

function getAmount(b) {
  if (b.tenant_charge_amount != null && b.tenant_charge_amount !== '') {
    return Number(b.tenant_charge_amount);
  }
  return Number(b.total_amount);
}

// billingMonthKey
assert.strictEqual(billingMonthKey('2026-07-01'), '2026-07');
assert.strictEqual(billingMonthKey('2026-07-15T12:00:00Z'), '2026-07');
assert.strictEqual(billingMonthKey(null), null);

// lease overlap: active all July
assert.strictEqual(
  leasesOverlapMonth({ start_date: '2025-10-01', end_date: '2026-12-31' }, '2026-07'),
  true
);
// starts after July
assert.strictEqual(
  leasesOverlapMonth({ start_date: '2026-08-01', end_date: '2027-01-01' }, '2026-07'),
  false
);
// ended before July
assert.strictEqual(
  leasesOverlapMonth({ start_date: '2026-01-01', end_date: '2026-06-30' }, '2026-07'),
  false
);

const fourTenants = [
  { id: 'l1', start_date: '2025-01-01', end_date: '2027-01-01' },
  { id: 'l2', start_date: '2025-01-01', end_date: '2027-01-01' },
  { id: 'l3', start_date: '2025-01-01', end_date: '2027-01-01' },
  { id: 'l4', start_date: '2025-01-01', end_date: '2027-01-01' },
];
assert.strictEqual(countActiveLeasesForMonth(fourTenants, '2026-07'), 4);

// Worked example: July electric $731.70, 4 tenants, $100 each → pool $331.70
{
  const bills = [{ id: 'elec', total_amount: 731.7, tenant_charge_amount: 731.7 }];
  const r = allocateMonthlyHouseCover({
    bills,
    coverPerTenant: 100,
    activeLeaseCount: 4,
    getAmount,
  });
  assert.strictEqual(r.combined, 731.7);
  assert.strictEqual(r.coverTotal, 400);
  assert.ok(Math.abs(r.tenantPool - 331.7) < 0.001);
  assert.ok(Math.abs(r.byBillId.elec.tenantPoolAmount - 331.7) < 0.001);
  assert.ok(Math.abs(r.byBillId.elec.houseCoverApplied - 400) < 0.001);
}

// Cover >= combined → $0
{
  const bills = [{ id: 'water', total_amount: 165.74 }];
  const r = allocateMonthlyHouseCover({
    bills,
    coverPerTenant: 100,
    activeLeaseCount: 4,
    getAmount,
  });
  assert.strictEqual(r.tenantPool, 0);
  assert.strictEqual(r.byBillId.water.tenantPoolAmount, 0);
  assert.strictEqual(r.byBillId.water.houseCoverApplied, 165.74);
}

// Two bills pro-rate; cent remainder lands on last bill
{
  const bills = [
    { id: 'a', total_amount: 200 },
    { id: 'b', total_amount: 100 },
  ];
  const r = allocateMonthlyHouseCover({
    bills,
    coverPerTenant: 100,
    activeLeaseCount: 1, // cover $100; pool $200
    getAmount,
  });
  assert.strictEqual(r.combined, 300);
  assert.strictEqual(r.coverTotal, 100);
  assert.strictEqual(r.tenantPool, 200);
  const a = r.byBillId.a.tenantPoolAmount;
  const b = r.byBillId.b.tenantPoolAmount;
  assert.ok(Math.abs(a + b - 200) < 0.001);
  // a should be ~133.33, b ~66.67
  assert.ok(Math.abs(a - 133.33) < 0.02);
  assert.ok(Math.abs(b - 66.67) < 0.02);
}

// coverPerTenant 0 → full amounts
{
  const bills = [{ id: 'x', total_amount: 50 }];
  const r = allocateMonthlyHouseCover({
    bills,
    coverPerTenant: 0,
    activeLeaseCount: 4,
    getAmount,
  });
  assert.strictEqual(r.coverTotal, 0);
  assert.strictEqual(r.tenantPool, 50);
  assert.strictEqual(r.byBillId.x.tenantPoolAmount, 50);
}

console.log('test-utility-house-cover: OK');
```

- [ ] **Step 2: Add npm script and run — expect FAIL (module missing)**

In `package.json` scripts, add:

```json
"test:utility-house-cover": "node scripts/test-utility-house-cover.js"
```

Run: `npm run test:utility-house-cover`  
Expected: FAIL with `Cannot find module '../src/use-cases/utilities/house-cover'`

- [ ] **Step 3: Implement `house-cover.js`**

Create `src/use-cases/utilities/house-cover.js`:

```js
/**
 * Monthly house-cover allocation for utilities.
 * Pure functions — no DB.
 */

function billingMonthKey(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).slice(0, 10);
  return s.length >= 7 ? s.slice(0, 7) : null;
}

function monthBounds(yearMonth) {
  const [y, m] = String(yearMonth).split('-').map(Number);
  if (!y || !m) return null;
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function dayOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

/** Lease overlaps calendar month if start <= monthEnd AND end >= monthStart. */
function leasesOverlapMonth(lease, yearMonth) {
  const bounds = monthBounds(yearMonth);
  if (!bounds) return false;
  const ls = dayOnly(lease.start_date);
  const le = dayOnly(lease.end_date) || '9999-12-31';
  if (!ls) return false;
  return ls <= bounds.end && le >= bounds.start;
}

function countActiveLeasesForMonth(leases, yearMonth) {
  return (leases || []).filter((l) => leasesOverlapMonth(l, yearMonth)).length;
}

/**
 * Pro-rate monthly house cover across bills.
 * Amounts are dollars (number). Cent-safe via integer cents; remainder on last bill.
 */
function allocateMonthlyHouseCover({
  bills,
  coverPerTenant,
  activeLeaseCount,
  getAmount,
}) {
  const list = Array.isArray(bills) ? bills : [];
  const amounts = list.map((b) => {
    const raw = Number(getAmount(b));
    const cents = Number.isFinite(raw) ? Math.round(raw * 100) : 0;
    return { id: b.id, cents: Math.max(0, cents) };
  });

  const combinedCents = amounts.reduce((s, a) => s + a.cents, 0);
  const rate = Math.max(0, Number(coverPerTenant) || 0);
  const n = Math.max(0, Number(activeLeaseCount) || 0);
  const coverCents = Math.round(rate * 100) * n;
  const appliedCoverCents = Math.min(coverCents, combinedCents);
  const tenantPoolCents = Math.max(0, combinedCents - appliedCoverCents);

  const byBillId = {};
  if (!amounts.length) {
    return {
      combined: combinedCents / 100,
      coverTotal: coverCents / 100,
      tenantPool: tenantPoolCents / 100,
      byBillId,
    };
  }

  if (combinedCents === 0) {
    for (const a of amounts) {
      byBillId[a.id] = { houseCoverApplied: 0, tenantPoolAmount: 0 };
    }
  } else {
    let allocatedPool = 0;
    let allocatedCover = 0;
    for (let i = 0; i < amounts.length; i++) {
      const a = amounts[i];
      const isLast = i === amounts.length - 1;
      let poolCents;
      let coverShareCents;
      if (isLast) {
        poolCents = tenantPoolCents - allocatedPool;
        coverShareCents = appliedCoverCents - allocatedCover;
      } else {
        poolCents = Math.floor((tenantPoolCents * a.cents) / combinedCents);
        coverShareCents = Math.floor((appliedCoverCents * a.cents) / combinedCents);
        allocatedPool += poolCents;
        allocatedCover += coverShareCents;
      }
      byBillId[a.id] = {
        houseCoverApplied: coverShareCents / 100,
        tenantPoolAmount: poolCents / 100,
      };
    }
  }

  return {
    combined: combinedCents / 100,
    coverTotal: coverCents / 100,
    tenantPool: tenantPoolCents / 100,
    byBillId,
  };
}

module.exports = {
  billingMonthKey,
  monthBounds,
  leasesOverlapMonth,
  countActiveLeasesForMonth,
  allocateMonthlyHouseCover,
};
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm run test:utility-house-cover`  
Expected: `test-utility-house-cover: OK`

- [ ] **Step 5: Commit**

```bash
git add src/use-cases/utilities/house-cover.js scripts/test-utility-house-cover.js package.json
git commit -m "feat(utilities): add monthly house-cover allocation helpers"
```

---

### Task 2: Migration — columns + seed 743

**Files:**
- Create: `src/db/migrations/043_utility_house_cover.sql`

**Interfaces:**
- Consumes: existing `properties`, `utility_bills`
- Produces: `properties.utility_house_cover_per_tenant`, `utility_bills.house_cover_applied`, `utility_bills.tenant_pool_amount`

- [ ] **Step 1: Write migration**

Create `src/db/migrations/043_utility_house_cover.sql`:

```sql
-- House cover: $N × active tenants applied to combined monthly utilities.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS utility_house_cover_per_tenant NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (utility_house_cover_per_tenant >= 0);

ALTER TABLE utility_bills
  ADD COLUMN IF NOT EXISTS house_cover_applied NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tenant_pool_amount NUMERIC(10,2);

-- Seed 743 A Ave only (prod id + name match for safety).
UPDATE properties
   SET utility_house_cover_per_tenant = 100.00
 WHERE utility_house_cover_per_tenant = 0
   AND (
     id = 'cccccccc-0000-0000-0000-000000000001'
     OR name = '743 A Ave'
   );
```

- [ ] **Step 2: Apply migration locally (or against linked DB)**

Run: `npm run db:migrate`  
Expected: log includes applying `043_utility_house_cover.sql` (or “already applied”).

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/043_utility_house_cover.sql
git commit -m "feat(db): add utility house cover columns and seed 743"
```

---

### Task 3: Wire cover into domain refresh (month-wide + freeze paid)

**Files:**
- Modify: `src/use-cases/utilities/domain.js`
- Modify: `src/use-cases/utilities/monthly-billing.js` (delegate to domain refresh)
- Modify: `src/use-cases/utilities/uc-recalculate-splits.js` (optional: group by property-month; calling month-aware refresh per bill is OK if refresh is idempotent for the whole month)

**Interfaces:**
- Consumes: `allocateMonthlyHouseCover`, `billingMonthKey`, `countActiveLeasesForMonth` from `./house-cover`; `getBillSplitAmount`
- Produces:
  - `async function loadPropertyHouseCover(client, propertyId) → number`
  - `async function refreshPropertyMonthSplits(client, { propertyId, yearMonth }) → { billsRefreshed, allocation }`
  - Updated `refreshBillSplitsForBill` → calls month refresh for that bill’s month
  - Updated `insertBillWithSplits` → after insert, call month refresh (or compute cover before insert using sibling drafts)

**Frozen statuses:** `paid`, `waived`, `charging` — do not delete/replace those split rows; exclude their bill amounts from redistributable pool per spec (if a bill has any frozen split, treat that bill’s full split-base as frozen contribution already collected/resolved; remaining open bills share `max(0, tenantPool − sum(frozen bill bases capped by pool logic))` — **simpler implementable rule for v1:**

**v1 freeze rule (implement exactly this):**
1. Load all bills for `propertyId` in `yearMonth` with status in `draft|notified|charging|settled` that still have splits, OR status in `draft|notified|charging` only (match recalc query). Prefer: same set as recalc — `draft|notified|charging`.
2. For each bill, load splits. If **any** split is `paid|waived|charging`, skip mutating that bill (leave amounts + cover columns as-is). Still include its `getBillSplitAmount` in `combined` for display math when computing siblings? Spec: frozen bills’ paid amounts stay; remaining open bills get cover redistributed.

**Implementable algorithm:**
1. `coverPerTenant = loadPropertyHouseCover`
2. If `coverPerTenant <= 0`, refresh each mutable bill with full `getBillSplitAmount` (today’s behavior) and set `house_cover_applied=0`, `tenant_pool_amount=splitAmount`.
3. Else:
   - `monthLeases = loadActiveLeases(client, propertyId, monthStart, monthEnd)` using `monthBounds(yearMonth)`
   - `activeCount = countActiveLeasesForMonth(monthLeases, yearMonth)`
   - Partition bills into `frozen` (has paid/waived/charging split) vs `mutable`
   - `allocation = allocateMonthlyHouseCover({ bills: allMonthBills, coverPerTenant, activeLeaseCount: activeCount, getAmount: getBillSplitAmount })`
   - For each **mutable** bill: use `allocation.byBillId[bill.id].tenantPoolAmount` as `splitAmount` in `computeSplitsForBill`; DELETE only non-frozen splits… **simpler:** DELETE all splits on mutable bills only, re-insert pending with new amounts; UPDATE bill `house_cover_applied`, `tenant_pool_amount`.
   - For frozen bills: leave splits; optionally UPDATE cover columns from allocation for UI only without changing split amounts.

- [ ] **Step 1: Extend tests for freeze / multi-bill in `scripts/test-utility-house-cover.js`**

Append asserts that `allocateMonthlyHouseCover` still works when only mutable bills are passed (caller filters). No new exports required.

- [ ] **Step 2: Implement domain wiring**

In `domain.js`:

1. `require('./house-cover')`.
2. Add:

```js
async function loadPropertyHouseCover(client, propertyId) {
  const { rows } = await client.query(
    `SELECT utility_house_cover_per_tenant FROM properties WHERE id = $1`,
    [propertyId]
  );
  return Number(rows[0]?.utility_house_cover_per_tenant || 0);
}

async function listBillsForPropertyMonth(client, propertyId, yearMonth) {
  const { rows } = await client.query(
    `SELECT *
       FROM utility_bills
      WHERE property_id = $1
        AND to_char(COALESCE(period_start, created_at), 'YYYY-MM') = $2
        AND status IN ('draft', 'notified', 'charging')
      ORDER BY service_type ASC, created_at ASC`,
    [propertyId, yearMonth]
  );
  return rows;
}

async function billHasFrozenSplits(client, billId) {
  const { rows } = await client.query(
    `SELECT 1 FROM utility_bill_splits
      WHERE bill_id = $1 AND status = ANY($2::text[])
      LIMIT 1`,
    [billId, ['paid', 'waived', 'charging']]
  );
  return rows.length > 0;
}

async function refreshPropertyMonthSplits(client, { propertyId, yearMonth }) {
  const coverPerTenant = await loadPropertyHouseCover(client, propertyId);
  const bills = await listBillsForPropertyMonth(client, propertyId, yearMonth);
  if (!bills.length) return { billsRefreshed: 0, allocation: null };

  const bounds = require('./house-cover').monthBounds(yearMonth);
  const monthLeases = await loadActiveLeases(client, propertyId, bounds.start, bounds.end);
  const activeLeaseCount = require('./house-cover').countActiveLeasesForMonth(monthLeases, yearMonth);
  const { allocateMonthlyHouseCover } = require('./house-cover');

  const allocation = allocateMonthlyHouseCover({
    bills,
    coverPerTenant,
    activeLeaseCount,
    getAmount: getBillSplitAmount,
  });

  let refreshed = 0;
  for (const bill of bills) {
    const frozen = await billHasFrozenSplits(client, bill.id);
    const alloc = allocation.byBillId[bill.id] || { houseCoverApplied: 0, tenantPoolAmount: getBillSplitAmount(bill) };

    await client.query(
      `UPDATE utility_bills
          SET house_cover_applied = $2,
              tenant_pool_amount = $3,
              updated_at = NOW()
        WHERE id = $1`,
      [bill.id, alloc.houseCoverApplied, alloc.tenantPoolAmount]
    );

    if (frozen) continue;

    const leases = await loadActiveLeases(client, bill.property_id, bill.period_start, bill.period_end);
    const splitAmount = coverPerTenant > 0 ? alloc.tenantPoolAmount : getBillSplitAmount(bill);
    const splits = await computeSplitsForBill(client, {
      propertyId: bill.property_id,
      service_type: bill.service_type,
      leases,
      bill,
      splitAmount,
      period_start: bill.period_start,
      period_end: bill.period_end,
    });

    await client.query('DELETE FROM utility_bill_splits WHERE bill_id = $1', [bill.id]);
    for (const s of splits) {
      await client.query(
        `INSERT INTO utility_bill_splits (bill_id, lease_id, tenant_id, amount, status)
         VALUES ($1,$2,$3,$4,'pending')`,
        [bill.id, s.leaseId, s.tenantId, s.amount]
      );
    }
    refreshed += 1;
  }

  return { billsRefreshed: refreshed, allocation, activeLeaseCount, coverPerTenant };
}
```

3. Change `refreshBillSplitsForBill` to:

```js
async function refreshBillSplitsForBill(client, bill) {
  const ym = require('./house-cover').billingMonthKey(bill.period_start || bill.created_at);
  if (!ym) {
    // fallback: old single-bill path without cover
    // ... keep previous delete/reinsert using getBillSplitAmount ...
  }
  return refreshPropertyMonthSplits(client, {
    propertyId: bill.property_id,
    yearMonth: ym,
  });
}
```

Adjust return shape used by `uc-recalculate-splits.js`: today it expects `{ splits: computed }`. Either:
- Update recalc to not depend on returned split rows (re-query), or
- Have `refreshBillSplitsForBill` still return `{ splits }` for the **requested** bill after month refresh (re-query splits for `bill.id`).

Prefer: after month refresh, re-query splits for `bill.id` and return `{ leases, splits }` compatible with recalc.

4. Change `insertBillWithSplits` to insert the bill first (with placeholder splits empty or temporary), then `refreshPropertyMonthSplits` for that month so cover includes the new bill. Simplest path:

```js
// after INSERT bill ...
const ym = billingMonthKey(period_start);
await refreshPropertyMonthSplits(client, { propertyId, yearMonth: ym });
return bill; // re-fetch if needed
```

Remove the per-split insert loop before refresh (refresh creates splits).

5. In `monthly-billing.js`, replace local `refreshBillSplits` body with call to `refreshBillSplitsForBill` / `refreshPropertyMonthSplits` from domain so Gmail upsert gets cover automatically.

- [ ] **Step 3: Run unit tests again**

Run: `npm run test:utility-house-cover`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/use-cases/utilities/domain.js src/use-cases/utilities/monthly-billing.js src/use-cases/utilities/uc-recalculate-splits.js scripts/test-utility-house-cover.js
git commit -m "feat(utilities): apply monthly house cover when refreshing splits"
```

---

### Task 4: API — property PATCH + bill/tenant payloads

**Files:**
- Modify: `src/routes/properties.routes.js` (allowlist)
- Modify: `src/use-cases/utilities/queries.js` (`fetchBillWithSplits`, `getTenantSplits`)

**Interfaces:**
- PATCH body may include `utility_house_cover_per_tenant` (number ≥ 0)
- Bill detail `bill` includes: `house_cover_applied`, `tenant_pool_amount`, `utility_house_cover_per_tenant`, `house_cover_total`, `month_active_tenant_count`, `month_combined_total`
- Tenant split rows include: `house_cover_applied`, `tenant_pool_amount`, `utility_house_cover_per_tenant` (from joined bill/property)

- [ ] **Step 1: Allow property field**

In `properties.routes.js` allowed array, add `'utility_house_cover_per_tenant'`.

Validate on write: if present, `Number(v) >= 0` or return 400.

- [ ] **Step 2: Enrich `fetchBillWithSplits`**

Join `properties p` and select `p.utility_house_cover_per_tenant`. After loading bill + splits, if `utility_house_cover_per_tenant > 0`, compute display helpers from stored columns:

```js
bill.house_cover_total = Number(bill.utility_house_cover_per_tenant) * /* optional stored */ 
```

Practical approach: store enough on the bill (`house_cover_applied`, `tenant_pool_amount`) and join property rate. For `house_cover_total` / active count, either:
- recompute via `allocateMonthlyHouseCover` over sibling bills in the handler, or
- add optional columns later.

**Minimal:** join property rate; expose `house_cover_applied`, `tenant_pool_amount`, `utility_house_cover_per_tenant`. Manager UI can show:  
`Bill X − House cover (applied to this bill) Y → Tenants Z`.

Better UX line from spec needs month totals — add a small helper query in `getBillForStaff`:

```js
const ym = billingMonthKey(detail.bill.period_start);
const siblings = await list amounts for property+month;
const alloc = allocateMonthlyHouseCover(...);
detail.bill.month_combined_total = alloc.combined;
detail.bill.house_cover_total = alloc.coverTotal;
detail.bill.month_tenant_pool = alloc.tenantPool;
detail.bill.month_active_tenant_count = activeCount;
```

- [ ] **Step 3: Tenant `getTenantSplits` SELECT**

Add to SELECT list:

```sql
ub.house_cover_applied,
ub.tenant_pool_amount,
pr.utility_house_cover_per_tenant
```

Join `properties pr ON pr.id = ub.property_id`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/properties.routes.js src/use-cases/utilities/queries.js
git commit -m "feat(utilities): expose house cover on property PATCH and bill APIs"
```

---

### Task 5: Manager + tenant UI

**Files:**
- Modify: `client/src/pages/manager/Utilities.jsx` (bill detail summary ~lines 558–589)
- Modify: `client/src/pages/tenant/Utilities.jsx` (`SplitRow` copy)

- [ ] **Step 1: Manager bill detail**

When `bill.utility_house_cover_per_tenant > 0` (or `house_cover_applied != null`), render a summary strip:

```jsx
{(Number(bill.utility_house_cover_per_tenant) > 0 || bill.house_cover_applied != null) && (
  <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-sm text-slate-700">
    Bill {fmtMoney(tenantCharges)} − House cover{' '}
    {fmtMoney(bill.house_cover_total ?? bill.house_cover_applied)}
    {bill.month_active_tenant_count != null && (
      <> (${Number(bill.utility_house_cover_per_tenant).toFixed(0)} × {bill.month_active_tenant_count} tenants)</>
    )}
    {' '}→ Tenants {fmtMoney(bill.month_tenant_pool ?? bill.tenant_pool_amount)}
  </div>
)}
```

Keep existing Tenant charges / Outstanding tiles; outstanding should already reflect reduced split amounts after recalc.

- [ ] **Step 2: Tenant split row**

Under the amount line in `SplitRow`:

```jsx
{Number(split.utility_house_cover_per_tenant) > 0 && (
  <p className="text-xs text-slate-500 mt-0.5">
    {Number(split.amount) === 0
      ? 'Fully covered by house this month'
      : `Includes house utility allowance ($${Number(split.utility_house_cover_per_tenant).toFixed(0)}/tenant)`}
  </p>
)}
```

- [ ] **Step 3: Client build**

Run: `cd client && npm run build`  
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/manager/Utilities.jsx client/src/pages/tenant/Utilities.jsx
git commit -m "feat(ui): show utility house cover on manager and tenant views"
```

---

### Task 6: Recalc verification (July electric scenario)

**Files:**
- None required beyond running existing `utilities:recalc-splits` against prod/staging after deploy
- Optional: extend `scripts/test-utility-house-cover.js` with a documented fixture comment for the $731.70 case (already in Task 1)

- [ ] **Step 1: Local/prod migrate**

Run against production (Railway): ensure `043` applied via normal deploy `preDeployCommand` / `npm run db:migrate`.

- [ ] **Step 2: Recalculate splits**

Via Manager Utilities → **Recalculate splits**, or:

```bash
railway run -s property-manager -e production -- npm run utilities:recalc-splits:apply
```

(Only if that script exists and is safe; otherwise use in-app button.)

- [ ] **Step 3: Verify numbers**

For open July electric on 743:
- `house_cover_applied` ≈ `400` (if sole open bill in month) or pro-rated if siblings exist
- Each tenant split ≈ **`$82.93`** (was ~`$182.92`)
- August water alone under $400 cover → splits **`$0.00`**

- [ ] **Step 4: Final commit / PR**

Push branch `cursor/utility-house-cover-monthly-pool-1d9c` and open/update PR referencing the spec + plan.

```bash
git status
git push -u origin HEAD
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Property setting + seed 743 @ $100 | Task 2 |
| `$100 × active tenants` | Tasks 1, 3 |
| Monthly combined pool, pro-rate bills | Tasks 1, 3 |
| Vacant rooms excluded | Task 1 overlap + Task 3 `loadActiveLeases` / month count |
| Existing occupancy/electric splitters on leftover | Task 3 `computeSplitsForBill(splitAmount)` |
| Cover ≥ combined → $0 | Task 1 tests |
| Freeze paid/waived/charging | Task 3 |
| Import/combine/recalc same path | Task 3 monthly-billing + recalc |
| Manager/tenant UI math | Task 5 |
| API PATCH + payloads | Task 4 |
| July $731.70 → ~$82.93 verification | Tasks 1, 6 |

No TBD/placeholder steps remain. Function names are consistent: `allocateMonthlyHouseCover`, `refreshPropertyMonthSplits`, `utility_house_cover_per_tenant`.
