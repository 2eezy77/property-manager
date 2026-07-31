# Card / Cash App Processing Fee Implementation Plan

> **For agentic workers:** Implement fee helper → wire Cash App create-intent → tenant notice/UI → unit test → commit.

**Goal:** Tenant pays 2.9% + $0.30 on Cash App (and reusable helper for Card); ACH stays free; clear portal notice.

**Tech:** Node helper, `payments.routes.js`, `Payments.jsx`, small node test script.

## Task 1: Fee helper + test

- Create `src/services/payment-processing-fee.service.js`
- Add `scripts/test-processing-fee.js` and npm script

## Task 2: Wire Cash App create-intent

- Apply fee to PI amount; keep ledger amount base
- Metadata + JSON response breakdown
- Expose fee schedule on `/api/payments/config`

## Task 3: Tenant Payments UI

- ACH incentive + fee notice
- Cash App buttons show total with fee estimate
