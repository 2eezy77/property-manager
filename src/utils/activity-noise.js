/**
 * Activity log noise — same rules for capture skip and list filtering
 * so historical Plaid/check-in/inbox/preview rows stay hidden.
 */

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

const SUPERSEDE_WINDOW_HOURS = 6;

function pathOnly(path) {
  return String(path || '').split('?')[0];
}

function isPlaidLinkTokenPath(path) {
  return /\/plaid\/(update-)?link-token$/.test(pathOnly(path));
}

function isImpersonatePath(path) {
  return /\/impersonate$/.test(pathOnly(path));
}

function isNoisePath(path) {
  const p = pathOnly(path);
  if (!p) return false;
  if (SKIP_EXACT.has(p)) return true;
  if (SKIP_PATH_PREFIXES.some((pre) => p.startsWith(pre))) return true;
  if (isPlaidLinkTokenPath(p)) return true;
  if (isImpersonatePath(p)) return true;
  return false;
}

function paymentTypeOf(row = {}) {
  const body = row.metadata?.body || row.body || {};
  return body.paymentType || body.payment_type || null;
}

function createdAtOf(row = {}) {
  return new Date(row.createdAt || row.created_at || 0);
}

/**
 * Successful create-intent rows that already have a later outcome
 * (paid, cancelled, or Cash App sync) — hide the "started" line.
 */
function isSupersededPaymentStart(row, laterRows = []) {
  const path = pathOnly(row.path);
  const status = row.statusCode ?? row.status_code ?? 200;
  if (status >= 400) return false;
  if (!path.includes('/create-intent')) return false;

  const created = createdAtOf(row);
  const windowMs = SUPERSEDE_WINDOW_HOURS * 3600 * 1000;
  const later = laterRows.filter((other) => {
    if ((other.id && row.id && other.id === row.id)) return false;
    const t = createdAtOf(other);
    return t >= created && t - created <= windowMs;
  });

  if (path.startsWith('/api/payments/')) {
    const type = paymentTypeOf(row);
    return later.some((other) => (
      other.action === 'payment_confirmed'
      && paymentTypeOf(other) === type
    ));
  }

  if (path.includes('/payroll/') || path.includes('/lease-signing/')) {
    return later.some((other) => {
      const p = pathOnly(other.path);
      return (
        p.includes('/cancel-processing')
        || p.endsWith('/payroll/pay')
        || p.includes('/cashapp/sync')
        || p.includes('/mark-paid-externally')
      );
    });
  }

  return false;
}

/** SQL fragment: true when `alias`.path is known capture noise. */
function noisePathSql(alias = 'l') {
  const col = `${alias}.path`;
  return `(
    ${col} IN ('/auth/me', '/api/users/me/checkin', '/api/payments/cashapp/sync-gmail')
    OR ${col} LIKE '/api/messages%'
    OR ${col} LIKE '/api/owner/checklist%'
    OR ${col} LIKE '/api/manager-playbook%'
    OR ${col} LIKE '%/plaid/link-token'
    OR ${col} LIKE '%/plaid/update-link-token'
    OR ${col} LIKE '%/impersonate'
  )`;
}

function paymentTypeSql(alias) {
  return `COALESCE(${alias}.metadata->'body'->>'paymentType', ${alias}.metadata->'body'->>'payment_type')`;
}

/** SQL fragment: successful create-intent already completed or cancelled. */
function supersededStartSql(alias = 'l') {
  const typeL = paymentTypeSql(alias);
  const typeLater = paymentTypeSql('later');
  return `(
    COALESCE(${alias}.status_code, 200) < 400
    AND ${alias}.path LIKE '%/create-intent'
    AND (
      (
        ${alias}.path LIKE '/api/payments/%'
        AND EXISTS (
          SELECT 1
            FROM activity_audit_log later
           WHERE later.org_id = ${alias}.org_id
             AND later.actor_user_id IS NOT DISTINCT FROM ${alias}.actor_user_id
             AND later.action = 'payment_confirmed'
             AND later.created_at >= ${alias}.created_at
             AND later.created_at <= ${alias}.created_at + INTERVAL '${SUPERSEDE_WINDOW_HOURS} hours'
             AND ${typeLater} IS NOT DISTINCT FROM ${typeL}
        )
      )
      OR (
        (${alias}.path LIKE '%/payroll/%' OR ${alias}.path LIKE '%/lease-signing/%')
        AND EXISTS (
          SELECT 1
            FROM activity_audit_log later
           WHERE later.org_id = ${alias}.org_id
             AND later.actor_user_id IS NOT DISTINCT FROM ${alias}.actor_user_id
             AND later.id <> ${alias}.id
             AND later.created_at >= ${alias}.created_at
             AND later.created_at <= ${alias}.created_at + INTERVAL '${SUPERSEDE_WINDOW_HOURS} hours'
             AND (
               later.path LIKE '%/cancel-processing'
               OR later.path LIKE '%/payroll/pay'
               OR later.path LIKE '%/cashapp/sync'
               OR later.path LIKE '%/mark-paid-externally'
             )
        )
      )
    )
  )`;
}

module.exports = {
  SKIP_EXACT,
  SKIP_PATH_PREFIXES,
  SUPERSEDE_WINDOW_HOURS,
  isPlaidLinkTokenPath,
  isImpersonatePath,
  isNoisePath,
  isSupersededPaymentStart,
  noisePathSql,
  supersededStartSql,
  pathOnly,
  paymentTypeOf,
};
