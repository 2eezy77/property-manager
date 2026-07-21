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
  '/auth/refresh',
]);

function shouldCapture(req) {
  if (!req.user?.id) return false;
  const p = req.path || req.url?.split('?')[0] || '';
  if (SKIP_EXACT.has(p)) return false;
  if (SKIP_PATH_PREFIXES.some((pre) => p.startsWith(pre))) return false;
  if (p.startsWith('/webhooks')) return false;
  const method = req.method?.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  return p.startsWith('/api/') || p === '/auth/login' || p === '/auth/logout';
}

function attachActivityAudit(req, res) {
  if (!shouldCapture(req)) return;

  const realActorId = req.user.impersonatedBy || req.user.id;
  const displayActorId = req.user.impersonatedBy ? req.user.id : req.user.id;

  res.on('finish', () => {
    logActivity({
      realActorId,
      displayActorId,
      impersonatorUserId: req.user.impersonatedBy || null,
      method: req.method,
      path: req.path || req.originalUrl?.split('?')[0],
      statusCode: res.statusCode,
      body: req.body,
      ip: req.ip,
    }).catch((err) => {
      console.error('[activity-audit]', err.message);
    });
  });
}

module.exports = { attachActivityAudit, shouldCapture };
