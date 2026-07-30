# Task 6 Report: Tenant UI - e-sign + Finish lease pay

## STATUS
Complete.

## COMMITS
- `feat(tenant): native e-sign and finish-lease deposit pay`

## TEST
- `npm install @stripe/react-stripe-js --prefix client` - installed `@stripe/react-stripe-js`.
- `npm run build --prefix client` - passed.
- `npm run test:native-lease` - passed 12/12; covered native document access, tenant sign, manager sign, awaiting deposit, card deposit intent, and Rocket Lawyer native guard.
- Headless Chrome smoke against running local dev servers - passed:
  - Logged in as `tenant@example.com`.
  - Opened `/tenant/lease`.
  - Verified tenant chrome, native PDF iframe, native signature status, finish lease progress, and Card / ACH / Cash App deposit controls.
  - Screenshot artifact: `/opt/cursor/artifacts/tenant_native_finish_lease_pay.png`.

## CONCERNS
- Autopay remains ACH-only and best-effort in this flow. The current autopay API only enables against an active lease, so the checkbox attempts the existing API when a verified bank is selected and does not block deposit payment if the lease is still awaiting activation.
- Stripe card and Cash App completion still depend on normal Stripe confirmation/webhook behavior to activate the lease after successful security deposit payment.
# Task 6 Report: Catalog — UC06 legacy/emergency

## Status
Complete.

## Changes
Updated `src/use-cases/utilities/catalog.js` UC06 entry to document charge ACH as a legacy/emergency API rather than the happy path.

### UC06 updates
- **name:** `Charge ACH (legacy / emergency)`
- **goal:** Clarifies portal pay is normal; Autopay is the only automatic debit; this endpoint is for emergency staff-initiated debits.
- **preconditions:** Added `Staff intentionally using emergency API`.
- **ui:** Added `Not shown in Manager Utilities (portal-pay model)`.

## Commit
`docs(utilities): mark UC06 charge ACH as legacy emergency API`

## Verification
- Catalog-only documentation change; no runtime behavior modified.
- No tests required for this task per brief.

## Notes
Future agents should treat UC06 as preserved API surface for emergencies, not as a feature to expose in Manager Utilities UI.
