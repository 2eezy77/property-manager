/**
 * Records meaningful API activity after response (org-wide, all roles including owners).
 * Allowlisted — not every mutation (avoids inbox/mark-read/link-token spam).
 */

const { logActivity } = require('../services/activity-audit.service');

const SKIP_PATH_PREFIXES = [
  '/health',
  '/api/dev/',
  '/documents/',
];

const SKIP_EXACT = new Set([
  '/auth/me',
]);

/** Paths that must never be logged even if they match a prefix. */
const SKIP_PATH_EXACT = new Set([
  '/api/payments/plaid/link-token',
  '/api/payments/plaid/update-link-token',
]);

/**
 * Meaningful mutations only. Auth login/session/logout are logged from auth.routes
 * (not via this middleware — those routes are unauthenticated).
 */
const CAPTURE_RULES = [
  { method: 'GET', path: '/api/payments/cashapp/sync' },
  { method: 'POST', path: '/api/payments/charge' },
  { method: 'POST', path: '/api/payments/card/create-intent' },
  { method: 'POST', path: '/api/payments/cashapp/create-intent' },
  { method: 'POST', path: '/api/payments/record' },
  { method: 'POST', path: '/api/payments/run-billing' },
  { method: 'PATCH', path: '/api/payments/autopay' },
  { method: 'POST', re: /^\/api\/payments\/late-fees\/[^/]+\/waive$/ },
  { method: 'POST', path: '/api/payments/plaid/exchange' },
  { method: 'POST', path: '/api/payments/plaid/exchange-update' },
  { method: 'DELETE', re: /^\/api\/payments\/bank-accounts\/[^/]+$/ },
  { method: 'POST', path: '/api/utilities/bills' },
  { method: 'POST', path: '/api/utilities/bills/recalculate-splits' },
  { method: 'POST', re: /^\/api\/utilities\/bills\/[^/]+\/notify$/ },
  { method: 'POST', re: /^\/api\/utilities\/bills\/[^/]+\/charge$/ },
  { method: 'POST', re: /^\/api\/utilities\/splits\/[^/]+\/dispute$/ },
  { method: 'POST', re: /^\/api\/utilities\/splits\/[^/]+\/waive$/ },
  { method: 'POST', re: /\/gmail\/import$/ },
  { method: 'POST', path: '/api/maintenance' },
  { method: 'POST', re: /^\/api\/maintenance\/[^/]+\/bill-tenant$/ },
  { method: 'PATCH', re: /^\/api\/maintenance\/[^/]+$/ },
  { method: 'POST', path: '/api/announcements' },
  { method: 'POST', path: '/api/users/me/password' },
  { method: 'POST', re: /^\/api\/admin\/users\/[^/]+\/password$/ },
  { method: 'POST', path: '/api/admin/users/tenants/email-passwords' },
  { method: 'POST', path: '/api/owner/portal-launch/send' },
  { method: 'POST', re: /^\/api\/users\/[^/]+\/impersonate$/ },
  { method: 'POST', path: '/api/site-visits/request' },
  { method: 'POST', re: /^\/api\/site-visits\/[^/]+\/(approve|reject|cancel|complete)$/ },
  { method: 'POST', path: '/api/site-visits/payroll/pay' },
  { method: 'POST', path: '/api/site-visits/payout-bank/plaid/exchange' },
  { method: 'DELETE', re: /^\/api\/site-visits\/payout-bank\/[^/]+$/ },
  { method: 'POST', path: '/api/owner/property-bank/plaid/exchange' },
  { method: 'DELETE', re: /^\/api\/owner\/property-bank\/[^/]+$/ },
  { method: 'POST', path: '/api/manager-compensation/lease-signing/sync' },
  { method: 'POST', re: /^\/api\/manager-compensation\/lease-signing\/[^/]+\/(pay|mark-paid-externally)$/ },
  { method: 'POST', path: '/api/leases/native' },
  { method: 'POST', path: '/api/leases/activate-signed' },
  { method: 'POST', re: /^\/api\/leases\/[^/]+\/activate-signed$/ },
  { method: 'POST', re: /^\/api\/leases\/[^/]+\/(sign|send|invite)/ },
  { method: 'POST', path: '/api/tenants' },
];

/** Full request path (mount-safe). Express req.path is router-relative. */
function requestPath(req) {
  const raw = req.originalUrl || req.url || req.path || '';
  const pathOnly = String(raw).split('?')[0];
  if (pathOnly) return pathOnly;
  const base = req.baseUrl || '';
  const leaf = req.path || '';
  return `${base}${leaf}` || '';
}

function matchesCaptureRule(method, path) {
  if (SKIP_PATH_EXACT.has(path)) return false;
  return CAPTURE_RULES.some((rule) => {
    if (rule.method !== method) return false;
    if (rule.path) return rule.path === path;
    if (rule.re) return rule.re.test(path);
    return false;
  });
}

function shouldCapture(req) {
  if (!req.user?.id) return false;
  const p = requestPath(req);
  if (SKIP_EXACT.has(p)) return false;
  if (SKIP_PATH_PREFIXES.some((pre) => p.startsWith(pre))) return false;
  if (p.startsWith('/webhooks')) return false;
  const method = req.method?.toUpperCase();
  if (method === 'HEAD' || method === 'OPTIONS') return false;
  return matchesCaptureRule(method, p);
}

function attachActivityAudit(req, res) {
  if (!shouldCapture(req)) return;

  const realActorId = req.user.impersonatedBy || req.user.id;
  const displayActorId = req.user.impersonatedBy ? req.user.id : req.user.id;
  const path = requestPath(req);

  res.on('finish', () => {
    logActivity({
      realActorId,
      displayActorId,
      impersonatorUserId: req.user.impersonatedBy || null,
      method: req.method,
      path,
      statusCode: res.statusCode,
      body: req.body,
      ip: req.ip,
    }).catch((err) => {
      console.error('[activity-audit]', err.message);
    });
  });
}

module.exports = {
  attachActivityAudit,
  shouldCapture,
  requestPath,
  matchesCaptureRule,
};
