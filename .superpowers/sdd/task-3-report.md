STATUS: DONE

COMMITS
- `feat(identity): tenant-paid Stripe Identity fee and session`

TEST summary
- RED: `node scripts/test-lease-invite-identity.js` failed at missing `POST /api/leases/:id/identity/session` with HTTP 404.
- GREEN: `node scripts/test-lease-invite-identity.js` passed 11/11 against the running local API, covering no-fee session gate, locked $1.50 fee base, processing fee helper match, hosted Stripe Identity session creation, and session update to verified.
- Regression: `npm run test:identity-crypto` passed.
- Regression: `npm run test:processing-fee` passed.
- Syntax: `node --check src/services/tenant-identity.service.js src/services/stripe.service.js src/routes/leases.routes.js scripts/test-lease-invite-identity.js` passed.

CONCERNS
- No `lint` script exists in `package.json`; syntax checks were used for changed JS files.
- `npm install` reports one existing high-severity audit finding; not introduced or changed by Task 3.

---

## Follow-up: native-only identity gate

STATUS: DONE

COMMIT
- `fix(identity): restrict fee/session to native leases`

CHANGE
- `loadLeaseForTenant` in `src/services/tenant-identity.service.js` now selects `signing_provider` and rejects non-`native` leases with HTTP 400 and code `IDENTITY_NATIVE_ONLY` (used by both `createIdentityFeeIntent` and `createIdentitySession`).

TEST summary
- `node scripts/test-lease-invite-identity.js`: **11 passed · 0 failed** (native invite lease path unchanged; fee/session still gated on paid fee then session creation).
