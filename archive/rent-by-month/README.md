# Rent payments by month (743 A Ave)

Offline archive of `rent` and `security_deposit` payment rows, one CSV per billing month (`period_start` month when present).

Live Manager → Payments shows **active** tenants for the current month. Former tenants are kept here so they do not clutter who is paying rent now.

| Month file | Notes |
|------------|--------|
| `2025-10.csv` … `2026-05.csv` | Historical periods on active leases |
| `2026-06.csv` | Includes **Davontaye Tyrrell Gara** (terminated Master Bedroom) — failed rent + security deposit only; archived out of live payments/collections |
| `2026-07.csv` | Active roster rent |
| `2026-08.csv` | Current-month roster rent |

## 2026-06 — Davontaye (former tenant)

| Tenant | Unit | Type | Status | Amount |
|--------|------|------|--------|--------|
| Davontaye Tyrrell Gara | Master Bedroom | rent | failed | $1,200.00 |
| Davontaye Tyrrell Gara | Master Bedroom | security_deposit | failed | $1,200.00 |

Lease terminated; user inactive. Live rows tagged `archived_former_tenant`. Related $150 late fee waived when archiving. Do not treat these as current rent due.

## How months are split

Each `YYYY-MM.csv` is its own section: one file = one month’s rent/deposit ledger snapshot for this property.
