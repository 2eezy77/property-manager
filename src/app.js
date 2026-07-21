/**
 * app.js — Express application entry point.
 */

require('./config/env');

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const { rateLimit, MemoryStore } = require('express-rate-limit');
const path         = require('path');

// Route imports
const authRoutes          = require('./routes/auth.routes');
const paymentRoutes       = require('./routes/payments.routes');
const messageRoutes       = require('./routes/messages.routes');
const leaseRoutes         = require('./routes/leases.routes');
const maintenanceRoutes   = require('./routes/maintenance.routes');
const propertiesRoutes    = require('./routes/properties.routes');
const tenantsRoutes       = require('./routes/tenants.routes');
const announcementsRoutes = require('./routes/announcements.routes');
const utilitiesRoutes     = require('./routes/utilities.routes');
const usersRoutes         = require('./routes/users.routes');
const ownerFinanceRoutes    = require('./routes/owner-finance.routes');
const managerPlaybookRoutes = require('./routes/manager-playbook.routes');
const adminUsersRoutes      = require('./routes/admin-users.routes');
const portalLaunchRoutes    = require('./routes/portal-launch.routes');
const siteVisitsRoutes      = require('./routes/site-visits.routes');

// Webhook imports
const stripeWebhook = require('./webhooks/stripe.webhook');
const plaidWebhook  = require('./webhooks/plaid.webhook');
const rlWebhook     = require('./webhooks/rocketlawyer.webhook');

const { isPrivateLanOrigin, printLanDevBanner } = require('./utils/lan-dev');

const app  = express();
const PORT = process.env.PORT ?? 8080;
// Railway/cloud must reach the process — bind all interfaces in production (not 127.0.0.1 only).
const HOST = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const LAN_DEV = process.env.DEV_LAN === '1' || process.env.DEV_LAN === 'true';

/** Production canonical origin — always https + www (Railway issues cert on www). */
function productionCanonicalOrigin() {
  const raw = process.env.CLIENT_ORIGIN;
  if (!raw || process.env.NODE_ENV !== 'production') return null;
  try {
    const u = new URL(raw);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return null;
    u.protocol = 'https:';
    if (!u.hostname.startsWith('www.')) u.hostname = `www.${u.hostname}`;
    return u.origin;
  } catch {
    return null;
  }
}

function corsOrigins() {
  const base = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
  const set = new Set([base]);
  try {
    const u = new URL(base);
    const bare = u.hostname.replace(/^www\./, '');
    set.add(`${u.protocol}//${bare}`);
    set.add(`${u.protocol}//www.${bare}`);
    set.add(`https://${bare}`);
    set.add(`https://www.${bare}`);
  } catch { /* localhost */ }
  return set;
}

const canonicalOrigin = productionCanonicalOrigin();
const allowedOrigins  = corsOrigins();

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    if (!canonicalOrigin) return next();
    const proto = req.headers['x-forwarded-proto'] ?? (req.secure ? 'https' : 'http');
    const host  = req.hostname;
    const want  = new URL(canonicalOrigin).hostname;
    if (proto !== 'https' || host !== want) {
      return res.redirect(301, `${canonicalOrigin}${req.originalUrl}`);
    }
    next();
  });
}

// Security middleware — CSP for Plaid Link + Stripe.js (https://plaid.com/docs/link/web/#csp-guidance)
const PLAID_CDN = 'https://cdn.plaid.com';
// https://docs.stripe.com/security/guide#content-security-policy
const STRIPE_JS = 'https://js.stripe.com';
const STRIPE_JS_WILDCARD = 'https://*.js.stripe.com';
const STRIPE_CONNECT_JS = 'https://connect-js.stripe.com';
const STRIPE_API = 'https://api.stripe.com';
const STRIPE_RADAR = 'https://r.stripe.com';
const STRIPE_HOOKS = 'https://hooks.stripe.com';
const STRIPE_CONNECT = 'https://connect.stripe.com';
const STRIPE_CHECKOUT = 'https://checkout.stripe.com';

function plaidCspConnectSources() {
  const env = process.env.PLAID_ENV ?? 'sandbox';
  if (env === 'production') return ['https://production.plaid.com', PLAID_CDN];
  if (env === 'development') return ['https://development.plaid.com', PLAID_CDN];
  return ['https://sandbox.plaid.com', PLAID_CDN];
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", PLAID_CDN],
      scriptSrc: ["'self'", "'unsafe-inline'", PLAID_CDN, STRIPE_JS, STRIPE_JS_WILDCARD, STRIPE_CONNECT_JS],
      frameSrc: [
        "'self'",
        PLAID_CDN,
        STRIPE_JS,
        STRIPE_JS_WILDCARD,
        STRIPE_HOOKS,
        STRIPE_CONNECT,
        STRIPE_CHECKOUT,
      ],
      childSrc: ["'self'", PLAID_CDN, STRIPE_JS, STRIPE_JS_WILDCARD],
      connectSrc: [
        "'self'",
        ...plaidCspConnectSources(),
        STRIPE_API,
        STRIPE_RADAR,
        STRIPE_JS,
        STRIPE_JS_WILDCARD,
      ],
      imgSrc: ["'self'", 'data:', 'blob:', PLAID_CDN, 'https://*.stripe.com'],
      styleSrcElem: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      styleSrcAttr: ["'unsafe-inline'"],
    },
  },
}));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.has(origin)) return cb(null, true);
    const lanOk = LAN_DEV || process.env.NODE_ENV !== 'production';
    if (lanOk && isPrivateLanOrigin(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Raw-body webhooks — must be mounted BEFORE express.json()
app.use(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  stripeWebhook
);

app.use(
  '/webhooks/plaid',
  express.raw({ type: 'application/json' }),
  plaidWebhook
);

// Rocket Lawyer webhook (JSON body — its own parser is inside the router)
app.use('/webhooks/rocketlawyer', rlWebhook);

// Site visits — multi-video check-in payloads (before default JSON limit)
app.use('/api/site-visits', express.json({ limit: '100mb' }));

// Standard body parsing + cookies
app.use(express.json({ limit: '6mb' }));
app.use(cookieParser());

// Rate limiters (MemoryStore so dev tools can resetAll in-process)
const authStore = new MemoryStore();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      20,
  store:    authStore,
  message:  { error: 'TOO_MANY_REQUESTS', message: 'Too many auth attempts. Try again in 15 minutes.' },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      120,
});

// Serve generated lease PDFs at /documents/<filename>
app.use('/documents', express.static(path.resolve(__dirname, '../documents')));
app.use('/uploads/site-visits', express.static(path.resolve(__dirname, '../uploads/site-visits')));

// Dev email template gallery (no SMTP — render HTML only)
const { isEmailPreviewAllowed } = require('./services/email-templates');
if (isEmailPreviewAllowed()) {
  const devEmailPreviews = require('./routes/dev-email-previews.routes');
  app.use('/api/dev/email-previews', devEmailPreviews);
}

// Dev-only: clear in-memory /auth rate limit (must NOT sit behind authLimiter)
if (process.env.NODE_ENV !== 'production') {
  app.post('/dev/reset-auth-rate-limit', async (req, res) => {
    const secret = process.env.DEV_TOOLS_SECRET;
    if (secret) {
      const provided = req.headers['x-dev-tools-secret'] || req.body?.secret;
      if (provided !== secret) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid or missing DEV_TOOLS_SECRET.' });
      }
    }
    try {
      if (typeof authStore.resetAll === 'function') {
        await authStore.resetAll();
      } else {
        await authLimiter.resetKey(req.ip);
      }
      res.json({ ok: true, message: 'Auth rate limit cleared.' });
    } catch (err) {
      res.status(500).json({ error: 'RESET_FAILED', message: err.message });
    }
  });
}

// Routes
app.use('/auth',              authLimiter, authRoutes);
app.use('/api/payments',      apiLimiter,  paymentRoutes);
app.use('/api/messages',      apiLimiter,  messageRoutes);
app.use('/api/leases',        apiLimiter,  leaseRoutes);
app.use('/api/maintenance',   apiLimiter,  maintenanceRoutes);
app.use('/api/properties',    apiLimiter,  propertiesRoutes);
app.use('/api/tenants',       apiLimiter,  tenantsRoutes);
app.use('/api/announcements', apiLimiter,  announcementsRoutes);
app.use('/api/utilities',     apiLimiter,  utilitiesRoutes);
app.use('/api/users',         apiLimiter,  usersRoutes);
app.use('/api/owner',         apiLimiter,  ownerFinanceRoutes);
app.use('/api/owner/portal-launch', apiLimiter, portalLaunchRoutes);
app.use('/api/admin/users',   apiLimiter,  adminUsersRoutes);
app.use('/api/manager',       apiLimiter,  managerPlaybookRoutes);
app.use('/api/site-visits',   apiLimiter,  siteVisitsRoutes);
app.use('/api/manager-compensation', apiLimiter, require('./routes/manager-compensation.routes'));

// Health check
app.get('/health', async (_req, res) => {
  const payload = { status: 'ok', ts: new Date().toISOString() };
  if (process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET) {
    try {
      const plaid = require('./services/plaid.service');
      payload.plaid = await plaid.probeLinkToken();
    } catch {
      payload.plaid = { ok: false, error: 'probe_failed' };
    }
  }
  res.json(payload);
});

// Serve React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve(__dirname, '../client/dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, '../client/dist', 'index.html'));
  });
}

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[unhandled error]', err);
  res.status(500).json({ error: 'SERVER_ERROR', message: 'An unexpected error occurred.' });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (HOST === '0.0.0.0' || LAN_DEV) {
    printLanDevBanner({ apiPort: PORT, uiPort: 5173 });
  }
  if (process.env.RENT_BILLING_ENABLED !== 'false') {
    const { scheduleDailyRentBilling } = require('./services/rent-billing.service');
    scheduleDailyRentBilling();
  }
  try {
    const { startEventsPoller } = require('./services/rocketlawyer.service');
    startEventsPoller();
  } catch (err) {
    console.warn('[rocket-lawyer] events poller not started:', err.message);
  }
});

module.exports = app;
