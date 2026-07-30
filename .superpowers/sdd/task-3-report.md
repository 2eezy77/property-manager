STATUS: DONE_WITH_CONCERNS

COMMITS
- feat(leases): native create, PDF, and e-sign API

TEST summary
- RED: `node scripts/test-native-lease.js` failed at `POST /api/leases/native` with 404 before route/service implementation.
- GREEN: `npm run test:native-lease` passed 11/11 against local API, covering create defaults, PDF generation, document URL, send, tenant sign, manager sign, awaiting_deposit, pending security_deposit payment, manager signing fee, and Rocket Lawyer document gate.
- Regression: `npm run test:native-lease-defaults` passed.
- Regression: `node scripts/test-native-lease-pdf.js` passed.
- Syntax: `node --check src/services/native-lease.service.js`, `src/routes/leases.routes.js`, and `scripts/test-native-lease.js` passed.
- Build: `npm run build` passed.

CONCERNS
- `npm run build` still reports existing npm audit findings (1 moderate, 3 high) from the client install and a Vite chunk-size warning; build exits 0.

## Post-review fix: PDF flatten outside transaction

**Change:** `applyManagerSignature` no longer calls `flattenSignaturesOntoPdf` inside the `FOR UPDATE` transaction. The transaction now records the manager signature, marks the envelope completed, inserts the pending `security_deposit` payment, and sets the lease to `awaiting_deposit` with `manager_signed_at`. After commit, `attachFlattenedSignedPdf` runs `flattenSignaturesOntoPdf` and performs a short follow-up `UPDATE` for `signed_pdf_path` / `document_url` and `signature_envelopes.signed_document_url`.

**Flatten failure behavior:** If post-commit flatten fails, the lease remains `awaiting_deposit` (signatures already persisted); the error is logged; the API still returns HTTP 200 with `signedPdfError` on the result and `signed_pdf_path` left null so clients can distinguish a completed sign from a deferred PDF.

**Route:** `POST /api/leases/native` maps `INVALID_ROOM_TYPE` to HTTP 400.

**Verification:** `npm run test:native-lease` — 11/11 passed.
