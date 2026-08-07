# Archives

Historical exports kept in-repo for bookkeeping after product changes.

| File | Contents |
|------|----------|
| `cash-app-payments-2026-08-07.csv` | Cash App–related `payments` rows from production as of 2026-08-07 (mostly **off-app** Gmail/cashtag imports, plus any Stripe Cash App Pay attempts). Exported when **off-app Cash App import** was retired. |
| `tenant-lease-emails-2026-08-07.csv` | Active lease tenants with **emails from their lease/user records** (743 A Ave roster). |
| `stone-july-august-correction-2026-08-07.md` | Buckley Stone: removed double-counted Aug Cash App from July bucket; July + August each $450 paid / $450 owed. |

**Product rule:** Tenants pay **in the portal** only (ACH, card, or Cash App Pay). Off-app cashtag / Gmail Cash App sync is disabled. Live DB rows are unchanged for ledger integrity; these CSVs are offline archive copies.
