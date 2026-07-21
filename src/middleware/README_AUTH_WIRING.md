# Auth System — Wiring Guide

## How the three files work together

```
Request
  │
  ▼
authenticate.js          ← verifies Bearer JWT, attaches req.user = { id, role }
  │
  ▼
authorize.js (Guards)    ← checks req.user.role against required role(s)
  │
  ▼
Route handler            ← safe to trust req.user.id and req.user.role here
```

## Registering in your Express app (app.js / server.js)

```js
const express      = require('express');
const cookieParser = require('cookie-parser');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');

const authRoutes   = require('./src/routes/auth.routes');

const app = express();

app.use(helmet());
app.use(express.json());
app.use(cookieParser());             // required for refresh-token cookie parsing

// Rate-limit the auth endpoints
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use('/auth', authLimiter, authRoutes);

// All other routes mount here (examples):
const authenticate    = require('./src/middleware/authenticate');
const { Guards, authorize, authorizeMin, authorizeSelfOrRole } = require('./src/middleware/authorize');

// ── Tenant portal endpoints ───────────────────────────────────────────────────
app.get ('/api/tenant/dashboard',        authenticate, Guards.tenantOnly,    tenantDashboardHandler);
app.get ('/api/tenant/:tenantId/lease',  authenticate, authorizeSelfOrRole('tenantId','property_manager'), leaseHandler);
app.post('/api/maintenance',             authenticate, Guards.anyRole,       submitMaintenanceHandler);

// ── Manager / owner portal endpoints ─────────────────────────────────────────
app.get ('/api/properties',              authenticate, Guards.staffOnly,     listPropertiesHandler);
app.get ('/api/payments/summary',        authenticate, Guards.ownerAndAbove, paymentSummaryHandler);
app.post('/api/access-codes',            authenticate, Guards.staffOnly,     createAccessCodeHandler);
app.get ('/api/maintenance/queue',       authenticate, Guards.staffOnly,     maintenanceQueueHandler);

// ── Dev/Admin endpoints ───────────────────────────────────────────────────────
app.get ('/api/admin/users',             authenticate, Guards.adminOnly,     listUsersHandler);
app.post('/api/admin/organizations',     authenticate, Guards.adminOnly,     createOrgHandler);
```

## Role reference

| Role              | Rank | Can access                                          |
|-------------------|------|-----------------------------------------------------|
| `super_admin`     |  40  | Everything — dev/admin panel                        |
| `owner`           |  30  | All properties in their org, financials             |
| `property_manager`|  20  | Assigned properties, maintenance queue, tenant data |
| `tenant`          |  10  | Their own unit, lease, payments, maintenance        |

## Environment variables required

```
JWT_ACCESS_SECRET=<32+ random bytes, base64>
JWT_REFRESH_SECRET=<32+ random bytes, base64, different from access secret>
JWT_ACCESS_EXPIRES_IN=15m       # default
JWT_REFRESH_EXPIRES_IN=30d      # default
DATABASE_URL=postgresql://user:pass@host:5432/dbname
NODE_ENV=production              # enables Secure flag on cookie
```

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```
