# Card / Cash App processing fee (tenant-paid)

## Goal

Pass Stripe-style card/Cash App processing costs to the tenant, and incentivize ACH (no convenience fee).

## Fee

- **Card / Cash App:** `feeCents = round(baseCents × 0.029) + 30`; charge `baseCents + feeCents`.
- **ACH / Autopay:** no convenience fee.
- Server is source of truth (applied in create-intent). Ledger `payments.amount` stays **base** rent/deposit; fee lives in metadata + PaymentIntent amount.

## UX

- Notice: bank ACH has no processing fee; Card/Cash App include 2.9% + $0.30.
- Show estimated/total on Cash App (and Card when that portal path exists).
- Breakdown in API: `baseAmount`, `processingFee`, `amount` (total charged).

## Out of scope

- Legal surcharge opinion by state
- Changing ACH pricing
- Manager payroll / lease-signing Cash App paths
