/**
 * authenticate.js
 * Express middleware: verifies the Bearer access token on every protected route.
 *
 * On success → attaches req.user = { id, role } and calls next().
 * On failure → returns 401 with a structured error body.
 *
 * Usage:
 *   router.get('/protected', authenticate, handler);
 */

const { verifyAccessToken } = require('../utils/jwt.utils');
const { attachActivityAudit } = require('./activity-audit');

/**
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'MISSING_TOKEN',
      message: 'Authorization: Bearer <token> header is required.',
    });
  }

  const token = authHeader.slice(7); // strip 'Bearer '

  try {
    const payload = verifyAccessToken(token);
    // Attach minimal user context — never expose the full DB row here
    req.user = {
      id: payload.sub,
      role: payload.role,
      impersonatedBy: payload.imp ? payload.actor : null,
      impersonatorRole: payload.imp ? payload.actorRole ?? null : null,
    };
    attachActivityAudit(req, res);
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'TOKEN_EXPIRED',
        message: 'Access token has expired. Use your refresh token to obtain a new one.',
      });
    }
    return res.status(401).json({
      error: 'INVALID_TOKEN',
      message: 'Access token is invalid or has been tampered with.',
    });
  }
}

module.exports = authenticate;
