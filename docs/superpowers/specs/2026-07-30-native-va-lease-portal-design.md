# Native Virginia Room Lease Portal (Montero)

**Date:** 2026-07-30  
**Status:** Approved for implementation planning  
**Scope:** Montero Rentals only  
**Related:** Utilities portal-pay model (separate); payment methods extend tenant Payments

## Problem

Creating leases via Rocket Lawyer is slow and manual. Tenants need a native portal to review a Virginia room lease, e-sign with the property manager, then pay deposit (and optionally first month) so the lease can activate — using Stripe/Plaid already in the stack, plus **card** for tenants who are not ready to link a bank.

## Goals

1. Generate a Montero-branded **Virginia Room Lease** PDF from a short manager form (look inspired by the Lumin-style room lease; commercial terms from recent 743 leases).
2. In-portal e-sign: **Tenant** then **Property Manager** (type or draw).
3. After both sign → **Awaiting deposit** → tenant pays on Montero (**card / ACH / Cash App Pay**) → lease **`active`**.
4. Cards allowed for **deposit and ongoing rent** on Payments; Autopay remains **ACH-only** opt-in.
5. Soft-deprecate Rocket Lawyer for **new** leases (existing RL docs remain readable).

## Non-goals

- Multi-landlord SaaS packaging.
- Full Rocket Lawyer replacement for every historical document.
- Autopay via card.
- Legal advice / attorney certification of the form (ops should have counsel review the generated text before production use).
- Committing real tenant lease PDFs with PII into git.

## Source material (session)

| Source | Use |
|--------|-----|
| Lumin-style Virginia Room Lease template (uploaded) | Layout / section structure |
| Lily Fortman lease (RL, regular room, $900) | Defaults for `regular` room type |
| Osanin Alexander Knight Murillo lease (RL, master, $1,200) | Defaults for `master` room type |
| Existing `lease-pdf.service.js` | Starting point to rebuild / replace for room lease |

Do **not** commit the Lily/Osanin PDFs to the repository (PII).

## Locked product decisions

| Topic | Decision |
|-------|----------|
| E-sign engine | Native Montero (not day-to-day Rocket Lawyer) |
| Signers | Tenant → Property Manager (landlords named in body; PM signs as agent) |
| Landlords (body) | Jose Isaac Montero & Trevor McManas |
| Property manager | Konstantin Patchell Hazlett |
| Property | 743 A Ave, Norfolk, VA 23504 |
| Grace period default | **0 days** |
| Late fee default | $150 |
| NSF default | $50 |
| Room `regular` | Rent/deposit **$900** |
| Room `master` | Rent/deposit **$1,200** |
| Activate gate | Both signatures + **security deposit paid** |
| First month at activate | Optional checkbox |
| Pay methods (deposit + rent) | **Card (Stripe)** · **ACH (Plaid→Stripe)** · **Cash App Pay (Stripe)** |
| Autopay | Opt-in; **ACH only** |
| Payment UI | Montero portal (embedded Stripe/Plaid); not a separate Stripe-hosted “landing” as the product home |
| RL | Soft-deprecate create/interview for new leases |
| Manager $350 signing fee | Keep existing compensation / Stripe–Plaid payout path |

## Design

### 1. Manager create form → PDF

Manager (or owner) creates a lease with:

- Tenant, unit, **room type** (`regular` | `master`)
- Start/end dates
- Rent, deposit (prefilled from room type; overridable)
- Late fee, grace (default 0), NSF
- House-rule toggles (smoking/pets default no; quiet hours; guest nights)
- Utilities note: shares billed/paid in Montero portal

Generator produces a short Montero-branded Virginia Room Lease PDF (sections: parties, property, term, rent/payment, deposit, utilities, entry, house rules, furnishings/damage schedule, governing law, signature blocks).

Payment clause: portal methods (card / ACH / Cash App Pay); no mail-to-NC / PayPal as primary for new leases.

### 2. E-sign

- Preview PDF in portal.
- Tenant signs first (type name or draw); record timestamp + IP + user id.
- Notify PM; PM signs as landlord’s agent.
- Persist signed PDF; status → `awaiting_deposit` (or equivalent).
- No RL interview/binder for this path.

### 3. Finish lease / pay to activate

Tenant “Finish your lease” step (portal):

1. Progress: Signed → Pay deposit → Active  
2. Amount: security deposit (optional add first month)  
3. Methods: **Card** · **Bank ACH (Plaid)** · **Cash App Pay**  
4. Autopay toggle optional; requires linked bank; not required to activate  

On successful deposit payment (webhook or confirmed PI): lease → `active`; continue check-in.

### 4. Ongoing Payments

Extend `/tenant/payments` so **card** is available for rent (and other due balances) alongside ACH and Cash App Pay. Autopay charges remain ACH against linked bank only.

### 5. Rocket Lawyer

- Hide/disable “Start Rocket Lawyer interview” for newly created native leases.
- Keep read/download for historical RL-linked leases.
- Manual `activate-signed` may remain as staff emergency tool.

### 6. Manager signing fee

Unchanged business rules ($350 after signed lease; eligibility e.g. 3 months rent); triggered when native lease reaches fully signed / active per existing fee service hooks.

## Status model (proposed)

`draft` → `pending_tenant_signature` → `pending_manager_signature` → `awaiting_deposit` → `active`  
(Exact enum names may map onto existing `leases.status` values with additive states via migration.)

## Technical notes

- Prefer PDFKit (or pdf-lib) generation server-side; store under `documents/` or object storage path already used for lease files.
- Signatures: store image/vector + audit fields; flatten into final PDF.
- Cards: Stripe Payment Element / PaymentIntent (`card`); never touch raw PAN on Montero servers.
- ACH: existing Plaid Link → processor token → Stripe bank debit.
- Cash App Pay: existing Stripe Cash App Pay intents.
- Webhooks: extend Stripe webhook handlers for deposit/`lease_activation` metadata.
- Plaid-Developer-Tools skills are reference for Link best practices; app already uses `react-plaid-link`.

## Secrets required for build/test

| Secret | Purpose |
|--------|---------|
| `STRIPE_SECRET_KEY` | Test mode secret (app `.env.local`) |
| `STRIPE_PUBLISHABLE_KEY` | Client Stripe.js / Payment Element |
| `STRIPE_WEBHOOK_SECRET` | Local or Dashboard webhook signing |
| `PLAID_CLIENT_ID` | Sandbox Link |
| `PLAID_SECRET` | Sandbox Link / Auth |

Stripe MCP may already be connected to a sandbox account in Cursor; **app process still needs keys in `.env.local`**.

## Success criteria

- Manager can create a regular or master room lease with correct default rent/deposit.
- Tenant + PM can complete e-sign without Rocket Lawyer.
- Tenant can pay deposit by **card, ACH, or Cash App Pay** and lease activates.
- Tenant can pay ongoing rent by card on Payments; Autopay still ACH-only.
- New leases do not require RL interview UI.

## Follow-ups

- Counsel review of generated lease text.
- Unified “Pay everything” hub (already deferred in utilities work).
- Hard-remove RL code paths after native path is proven.
