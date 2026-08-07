# Utility house cover — monthly pool (743 A Ave)

**Date:** 2026-08-07  
**Status:** Approved for implementation planning  
**Scope:** Montero Rentals — **743 A Ave only** (property-level setting; other properties unchanged)  
**Approach:** Monthly pool — house covers `$100 × active tenants`, tenants split the leftover combined utilities

## Problem

Owners want utilities structured like a house allowance: the property covers a fixed amount per occupied tenant each month, and tenants only pay usage above that. Today every utility bill is split **100%** to tenants with no house contribution.

## Goals

1. For **743 A Ave**, apply a monthly house cover of **`$100 × number of active leases`** that overlap the billing month.
2. Apply cover to the **combined** utilities for that calendar month (electric + water + any other services), not per bill and not a flat $100 total.
3. Tenants split only `max(0, combined − cover)` using existing occupancy / electric-% rules.
4. If cover ≥ combined total, tenants owe **$0** for that month.
5. Manager and tenant UIs show the math (bill / house cover / tenant share) so it is not a surprise.
6. Import, combine, and recalculate all use the same formula.

## Non-goals (this cycle)

- Org-wide or multi-property defaults beyond a per-property setting (743 gets `$100`; others stay `0` / null).
- Changing Autopay, portal-pay, or dispute window rules.
- Owner ledger / trust-accounting rows for the covered portion (house share is implied, not a payable split).
- Retroactive rewrite of already-`paid` historical splits (optional one-time recalc of open months only).
- Per-tenant custom allowances (everyone gets the same `$100` multiplier).

## Product rules

| Rule | Detail |
|------|--------|
| Property | Setting lives on `properties` for 743; other properties leave cover at `0` |
| Rate | `utility_house_cover_per_tenant` = **100.00** (USD) |
| Count | Active leases on that property whose dates overlap the calendar month of the bill’s `period_start` (vacant rooms do not count) |
| Month key | Calendar month of `period_start` (fallback `created_at` if null) |
| Combined | Sum of each month’s bill split bases (`tenant_charge_amount` if set, else `total_amount`) for that property |
| Tenant pool | `max(0, combined − rate × active_lease_count)` |
| Per-bill allocation | Pro-rate tenant pool across that month’s bills by each bill’s split base |
| Per-tenant split | Existing `computeOccupancySplits` / `computeElectricSplits` on each bill’s allocated tenant amount |
| Cover ≥ bill | All tenant split amounts for the month are `0.00` (status can stay pending/notified until waived or left at $0 paid) |

### Worked example — current open July electric (743)

- Active tenants: **4** → cover **$400**
- Open July electric: **$731.70** (water for July already settled/waived separately in prod history)
- Treating this bill alone as the month’s open pool for the demo:  
  - Tenant pool = `731.70 − 400 = 331.70`  
  - Each tenant ≈ **$82.93** (vs ≈ **$182.92** today)

### Worked example — open August water

- Combined (water only so far): **$165.74**
- Cover: **$400**
- Tenant pool: **$0** → each tenant **$0**

When August electric arrives later, recalc redistributes:  
`tenant_pool = max(0, (water + electric) − 400)`, then pro-rate across both August bills.

## Design

### 1. Data model

Migration (e.g. `043_utility_house_cover.sql`):

```sql
ALTER TABLE properties
  ADD COLUMN utility_house_cover_per_tenant NUMERIC(10,2) NOT NULL DEFAULT 0
  CHECK (utility_house_cover_per_tenant >= 0);

-- Seed 743 A Ave only
UPDATE properties
SET utility_house_cover_per_tenant = 100.00
WHERE name = '743 A Ave' OR id = 'cccccccc-0000-0000-0000-000000000001';
```

Optional bill-level audit columns (recommended for UI clarity, not required for math):

- `utility_bills.house_cover_applied` — this bill’s pro-rated share of the monthly house cover  
- `utility_bills.tenant_pool_amount` — amount actually split to tenants after cover  

These are derived on each refresh; storing them avoids re-deriving in list APIs.

Do **not** reuse `dominion_owner_paid_through` or `tenant_charge_amount` for this — different semantics (history baseline / Dominion period charges).

### 2. Domain math (single source of truth)

Add helpers in `src/use-cases/utilities/domain.js` (or a small sibling module imported everywhere splits are built):

1. `getBillSplitAmount(bill)` — unchanged (period charges vs total).
2. `countActiveLeasesForMonth(leases, yearMonth)` — leases overlapping that month.
3. `allocateMonthlyHouseCover({ bills, coverPerTenant, activeLeaseCount })`:
   - `combined = sum(getBillSplitAmount(b))`
   - `cover = coverPerTenant * activeLeaseCount`
   - `tenantPool = max(0, combined - cover)`
   - For each bill:  
     `billTenantAmount = combined === 0 ? 0 : tenantPool * (billAmount / combined)`  
     (last bill gets cent remainder so sums match)
4. Existing splitters run on `billTenantAmount` instead of full bill amount.

**Call sites that must use this path when `coverPerTenant > 0`:**

- `insertBillWithSplits` / `refreshBillSplitsForBill`
- Monthly combine (`uc10`) and `executeRecalculateSplits`
- Gmail `upsertMonthlyDraft` / Dominion import refresh

When any bill in a month is created or recalculated, **refresh all still-editable bills in that property-month** so cover stays correct as bills arrive out of order.

### 3. Paid / frozen splits

| Split status | Behavior on month recalc |
|--------------|--------------------------|
| `pending`, `notified`, `disputed`, `failed` | Amounts recalculated |
| `charging`, `paid` | **Frozen** — leave amount; exclude that bill’s frozen total from the redistributable pool |
| `waived` | Leave waived; do not re-open via cover math |

Redistributable combined = sum of split bases for bills that still have recalculable splits. Cover still uses full `rate × active_lease_count` for the month (house allowance does not shrink because someone already paid). If frozen paid amounts already exceed what tenants “should” owe after cover, leave paid as-is and set remaining open splits to `$0` (do not claw back).

### 4. API / settings

- Extend property PATCH allowlist with `utility_house_cover_per_tenant` (owner/manager).
- Bill detail / balances payloads include: `house_cover_per_tenant`, `house_cover_total`, `combined_month_total`, `tenant_pool_total`, and per-bill `house_cover_applied` / `tenant_pool_amount` when present.
- No new charge endpoints — portal-pay / Autopay unchanged.

### 5. UI

**Manager Utilities (743 bills)**

- Bill detail summary line, e.g.  
  `Bill $731.70 − House cover $400.00 ($100 × 4 tenants) → Tenants $331.70`
- Balances board may show a small “after house cover” amount for open shares.

**Tenant Utilities**

- Share row copy when cover applied:  
  `Your share $82.93 (house covered $100 of this month’s utilities)`  
  or when pool is $0: `Fully covered by house this month`.

**Settings**

- Minimal: property field editable on property settings or a small Utilities tool for 743. Pre-seeded to `$100`; no multi-property wizard this cycle.

### 6. Testing

Unit / script tests:

- Cover with 4 tenants, single bill $731.70 → pool $331.70, equal-ish occupancy splits.
- Cover ≥ combined → all $0.
- Two bills in one month → pro-rata cover; sum of tenant pools = monthly pool.
- Second bill arrives → recalc first bill’s unpaid splits.
- Property with `cover = 0` → identical to today’s behavior.
- Active lease count ignores vacant Room 5.

Manual prod check after ship: recalc open 743 month(s); verify July electric shares drop from ~$182.92 → ~$82.93; August water → $0 if still alone under $400.

## Rollout

1. Migration + seed `$100` on 743.
2. Domain + recalc path.
3. UI labels.
4. Deploy; run `utilities:recalc-splits:apply` (or in-app Recalculate) for 743 open months.
5. Spot-check Manager + tenant utility views.

## Decisions log

| Decision | Choice |
|----------|--------|
| Scope | 743 A Ave only |
| Rate | $100 × active tenants |
| Application | Monthly combined pool, pro-rated onto bills |
| Vacancy | Vacant rooms do not get a $100 |
| Remainder split | Existing occupancy / electric % rules |
| Already-paid splits | Frozen; no clawback |
