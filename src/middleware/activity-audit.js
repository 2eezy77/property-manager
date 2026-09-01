/**
 * Records meaningful API activity after response (org-wide, all roles including owners).
 *
 * Capture authenticated mutations, then skip known noise (Plaid link-token,
 * inbox, check-in, playbook ticks). New payroll / lease / identity routes stay
 * logged without maintaining a frozen allowlist.
 */

const { logActivity } = require('../services/activity-audit.service');

const SKIP_PATH_PREFIXES = [
  '/health',
  '/api/dev/',
  '/documents/',
  '/api/messages',
  '/api/owner/checklist',
  '/api/manager-playbook',
];

const SKIP_EXACT = new Set([
  '/auth/me',
  '/api/users/me/checkin',
  '/api/payments/cashapp/sync-gmail',
]);

const CASHAPP_SYNC_PATHS = new Set([
  '/api/payments/cashapp/sync',
  '/api/payments/bank/sync',
  '/api/site-visits/payroll/cashapp/sync',
  '/api/manager-compensation/lease-signing/cashapp/sync',
]);

/** Full request path (mount-safe). Express req.path is router-relative. */
function requestPath(req) {
  const raw = req.originalUrl || req.url || req.path || '';
  const pathOnly = String(raw).split('?')[0];
  if (pathOnly) return pathOnly;
  const base = req.baseUrl || '';
  const leaf = req.path || '';
  return `${base}${leaf}` || '';
}

function isPlaidLinkTokenPath(path) {
  return /\/plaid\/(update-)?link-token$/.test(path);
}

function isNoisePath(path) {
  if (SKIP_EXACT.has(path)) return true;
  if (SKIP_PATH_PREFIXES.some((pre) => path.startsWith(pre))) return true;
  if (isPlaidLinkTokenPath(path)) return true;
  return false;
}

function shouldCapture(req) {
  if (!req.user?.id) return false;
  const p = requestPath(req);
  if (p.startsWith('/webhooks')) return false;
  if (isNoisePath(p)) return false;
  const method = req.method?.toUpperCase();
  if (method === 'HEAD' || method === 'OPTIONS') return false;
  if (method === 'GET') return CASHAPP_SYNC_PATHS.has(p);
  return p.startsWith('/api/');
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
  isNoisePath,
};
