# Collections (workspace only — not on the live site)

Former-tenant / collections notices live **here**, not on Manager → Payments.

When Jose asks to add a collections notice (balance chase, write-off, contact attempt), **append a row** to `notices.csv` (or ask the agent to). Do not put those people back on the live site.

## Files

| File | Purpose |
|------|---------|
| `notices.csv` | Running register of collections cases and notices |
| `README.md` | This convention |

## CSV columns

`noticed_at,case_id,tenant_name,tenant_email,unit,property,status,amount_owed,currency,period,notice_type,summary,next_action,workspace_refs`

- **status:** `open` · `watching` · `paid` · `written_off` · `site_archived`
- **notice_type:** `balance_due` · `contact` · `write_off` · `archive` · `other`
- **workspace_refs:** paths like `archive/rent-by-month/2026-06.csv`

## Site rule

Users with `users.site_archived_at` set are hidden from Tenants, Leases, Payments, Inbox, Admin users, and rent roster. Login is blocked. Historical DB rows remain for audits; monthly rent CSVs stay under `archive/rent-by-month/`.
