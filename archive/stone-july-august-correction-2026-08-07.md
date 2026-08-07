# Stone (Buckley) rent correction — 2026-08-07

## Cash App activity (owner screenshot)

| Date | Sender | Note | Amount | Applies to |
|------|--------|------|--------|------------|
| Jul 8 | Stone Buckley | Rent July 1/2 | $450 | **July** |
| Jul 19 | **John Kloc** | rent july 2/2 stone | $450 | **July** (third-party for Stone) |
| Jul 29 | Stone Buckley | August rent | $450 | **August** |
| Jun 9 | Stone Buckley | $100 short rn | $350 | June |
| Jun 17 | Stone Buckley | Last of April, and the $100 I was short | $550 | June |

## Issue
Cash App import had bundled Stone’s Jul 8 + Jul 29 into July as $900, and also credited Jul 29 on August — double-counting August. John Kloc’s Jul 19 payment was never imported (sender ≠ Stone).

## Fix (prod)
1. July `bbe1669e-…`: Stone Jul 8 only — **$450**.
2. July `108d23b5-…`: **John Kloc** Jul 19 “rent july 2/2 stone” — **$450** (manual, owner-confirmed).
3. August `37a7ffd5-…`: Stone Jul 29 “August rent” — **$450** (sole credit for that txn).

## Current balances
| Month | Paid | Status |
|-------|------|--------|
| July 2026 | **$900** | Up to date (Stone $450 + Kloc $450) |
| August 2026 | $450 | **$450 still owed** |

## Owner policy (2026-08-07)
Stone may pay anytime during the month — **no late fees**. Lease: `grace_period_days=31`, `late_fee_amount=0`. Roster shows partial balance without Late/email.

## Other notes (not changed)
- **April 2026** still shows ~$1,359 succeeded (full $900 + partial $459) — historical overcount; left alone.
- No linked bank account on file (portal ACH unavailable until he links).
- Two late fees on lease are already `paid` ($180 total).
