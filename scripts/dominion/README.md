# Dominion portal → Montero sync

Monthly cloud-agent workflow to pull the latest Dominion Energy bill and sync tenant electric shares.

## Secrets (required)

| Env var | Purpose |
|---|---|
| `DOMINION_USERNAME` | Dominion Energy customer portal username |
| `DOMINION_PASSWORD` | Portal password |
| `DOMINION_TOTP_SECRET` | Base32 TOTP seed for MFA |

## Steps

1. **TOTP**
   ```bash
   pip install pyotp
   python3 scripts/dominion/generate-totp.py
   ```
2. **Browser login** (computer-use / Desktop): open Dominion customer portal → username/password → paste TOTP. Prefer semantic labels (“Amount Due”, “Current Charges”, “View Bill / PDF”) over CSS selectors.
3. **Extract** into JSON (see schema below). Prefer **Current Charges** for tenant billing; keep Total Amount Due as `total_amount_due` / statement balance only.
4. **Download** the latest PDF into `archive/utilities/dominion-bills/`.
5. **Sync**
   ```bash
   # dry-run
   node scripts/dominion/sync-portal-extract.js path/to/extract.json
   # write + notify tenants
   APPLY=1 NOTIFY=1 node scripts/dominion/sync-portal-extract.js path/to/extract.json
   # or via Railway prod DB
   railway run -s property-manager -e production -- env APPLY=1 NOTIFY=1 node scripts/dominion/sync-portal-extract.js path/to/extract.json
   ```

## Extract JSON schema

```json
{
  "current_charges": 293.69,
  "total_amount_due": 731.70,
  "due_date": "2026-08-14",
  "statement_date": "2026-07-17",
  "billing_days": 30,
  "kwh_usage": 1234,
  "pdf_path": "archive/utilities/dominion-bills/2026-07-17.pdf"
}
```

There is **no kWh column** on `utility_bills`; usage is stored in bill notes + the archived JSON. PDFs are **not** BLOBs in Postgres — archive on disk and set `bill_document_url` to an `archive:…` pointer.

## Resilience

- Locate fields by visible text (“Current Charges”, “Amount Due”, “Due Date”, “kWh”) rather than brittle selectors.
- If only Amount Due is visible, do **not** bill tenants that balance — pull Billing History / statement PDF for Current Charges first.
- Existing Gmail e-bill import remains the always-on path; this portal workflow is the monthly source-of-truth check.
