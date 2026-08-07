# Dominion portal → Montero sync

Monthly cloud-agent workflow to pull the latest Dominion Energy bill and sync tenant electric shares.

## Auth reality check

**Dominion does not support authenticator-app TOTP** (Google Authenticator / Authy / raw secrets).
Login MFA is **SMS text** or **email verification code** only.

| Env var | Purpose |
|---|---|
| `DOMINION_USERNAME` | Dominion Energy customer portal username |
| `DOMINION_PASSWORD` | Portal password |

Prefer **email OTP** during login so the agent can read the code from the org Gmail connection (same token used for utility e-bill import). SMS OTP requires a human in the Desktop pane.

## Steps

1. **Browser login** (computer-use / Desktop): open Dominion customer portal → username/password → choose **email** verification (not SMS when possible).
2. **Fetch MFA code**
   ```bash
   # Start this right after requesting the email code
   railway run -s property-manager -e production -- \
     env WAIT_SECONDS=120 AFTER_EPOCH_MS=$(date +%s000) \
     node scripts/dominion/fetch-email-otp.js
   ```
3. Enter the printed 6-digit code in the browser.
4. **Extract** using semantic labels (“Current Charges”, “Amount Due”, “Due Date”, “kWh”, “View Bill” / PDF) — avoid brittle CSS selectors.
5. **Download** the latest PDF into `archive/utilities/dominion-bills/`.
6. **Sync**
   ```bash
   node scripts/dominion/sync-portal-extract.js path/to/extract.json
   APPLY=1 NOTIFY=1 node scripts/dominion/sync-portal-extract.js path/to/extract.json
   # prod DB
   railway run -s property-manager -e production -- \
     env APPLY=1 NOTIFY=1 node scripts/dominion/sync-portal-extract.js path/to/extract.json
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

Tenant charge = **Current Charges** only. Total Amount Due / account balance is stored as `statement_balance`, never billed to tenants alone.

There is **no kWh column** on `utility_bills`; usage goes in notes + archived JSON. PDFs are archived on disk (`bill_document_url` text pointer) — not Postgres BLOBs.

## Always-on alternative (no portal MFA)

Gmail e-bill import + `BillingHistory.xlsx` export remain the reliable paths when portal MFA is SMS-only or the UI changes:

- Manager → Utilities → Import from Gmail
- `npm run import:dominion:apply` with a fresh portal xlsx export

## Resilience

- Locate fields by visible text, not CSS selectors.
- If only Amount Due is visible, open Billing History / the PDF for **Current Charges** before syncing.
- If email OTP never arrives, complete MFA in the Desktop pane, then continue extraction.
