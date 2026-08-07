# Archives

Historical exports kept in-repo for bookkeeping after product changes.

| File | Contents |
|------|----------|
| `cash-app-payments-2026-08-07.csv` | Cash App–related `payments` rows from production as of 2026-08-07 (mostly **off-app** Gmail/cashtag imports, plus any Stripe Cash App Pay attempts). Exported when **off-app Cash App import** was retired. |
| `tenant-lease-emails-2026-08-07.csv` | Active lease tenants with **emails from their lease/user records** (743 A Ave roster). |
| `rent-by-month/` | **Rent & security deposit by month** — one CSV per month. Former tenant **Davontaye Tyrrell Gara** lives under `2026-06.csv` only (not live Payments/Collections). See `rent-by-month/README.md`. |

**Product rule:** Tenants pay **in the portal** only (ACH, card, or Cash App Pay). Off-app cashtag / Gmail Cash App sync is disabled. Live DB rows are unchanged for ledger integrity; these CSVs are offline archive copies.

**Payments UI:** Manager rent roster / Collections only show people who still matter for collecting rent. Archived former-tenant payment rows (`metadata.archived_former_tenant=true`) stay in the monthly archive files, not the live “who is paying” view.
