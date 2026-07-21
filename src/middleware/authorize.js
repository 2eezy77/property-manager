/**
 * authorize.js
 * Role-based access control (RBAC) middleware factory.
 *
 * Role hierarchy (most → least privileged):
 *   super_admin > owner > property_manager > tenant
 *
 * ── Usage patterns ────────────────────────────────────────────────────────────
 *
 * 1. Exact role list (user must have ONE of the listed roles):
 *    router.get('/admin', authenticate, authorize('super_admin'), handler);
 *    router.get('/manager-view', authenticate, authorize('owner','property_manager'), handler);
 *
 * 2. Minimum role (user must be AT LEAST that level):
 *    router.get('/any-staff', authenticate, authorizeMin('property_manager'), handler);
 *    // allows: super_admin, owner, property_manager
 *    // blocks: tenant
 *
 * 3. Same-user-or-role guard (tenant can only access their own data):
 *    router.get('/tenants/:tenantId', authenticate,
 *      authorizeSelfOrRole('tenantId', 'property_manager'), handler);
 */

const ROLE_RANK = {
  super_admin:       40,
  owner:             30,
  property_manager:  20,
  tenant:            10,
};

/**
 * Middleware: allows access only if req.user.role is in the provided list.
 * Must be used AFTER the `authenticate` middleware.
 *
 * @param {...string} roles - Allowed role strings
 * @returns {import('express').RequestHandler}
 */
function authorize(...roles) {
  return function _authorize(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Login required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error:   'FORBIDDEN',
        message: `This action requires one of the following roles: ${roles.join(', ')}.`,
      });
    }
    return next();
  };
}

/**
 * Middleware: allows access if req.user.role has AT LEAST the given minimum rank.
 *
 * @param {string} minRole - Minimum required role
 * @returns {import('express').RequestHandler}
 */
function authorizeMin(minRole) {
  const minRank = ROLE_RANK[minRole];
  if (minRank === undefined) throw new Error(`Unknown role: ${minRole}`);

  return function _authorizeMin(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Login required.' });
    }
    const userRank = ROLE_RANK[req.user.role] ?? 0;
    if (userRank < minRank) {
      return res.status(403).json({
        error:   'FORBIDDEN',
        message: `This action requires the '${minRole}' role or higher.`,
      });
    }
    return next();
  };
}

/**
 * Middleware: allows access if the requesting user IS the target user,
 * OR if they have the specified minimum role.
 *
 * Useful for: "a tenant can view their own profile; a manager can view any tenant."
 *
 * @param {string} paramName  - The route param name containing the target user ID
 *                              (e.g. 'tenantId' for /tenants/:tenantId)
 * @param {string} minRole    - Role that bypasses the self-check
 * @returns {import('express').RequestHandler}
 */
function authorizeSelfOrRole(paramName, minRole) {
  const minRank = ROLE_RANK[minRole];
  if (minRank === undefined) throw new Error(`Unknown role: ${minRole}`);

  return function _authorizeSelfOrRole(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Login required.' });
    }

    const isSelf       = req.params[paramName] === req.user.id;
    const hasRoleRank  = (ROLE_RANK[req.user.role] ?? 0) >= minRank;

    if (isSelf || hasRoleRank) return next();

    return res.status(403).json({
      error:   'FORBIDDEN',
      message: 'You can only access your own resources, or you lack the required role.',
    });
  };
}

/**
 * Pre-composed convenience guards used across route files.
 * Import these directly instead of calling authorize() inline everywhere.
 */
const Guards = {
  /** Only dev/admin */
  adminOnly:       authorize('super_admin'),
  /** Owner or admin can see financials / org settings */
  ownerAndAbove:   authorizeMin('owner'),
  /** Managers, owners, and admin */
  staffOnly:       authorizeMin('property_manager'),
  /** Any authenticated user (still requires authenticate middleware) */
  anyRole:         authorize('super_admin','owner','property_manager','tenant'),
  /** Tenants only (blocks staff from accidentally using tenant views) */
  tenantOnly:      authorize('tenant'),
};

module.exports = { authorize, authorizeMin, authorizeSelfOrRole, Guards };
