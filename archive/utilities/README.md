# Utilities archive

## HRSD / Norfolk account `3491396160` (743 A Ave)

Source export: `hrsd-3491396160-payment-history.xlsx` (+ `.csv`).

This is **owner payments to HRSD** (what Jose paid the utility), not tenant ledger rows.

| Payment date | Amount | Notes |
|---|---:|---|
| 2026-07-01 | $117.70 | Matches site June cycle bill |
| 2026-05-29 | $229.20 | Matches site May cycle bill |
| 2026-04-28 | $203.24 | |
| … | … | see CSV |

**Current portal bill (not yet in payment history):**  
Billing period **2026-06-06 – 2026-07-09**, amount **$165.74**, due **2026-08-04**.  
House cover can zero tenant shares; owner may still owe HRSD until autopay/card clears.

Do not treat AT&T wireless Gmail imports as HRSD water.

## Dominion Energy (743 A Ave)

Source export: `dominion-billing-history.xlsx` (+ `.csv` derived).

Dominion **does not** bill on calendar months. Each row has:

| Field | Meaning |
|---|---|
| Statement date | End of service cycle (≈ meter read) |
| Billing days | Length of that cycle (often 29–32) |
| Current charges | **Tenant collectible** for the cycle |
| Total account balance | Full AR balance (may include arrears) — **do not** bill tenants this |

`period_start = statement_date − (billing_days − 1)`, `period_end = statement_date`.

Latest cycle in export: statement **2026-07-17**, 30 days → **2026-06-18 – 2026-07-17**, current charges **$293.69**, balance **$731.70**, due **2026-08-14**.
