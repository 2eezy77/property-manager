/**
 * Activity audit — org-wide plain-English log (all owners see the same list).
 */

const pool = require('../db/client');

const SENSITIVE_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'password_hash',
  'token',
  'accesstoken',
  'refreshtoken',
]);

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = '[redacted]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizeBody(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function isPrimaryOwner(userId) {
  if (!userId) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM organizations WHERE owner_id = $1 LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

async function resolveOrgIdForUser(userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(
       (SELECT org_id FROM users WHERE id = $1),
       (SELECT id FROM organizations WHERE owner_id = $1 LIMIT 1)
     ) AS org_id`,
    [userId]
  );
  return rows[0]?.org_id ?? null;
}

async function loadActor(userId) {
  const { rows } = await pool.query(
    `SELECT id, email, first_name, last_name, role FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

function actorDisplayName(actor) {
  if (!actor) return 'Someone';
  const n = [actor.first_name, actor.last_name].filter(Boolean).join(' ');
  return n || actor.email || 'User';
}

function moneyLabel(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return `$${n.toFixed(2)}`;
}

function paymentTypeLabel(paymentType) {
  const t = String(paymentType || 'payment').toLowerCase();
  if (t === 'utility' || t === 'utilities') return 'utilities';
  if (t === 'rent') return 'rent';
  if (t === 'security_deposit') return 'security deposit';
  if (t === 'identity_verification_fee') return 'identity fee';
  return t.replace(/_/g, ' ');
}

function paymentMethodLabel(body = {}) {
  const raw = body.paymentMethod || body.payment_method || body.source || '';
  const s = String(raw).toLowerCase();
  if (s.includes('cashapp') || s.includes('cash_app') || s === 'cash_app') return 'Cash App';
  if (s.includes('card') || s === 'stripe_card') return 'card';
  if (s.includes('ach') || s.includes('bank') || s === 'stripe_ach') return 'ACH';
  if (s.includes('plaid')) return 'ACH';
  return null;
}

/** Stripe-style payment one-liner. */
function formatPaymentSummary(who, { paymentType, amount, method, statusCode, phase = 'started' }) {
  const type = paymentTypeLabel(paymentType);
  const money = moneyLabel(amount);
  const via = method ? ` via ${method}` : '';
  const amt = money ? ` ${money}` : '';
  if (statusCode >= 400) {
    return `${who} failed ${type} payment${amt}${via}`;
  }
  if (phase === 'confirmed') {
    return `${who} paid${amt} ${type}${via}`.replace('  ', ' ');
  }
  if (phase === 'submitted') {
    return `${who} submitted${amt} ${type} payment${via}`.replace('  ', ' ');
  }
  return `${who} started${amt} ${type} payment${via}`.replace('  ', ' ');
}

/** Build a plain-English one-liner from HTTP request. */
function buildSummary({ actor, impersonator, method, path, body, statusCode }) {
  const name = actorDisplayName(actor);
  const who = impersonator
    ? `${actorDisplayName(impersonator)} (previewing as ${name})`
    : name;

  const p = path.split('?')[0];
  const b = body || {};

  if (p === '/auth/login' && method === 'POST') {
    if (statusCode >= 400) return `${name} failed to sign in`;
    return `${name} signed in`;
  }
  if (p === '/auth/refresh' && method === 'POST') {
    return `${name} opened the portal`;
  }
  if (p === '/auth/logout' && method === 'POST') {
    return `${who} signed out`;
  }
  if (p === '/events/payment_confirmed') {
    return formatPaymentSummary(who, {
      paymentType: b.paymentType || b.payment_type,
      amount: b.amount,
      method: paymentMethodLabel(b),
      statusCode: statusCode || 200,
      phase: 'confirmed',
    });
  }
  if (p === '/auth/forgot-password' && method === 'POST') {
    return 'Password reset requested';
  }
  if (p === '/auth/reset-password' && method === 'POST') {
    if (statusCode >= 400) return 'Password reset failed';
    return b.email ? `Password reset completed for ${b.email}` : 'Password reset completed';
  }
  if (p === '/api/users/me/password' && method === 'POST') {
    return `${who} changed their portal password`;
  }
  if (p === '/api/owner/portal-launch/send' && method === 'POST') {
    return b.dryRun
      ? `${who} dry-ran portal launch emails`
      : `${who} sent portal launch emails`;
  }
  if (/\/api\/admin\/users\/[^/]+\/password$/.test(p) && method === 'POST') {
    return b.sendEmail === false
      ? `${who} set a user password (not emailed)`
      : `${who} set and emailed a user password`;
  }
  if (p === '/api/admin/users/tenants/email-passwords' && method === 'POST') {
    return `${who} emailed portal passwords to all tenants`;
  }
  if (/\/api\/utilities\/bills\/[^/]+\/notify$/.test(p) && method === 'POST') {
    return `${who} notified tenants about a utility bill`;
  }
  if (/\/api\/utilities\/bills\/[^/]+\/charge$/.test(p) && method === 'POST') {
    return `${who} ran ACH charges on a utility bill`;
  }
  if (p === '/api/utilities/bills/recalculate-splits' && method === 'POST') {
    return `${who} recalculated utility tenant shares`;
  }
  if (p.includes('/gmail/import') && method === 'POST') {
    return `${who} imported utility bills from Gmail`;
  }
  if (p === '/api/utilities/bills' && method === 'POST') {
    return `${who} created a utility bill`;
  }
  if (/\/api\/utilities\/splits\/[^/]+\/dispute$/.test(p) && method === 'POST') {
    return `${who} disputed a utility charge`;
  }
  if (/\/api\/utilities\/splits\/[^/]+\/waive$/.test(p) && method === 'POST') {
    return `${who} waived a utility split`;
  }
  if (/\/api\/users\/[^/]+\/impersonate$/.test(p) && method === 'POST') {
    return `${who} opened a portal preview as another user`;
  }
  if (p === '/api/site-visits/request' && method === 'POST') {
    return `${who} requested a boots-on-site inspection (awaiting owner approval)`;
  }
  if (/\/api\/site-visits\/[^/]+\/approve$/.test(p) && method === 'POST') {
    return `${who} approved a manager on-site visit ($20; common-area announcement + room inbox notices when applicable)`;
  }
  if (/\/api\/site-visits\/[^/]+\/reject$/.test(p) && method === 'POST') {
    return `${who} rejected a manager on-site visit request`;
  }
  if (/\/api\/site-visits\/[^/]+\/cancel$/.test(p) && method === 'POST') {
    return `${who} cancelled a scheduled on-site inspection`;
  }
  if (/\/api\/site-visits\/[^/]+\/complete$/.test(p) && method === 'POST') {
    return `${who} completed an on-site inspection with area videos (announcement + inbox notices sent when applicable)`;
  }
  if (p === '/api/manager-compensation/lease-signing/sync' && method === 'POST') {
    if (statusCode >= 400) return `${who} failed to sync lease-signing fees`;
    return `${who} synced lease-signing fees for active leases ($350 each)`;
  }
  if (/\/api\/manager-compensation\/lease-signing\/[^/]+\/pay$/.test(p) && method === 'POST') {
    if (statusCode >= 400) return `${who} failed to mark a lease-signing fee paid`;
    const methodLabel = b.paymentMethod ? String(b.paymentMethod).replace(/_/g, ' ') : 'manual';
    return `${who} paid Konstantin $350 lease-signing fee (${methodLabel})`;
  }
  if (/\/api\/manager-compensation\/lease-signing\/[^/]+\/mark-paid-externally$/.test(p) && method === 'POST') {
    if (statusCode >= 400) return `${who} failed to clear a lease-signing fee already paid outside the app`;
    return `${who} marked a lease-signing fee as already paid outside the app`;
  }
  if (p === '/api/leases/activate-signed' || /\/api\/leases\/[^/]+\/activate-signed$/.test(p)) {
    if (method === 'POST' && statusCode < 400) {
      return `${who} marked a lease fully signed and recorded manager compensation`;
    }
  }
  if (p === '/api/site-visits/payroll/pay' && method === 'POST') {
    if (statusCode >= 400) return `${who} failed to mark manager visit payroll paid`;
    const methodLabel = b.paymentMethod ? String(b.paymentMethod).replace(/_/g, ' ') : 'manual';
    const period = b.year && b.month ? `${b.month}/${b.year}` : 'selected month';
    return `${who} marked manager site-visit payroll paid for ${period} (${methodLabel})`;
  }
  if (p === '/api/owner/property-bank/plaid/exchange' && method === 'POST') {
    if (statusCode >= 400) return `${who} failed to link the property operating bank account`;
    return `${who} linked the joint property operating bank account`;
  }
  if (/\/api\/owner\/property-bank\/[^/]+$/.test(p) && method === 'DELETE') {
    return `${who} removed the property operating bank account`;
  }
  if (p === '/api/site-visits/payout-bank/plaid/exchange' && method === 'POST') {
    if (statusCode >= 400) return `${who} failed to link a manager payout bank account`;
    return `${who} linked a payout bank account for site-visit earnings`;
  }
  if (/\/api\/site-visits\/payout-bank\/[^/]+$/.test(p) && method === 'DELETE') {
    return `${who} removed a manager payout bank account`;
  }
  if (p === '/api/payments/charge' && method === 'POST') {
    return formatPaymentSummary(who, {
      paymentType: b.paymentType || 'rent',
      amount: b.amount,
      method: paymentMethodLabel({ ...b, payment_method: b.paymentMethod || 'ach' }) || 'ACH',
      statusCode,
      phase: statusCode >= 400 ? 'started' : 'submitted',
    });
  }
  if (p === '/api/payments/card/create-intent' && method === 'POST') {
    return formatPaymentSummary(who, {
      paymentType: b.paymentType || 'rent',
      amount: b.amount,
      method: 'card',
      statusCode,
      phase: 'started',
    });
  }
  if (p === '/api/payments/cashapp/create-intent' && method === 'POST') {
    return formatPaymentSummary(who, {
      paymentType: b.paymentType || 'rent',
      amount: b.amount,
      method: 'Cash App',
      statusCode,
      phase: 'started',
    });
  }
  if (p === '/api/payments/cashapp/sync' && (method === 'GET' || method === 'POST')) {
    return formatPaymentSummary(who, {
      paymentType: b.paymentType || 'payment',
      amount: b.amount,
      method: 'Cash App',
      statusCode,
      phase: statusCode >= 400 ? 'started' : 'confirmed',
    });
  }
  if (p === '/api/payments/record' && method === 'POST') {
    return `${who} recorded a payment manually`;
  }
  if (p === '/api/payments/run-billing' && method === 'POST') {
    return `${who} ran monthly rent billing`;
  }
  if (p === '/api/payments/autopay' && (method === 'PATCH' || method === 'PUT')) {
    return b.enabled === false
      ? `${who} turned off autopay`
      : `${who} turned on autopay`;
  }
  if (/\/api\/payments\/late-fees\/[^/]+\/waive$/.test(p) && method === 'POST') {
    return `${who} waived a late fee`;
  }
  if (/\/api\/maintenance\/[^/]+\/bill-tenant$/.test(p) && method === 'POST') {
    return `${who} charged a tenant for maintenance damage`;
  }
  if (/\/api\/maintenance/.test(p) && method === 'POST') {
    return `${who} submitted a maintenance request`;
  }
  if (/\/api\/maintenance\/[^/]+$/.test(p) && method === 'PATCH') {
    return `${who} updated a maintenance request`;
  }
  if (/\/api\/payments\/plaid/.test(p) && method === 'POST') {
    return `${who} linked or updated a bank account`;
  }
  if (/\/api\/announcements/.test(p) && method === 'POST') {
    return `${who} sent an announcement`;
  }
  if (/\/api\/tenants/.test(p) && method === 'POST') {
    return `${who} created or invited a tenant`;
  }
  if (method === 'DELETE') {
    return `${who} deleted something (${p.replace('/api/', '')})`;
  }
  if (method === 'PATCH' || method === 'PUT') {
    return `${who} updated ${p.replace('/api/', '')}`;
  }
  if (method === 'POST') {
    return `${who} created ${p.replace('/api/', '')}`;
  }

  return `${who} — ${method} ${p}`;
}

/** Plain guidance returned to the Activity log UI (same for every owner viewer). */
function getActivityPolicy() {
  return {
    headline: 'Shared log — every owner sees the same events.',
    tracks: [
      'Both owners (you and your co-owner), manager, and tenants',
      'Password sign-in, portal opens (returning sessions), sign-out, failed sign-in',
      'Payments like Stripe: ACH / card / Cash App for rent, deposit, and utilities (started + confirmed)',
      'Billing runs, late fees, autopay, bank link',
      'Utilities: bills, notify, disputes',
      'Passwords, launch emails, announcements',
      'Maintenance and portal previews',
    ],
    skips: [
      'Routine page loads and /auth/me',
      'Repeat session opens within 4 hours (debounced)',
      'Passwords and bank tokens (always redacted)',
    ],
    visibility: 'Owners only. Managers and tenants cannot open this page.',
    recommendation:
      'One source of truth for the month — no need to ask each other who did what.',
    shared: true,
  };
}

function inferCategory(path) {
  if (path.startsWith('/auth')) return 'auth';
  if (path === '/events/payment_confirmed' || path.includes('/payments')) return 'payments';
  if (path.includes('/utilities')) return 'utilities';
  if (path.includes('/maintenance')) return 'maintenance';
  if (path.includes('/users') || path.includes('/admin/users')) return 'users';
  if (path.includes('/portal-launch')) return 'communications';
  if (path.includes('/announcements')) return 'communications';
  if (path.includes('/leases')) return 'leases';
  if (path.includes('/tenants')) return 'tenants';
  if (path.includes('/messages')) return 'messages';
  return 'api';
}

function inferAction(method, path, statusCode) {
  if (path === '/auth/login') return 'login';
  if (path === '/auth/refresh') return 'session';
  if (path === '/auth/logout') return 'logout';
  if (path === '/events/payment_confirmed') return 'payment_confirmed';
  if (path === '/auth/forgot-password') return 'password_reset_request';
  if (path === '/auth/reset-password') return 'password_reset';
  if (path.includes('password')) return 'password';
  if (path.includes('create-intent') || path.includes('/charge') || path.includes('cashapp/sync')) {
    return statusCode >= 400 ? 'payment_failed' : 'payment';
  }
  if (path.includes('charge')) return 'charge';
  if (path.includes('notify')) return 'notify';
  if (path.includes('email')) return 'email';
  if (method === 'DELETE') return 'delete';
  if (method === 'POST') return 'create';
  if (method === 'PATCH' || method === 'PUT') return 'update';
  if (method === 'GET') return 'view';
  return method?.toLowerCase() || 'action';
}

function extractResourceId(path) {
  const m = path.match(
    /\/(?:bills|splits|tenants|leases|maintenance|payments|users|properties)\/([0-9a-f-]{36})/i
  );
  return m?.[1] ?? null;
}

/**
 * @param {object} opts
 * @param {string} opts.realActorId — user to check for primary-owner skip
 * @param {string} [opts.displayActorId] — tenant/manager when impersonating
 */
async function logActivity({
  realActorId,
  displayActorId,
  impersonatorUserId,
  method,
  path,
  statusCode,
  body,
  ip,
}) {
  if (!realActorId) return null;

  const actor = await loadActor(displayActorId || realActorId);
  const impersonator = impersonatorUserId
    ? await loadActor(impersonatorUserId)
    : null;
  const orgId = await resolveOrgIdForUser(realActorId);

  const summary = buildSummary({
    actor,
    impersonator: impersonatorUserId ? impersonator : null,
    method,
    path,
    body: sanitizeBody(body),
    statusCode,
  });

  const category = inferCategory(path);
  const action = inferAction(method, path, statusCode);
  const resourceId = extractResourceId(path);

  const { rows } = await pool.query(
    `INSERT INTO activity_audit_log
       (org_id, actor_user_id, actor_email, actor_role, impersonator_user_id,
        action, category, summary, method, path, status_code,
        resource_type, resource_id, metadata, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id, created_at`,
    [
      orgId,
      displayActorId || realActorId,
      actor?.email ?? null,
      actor?.role ?? null,
      impersonatorUserId ?? null,
      action,
      category,
      summary,
      method ?? null,
      path ?? null,
      statusCode ?? null,
      resourceId ? category : null,
      resourceId,
      JSON.stringify({
        body: sanitizeBody(body),
        failed: statusCode >= 400,
      }),
      ip ?? null,
    ]
  );
  return rows[0];
}

const SESSION_OPEN_DEBOUNCE_HOURS = 4;

/**
 * Log a returning portal session (refresh cookie), at most once per debounce window.
 * Password sign-ins still use /auth/login via logActivity.
 */
async function logSessionOpen({ userId, ip }) {
  if (!userId) return null;
  const { rows } = await pool.query(
    `SELECT 1
       FROM activity_audit_log
      WHERE actor_user_id = $1
        AND action IN ('login', 'session')
        AND created_at > NOW() - ($2::int * INTERVAL '1 hour')
      LIMIT 1`,
    [userId, SESSION_OPEN_DEBOUNCE_HOURS]
  );
  if (rows.length) return null;
  return logActivity({
    realActorId: userId,
    displayActorId: userId,
    method: 'POST',
    path: '/auth/refresh',
    statusCode: 200,
    ip: ip ?? null,
  });
}

/** Stripe-like confirmed payment line (from webhook settlement). */
async function logPaymentConfirmed({
  tenantId,
  amount,
  paymentType,
  paymentMethod,
  paymentId,
  statusCode = 200,
}) {
  if (!tenantId) return null;
  return logActivity({
    realActorId: tenantId,
    displayActorId: tenantId,
    method: 'POST',
    path: '/events/payment_confirmed',
    statusCode,
    body: {
      amount,
      paymentType,
      payment_type: paymentType,
      payment_method: paymentMethod,
      paymentId,
    },
  });
}

const SINCE_HOURS = { '24h': 24, '7d': 168, '30d': 720 };

async function listActivityLog({
  viewerUserId,
  limit = 100,
  offset = 0,
  category,
  actorUserId,
  actorRole,
  since,
  failedOnly,
}) {
  const orgId = await resolveOrgIdForUser(viewerUserId);
  if (!orgId) return { logs: [], total: 0 };

  const conditions = ['l.org_id = $1'];
  const params = [orgId];
  if (category) {
    params.push(category);
    conditions.push(`l.category = $${params.length}`);
  }
  if (actorUserId) {
    params.push(actorUserId);
    conditions.push(`l.actor_user_id = $${params.length}`);
  }
  if (actorRole) {
    params.push(actorRole);
    conditions.push(`l.actor_role = $${params.length}`);
  }
  const hours = SINCE_HOURS[since];
  if (hours) {
    params.push(hours);
    conditions.push(`l.created_at >= NOW() - ($${params.length}::text || ' hours')::interval`);
  }
  if (failedOnly) {
    conditions.push('(l.status_code >= 400 OR COALESCE((l.metadata->>\'failed\')::boolean, false))');
  }

  const where = conditions.join(' AND ');
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM activity_audit_log l WHERE ${where}`,
    params
  );

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT l.id, l.summary, l.action, l.category, l.method, l.path,
            l.status_code, l.actor_email, l.actor_role, l.created_at,
            l.metadata, l.impersonator_user_id,
            u.first_name AS actor_first_name, u.last_name AS actor_last_name,
            i.first_name AS imp_first_name, i.last_name AS imp_last_name
       FROM activity_audit_log l
       LEFT JOIN users u ON u.id = l.actor_user_id
       LEFT JOIN users i ON i.id = l.impersonator_user_id
      WHERE ${where}
      ORDER BY l.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { logs: rows, total: countRows[0]?.total ?? 0 };
}

module.exports = {
  logActivity,
  logSessionOpen,
  logPaymentConfirmed,
  listActivityLog,
  isPrimaryOwner,
  buildSummary,
  formatPaymentSummary,
  getActivityPolicy,
  SESSION_OPEN_DEBOUNCE_HOURS,
};
