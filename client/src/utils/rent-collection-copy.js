/** Keep in sync with paidCountSublabel in src/services/rent-status.service.js */

export function paidCountSublabel({ paid_count = 0, partial_count = 0, tenant_count = 0 } = {}) {
  const paid = Number(paid_count) || 0;
  const partial = Number(partial_count) || 0;
  const total = Number(tenant_count) || 0;
  if (partial > 0) return `${paid}/${total} paid · ${partial} partial`;
  return `${paid}/${total} paid`;
}

export function tenantsPaidSub({ paid_count = 0, partial_count = 0 } = {}) {
  const partial = Number(partial_count) || 0;
  if (partial > 0) return `${paid_count} fully paid · ${partial} partial`;
  return 'fully paid this month';
}
