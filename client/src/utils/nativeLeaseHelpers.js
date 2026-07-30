export function deriveNativeLeaseStep(lease) {
  if (!lease || lease.signing_provider !== 'native') return null;
  switch (lease.status) {
    case 'draft':
      return 'draft';
    case 'pending_tenant_signature':
      return 'sign_tenant';
    case 'pending_manager_signature':
      return 'sign_manager';
    case 'awaiting_deposit':
      return 'pay_deposit';
    case 'active':
      return 'active';
    default:
      return lease.status;
  }
}
