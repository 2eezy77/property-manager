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
