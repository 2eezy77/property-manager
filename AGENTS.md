# Agent notes

## Cursor Cloud specific instructions

- **Product:** Montero Rentals property manager — Express API (`npm run dev`, port 8080) + React/Vite client (`cd client && npm run dev`, port 5173). Production is Railway serving `client/dist` after `npm run db:migrate` (`railway.json` preDeploy).
- **Database:** Use Railway/`DATABASE_URL` (Supabase session pooler). Do not wipe or re-seed production tenants. Local `.env.local` often points at localhost Postgres and may set `EMAIL_ENABLED=false` — `src/config/env.js` prefers already-set host env over `.env.local`, so prefer `railway run …` (or export Railway vars) when hitting prod/staging Supabase.
- **Payments:** Card and Cash App Pay charge tenants **2.9% + $0.30** (`src/services/payment-processing-fee.service.js`); ledger `payments.amount` stays the base rent/deposit. ACH has no fee. Client estimates in `Payments.jsx` / `FinishLeasePay.jsx` must match that formula; server is source of truth at create-intent time.
- **Native VA leases:** Status path `draft → pending_tenant_signature → pending_manager_signature → awaiting_deposit → active`. Migration `041_native_va_lease.sql` is additive. QA: `npm run test:native-lease:all` (API test needs running DB + Stripe test keys). Do not commit generated PDFs under `documents/`.
- **Stripe Identity:** Native lease deposit activation is gated on `tenant_identity_verifications.status = 'verified'`; without it, deposit settlement leaves the lease in `awaiting_identity`. `IDENTITY_PII_ENCRYPTION_KEY` must be a 32-byte base64 key.
- **Standard commands:** See root `package.json` / `SETUP.md` / `README.md` for migrate, seed, smoke, and portal scripts. Useful checks: `npm run test:processing-fee`, `npm run test:balance-paid`, `npm run assert:portal-pay`.
