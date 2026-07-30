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
