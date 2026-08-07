# Archives

Historical exports kept in-repo for bookkeeping after product changes.

| File | Contents |
|------|----------|
| `cash-app-payments-2026-08-07.csv` | Cash App–related `payments` rows from production as of 2026-08-07 (mostly **off-app** Gmail/cashtag imports, plus any Stripe Cash App Pay attempts). Exported when **off-app Cash App import** was retired. |
| `tenant-lease-emails-2026-08-07.csv` | Active lease tenants with **emails from their lease/user records** (743 A Ave roster). |
| `rent-by-month/` | **Rent & security deposit by month** — one CSV per month. Former tenant **Davontaye Tyrrell Gara** lives under `2026-06.csv` only (not live Payments/Collections). See `rent-by-month/README.md`. |
| `collections/` | **Collections notices register** (`notices.csv`) — former-tenant / collections follow-ups stay here, **not** on the live site. See `collections/README.md`. |
| `stone-july-august-correction-2026-08-07.md` | Buckley Stone: July fully paid (incl. John Kloc Jul 19); August $450 paid / $450 owed; flexible pay / no late fees. |

**Product rule:** Tenants pay **in the portal** only (ACH, card, or Cash App Pay). Off-app cashtag / Gmail Cash App sync is disabled. Live DB rows are unchanged for ledger integrity; these CSVs are offline archive copies.

**Payments UI:** Manager rent roster shows **active** tenants only. Former-tenant / collections notices go in `archive/collections/notices.csv`, not on the live site. Site-archived users (`users.site_archived_at`) are hidden from Tenants, Leases, Payments, Inbox, and Admin.
