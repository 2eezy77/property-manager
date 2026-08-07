# Archives

Historical exports kept in-repo for bookkeeping after product changes.

| File | Contents |
|------|----------|
| `cash-app-payments-2026-08-07.csv` | Cash App–related `payments` rows from production as of 2026-08-07 (mostly **off-app** Gmail/cashtag imports, plus any Stripe Cash App Pay attempts). Exported when **off-app Cash App import** was retired. |

**Product rule:** Tenants pay **in the portal** only (ACH, card, or Cash App Pay). Off-app cashtag / Gmail Cash App sync is disabled. Live DB rows are unchanged for ledger integrity; this CSV is the offline archive copy.
