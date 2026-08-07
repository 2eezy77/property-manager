# Stone (Buckley) rent correction — 2026-08-07

## Issue
Cash App import bundled two txns into **July** as $900:

| Date | Note | Amount | Txn |
|------|------|--------|-----|
| 2026-07-08 | Rent July 1/2 | $450 | `gmail:19f4029c0e6ec541` |
| 2026-07-29 | August rent | $450 | `gmail:19fac0b050d5259b` |

The Jul 29 txn was **also** recorded as an August partial (`37a7ffd5-…`), so August looked $450 paid while July falsely looked fully paid.

## Fix (prod)
- July `bbe1669e-…`: reduced to **$450** (July half only); removed August txn from parts/refs; `partial_rent=true`.
- August `37a7ffd5-…`: kept **$450** as the sole credit for `gmail:19fac0b050d5259b`.

## Current balances (after fix)
| Month | Paid | Status |
|-------|------|--------|
| July 2026 | $450 | **$450 still owed** |
| August 2026 | $450 | **$450 still owed** |

## Other notes (not changed)
- **April 2026** still shows ~$1,359 succeeded (full $900 + partial $459) — historical overcount; left alone.
- No linked bank account on file (portal ACH unavailable until he links).
- Two late fees on lease are already `paid` ($180 total).
