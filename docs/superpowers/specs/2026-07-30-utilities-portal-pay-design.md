# Utilities portal-pay model (Montero-only)

**Date:** 2026-07-30  
**Status:** Approved for implementation planning  
**Scope:** Montero Rentals only (not multi-landlord SaaS)  
**Approach:** Finish utilities balances board + portal-only tenant pay; soft-kill off-app Cash App

## Problem

Managers need a clear **who owes what** view for utilities. Tenants must pay their own shares in the site. The system must **not** auto-debit anyone unless that tenant has explicitly enabled **Autopay**. Off-app cashtag payments should be discouraged but still importable as a safety net.

## Goals

1. Manager Utilities is a collections board (owe / dispute / remind / reconcile), not a charge console.
2. Tenants pay utilities (and other balances) themselves in the portal using existing ACH (Plaid → Stripe) and Stripe Cash App Pay.
3. Autopay is the **only** automatic debit path.
4. Background workers import → notify → remind only — **never ACH**.
5. Soft-kill off-app Cash App: hide cashtag guidance; keep Gmail import labeled as off-app.

## Non-goals (this cycle)

- New unified Tenant “Pay everything” hub (deferred).
- Full rent + utilities collections cockpit for managers (deferred).
- Hard deletion of off-app Cash App import or landlord ACH API (can remain unused / staff-hidden).
- Multi-org product packaging, MFA, or trust-accounting overhaul.

## Product rules

| Actor | Allowed | Not allowed |
|--------|---------|-------------|
| Utilities workers | Gmail import, combine/recalc, notify drafts, remind open shares | ACH / force debit |
| Tenant (Autopay off) | Link bank, pay ACH or Cash App Pay in Payments, dispute within window | Expect system to pull money |
| Tenant (Autopay on) | Same as above; system may debit linked bank per existing Autopay rules for rent/utilities | Surprises outside Autopay copy |
| Manager | Balances board, remind, resolve disputes, add/import bills, reconcile imported off-app | Charge / charge-all from Utilities UI |

## Design

### 1. Manager Utilities — balances board

**Keep / sharpen**

- Totals: Open · Disputed · Overdue (7d+).
- Balances table with filters: Owes · Disputed · Failed · Paid · All.
- Rename filter/status **Charging** → **Processing** in UI copy (means portal payment in flight, not landlord debit).
- Row → bill detail; actions: **Remind**, waive / reject dispute.
- Header: Connect/Reconnect Gmail, Add bill.
- Subtitle stays aligned with: bill and remind; tenants pay in the portal; workers never ACH.

**Remove from normal UI**

- “Advanced — landlord ACH”, “Charge all eligible”, per-split “Charge this share” / “Retry charge”.
- Copy that steers tenants to pay via off-app Cash App / cashtag.

**Bill detail**

- Notify (opens dispute window), Remind unpaid, dispute tools, status.
- No debit controls.

### 2. Tenant utilities → Payments

- Open shares list + history; dispute modal unchanged in spirit.
- Primary CTA: **Pay in Payments** (deep link `/tenant/payments`), including aggregate open total when > 0.
- Copy: pay here with bank ACH or Cash App Pay; **we only auto-debit if Autopay is on**.
- Do not imply landlord will pull utilities without Autopay.

Payments page remains the place tenants:

- Link / manage bank (Plaid)
- Pay due items (ACH or Cash App Pay)
- Enable/disable Autopay (opt-in only)

### 3. Soft-kill off-app Cash App

- Remove or hide cashtag / “pay outside the app” guidance on tenant surfaces (dashboard, payments, utilities).
- Prefer wording: pay in Payments (ACH or Cash App Pay).
- Keep Gmail Cash App import for stragglers; surface imported rows as **off-app** so managers can tell portal vs external.
- Manager Payments: keep Sync; empty/help text prefers portal ACH / Cash App Pay.

### 4. Workers & Autopay

- `utilities-scheduler`: import → notify → remind only (already stated in code comments; do not add charge calls).
- Autopay remains the sole scheduled/automatic debit for consented tenants (existing rent/utility Autopay behavior — no new silent charge paths).
- Landlord ACH use case (`UC06` / `POST .../charge`) may remain in API for emergency/ops but must not appear in Manager Utilities UI this cycle.

## Success criteria

- Manager can answer “who owes utilities?” from Balances without using charge buttons.
- Tenant with open utility share can reach Payments in one click and pay with existing methods.
- Copy nowhere promises auto-charge unless Autopay is enabled.
- Off-app cashtag is not promoted; imported off-app payments remain visible and labeled.
- Workers never initiate ACH.

## Implementation notes (for planning)

- Primary UI: `client/src/pages/manager/Utilities.jsx`, `client/src/pages/tenant/Utilities.jsx`, tenant Payments/Dashboard copy that mentions cashtag.
- Catalog/docs: update `src/use-cases/utilities/catalog.js` and file header comments so UC06 is “legacy / emergency,” not the happy path.
- Prefer copy/filter renames over schema renames for `charging` status.
- No new payment processor; reuse Stripe + Plaid already in repo.

## Follow-ups (out of scope)

1. Tenant unified Pay hub (rent + utilities + deposits).
2. Manager collections cockpit spanning rent + utilities.
3. Hard-remove off-app import and/or UC06 after soft-kill period.
4. Rent reconciliation polish (pain B) after utilities cycle ships.
