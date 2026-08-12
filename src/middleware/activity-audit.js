/**
 * Records API activity after response (org-wide, all roles including owners).
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

/** Full request path (mount-safe). Express req.path is router-relative. */
function requestPath(req) {
  const raw = req.originalUrl || req.url || req.path || '';
  const pathOnly = String(raw).split('?')[0];
  if (pathOnly) return pathOnly;
  const base = req.baseUrl || '';
  const leaf = req.path || '';
  return `${base}${leaf}` || '';
}

function shouldCapture(req) {
  if (!req.user?.id) return false;
  const p = requestPath(req);
  if (SKIP_EXACT.has(p)) return false;
  if (SKIP_PATH_PREFIXES.some((pre) => p.startsWith(pre))) return false;
  if (p.startsWith('/webhooks')) return false;
  const method = req.method?.toUpperCase();
  // Cash App return sync is GET but is a real payment event
  if (method === 'GET' && p === '/api/payments/cashapp/sync') return true;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  return p.startsWith('/api/') || p.startsWith('/auth/');
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

module.exports = { attachActivityAudit, shouldCapture, requestPath };
