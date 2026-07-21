/**
 * Rocket Lawyer lease signing — shared step + error helpers.
 * Flow: interview (RocketDocument) → binder (RocketSign) → active lease.
 */

export const RL_ERROR_MESSAGES = {
  RL_APP_PENDING:
    'Rocket Lawyer app approval is still pending. Email api@rocketlawyer.com with your app name, then retry.',
  RL_TEMPLATE_MISSING:
    'Lease template is not configured. Set RL_LEASE_TEMPLATE_ID in server env once RocketDocument v2 is approved.',
  RL_INTERVIEW_INCOMPLETE:
    'The Rocket Lawyer interview is not finished yet. Complete the interview before sending for signature.',
};

export function rlErrorMessage(err, fallback = 'Rocket Lawyer request failed. Please try again.') {
  if (!err?.response) return fallback;
  const { data } = err.response;
  const code = data?.code ?? data?.error;
  if (code && RL_ERROR_MESSAGES[code]) return RL_ERROR_MESSAGES[code];
  if (typeof data?.error === 'string') {
    if (RL_ERROR_MESSAGES[data.error]) return RL_ERROR_MESSAGES[data.error];
    if (data.error.includes('RL_LEASE_TEMPLATE_ID')) {
      return RL_ERROR_MESSAGES.RL_TEMPLATE_MISSING;
    }
    if (data.error.length > 0 && !/^[A-Z_]+$/.test(data.error)) return data.error;
  }
  if (typeof data?.message === 'string' && data.message.length > 0) return data.message;
  return fallback;
}

export function resolveDocumentId(lease) {
  if (!lease) return null;
  if (lease.rl_document_id) return lease.rl_document_id;
  const url = lease.document_url || '';
  if (url.startsWith('rl-doc-')) return url.slice('rl-doc-'.length);
  return null;
}

export function docIsReady(status) {
  if (!status) return false;
  return ['completed', 'ready', 'signed', 'complete'].includes(String(status).toLowerCase());
}

export function docIsInterviewing(status) {
  if (!status) return true;
  const s = String(status).toLowerCase();
  return ['draft', 'created', 'in_progress', 'unknown'].includes(s);
}

/** Manager-facing signing pipeline step key. */
export function deriveSigningStep({ lease, docStatus, latestEnvelope, rlReady = true }) {
  if (!lease) return 'unknown';
  if (lease.status === 'active') return 'active';
  if (['expired', 'terminated'].includes(lease.status)) return lease.status;
  if (rlReady === false) return 'rl_pending';

  const documentId = resolveDocumentId(lease);
  const hasPdf = lease.document_url?.startsWith('http');
  const envStatus = latestEnvelope?.status;

  if (!documentId) return 'needs_interview';

  if (docIsInterviewing(docStatus) && !hasPdf && !docIsReady(docStatus)) {
    return 'interview_in_progress';
  }

  if (!latestEnvelope || ['voided', 'declined'].includes(envStatus)) {
    if (docIsReady(docStatus) || hasPdf) return 'ready_to_send';
    return 'interview_in_progress';
  }

  if (envStatus === 'completed') return 'active';

  const signers = latestEnvelope.signers || [];
  const tenantPending = signers.some(s =>
    s.signer_role === 'Tenant' && s.status !== 'signed'
  );
  if (tenantPending || ['sent', 'pending', 'awaiting_signature'].includes(envStatus)) {
    return 'awaiting_tenant_sign';
  }

  return 'awaiting_signatures';
}

export const SIGNING_STEP_META = {
  rl_pending: {
    label: 'RL setup pending',
    short: 'Setup',
    color: 'bg-amber-100 text-amber-800',
    step: 0,
  },
  needs_interview: {
    label: 'Start interview',
    short: 'Interview',
    color: 'bg-gray-100 text-gray-600',
    step: 1,
  },
  interview_in_progress: {
    label: 'Interview in progress',
    short: 'Interview',
    color: 'bg-blue-100 text-blue-800',
    step: 1,
  },
  ready_to_send: {
    label: 'Ready to send',
    short: 'Send',
    color: 'bg-indigo-100 text-indigo-800',
    step: 2,
  },
  awaiting_tenant_sign: {
    label: 'Awaiting tenant sign',
    short: 'Tenant sign',
    color: 'bg-yellow-100 text-yellow-800',
    step: 3,
  },
  awaiting_signatures: {
    label: 'Awaiting signatures',
    short: 'Signing',
    color: 'bg-yellow-100 text-yellow-800',
    step: 3,
  },
  active: {
    label: 'Active',
    short: 'Active',
    color: 'bg-green-100 text-green-700',
    step: 4,
  },
  expired: {
    label: 'Expired',
    short: 'Expired',
    color: 'bg-red-100 text-red-600',
    step: 4,
  },
  terminated: {
    label: 'Terminated',
    short: 'Ended',
    color: 'bg-gray-100 text-gray-500',
    step: 4,
  },
};

export const FLOW_STEPS = [
  { key: 'interview', label: 'Interview', desc: 'Create & complete Rocket Lawyer document' },
  { key: 'send', label: 'Send', desc: 'Create binder & invite signers' },
  { key: 'sign', label: 'Sign', desc: 'Tenant reviews & signs' },
  { key: 'active', label: 'Active', desc: 'Lease fully executed' },
];

export function flowStepIndex(stepKey) {
  const map = {
    rl_pending: 0,
    needs_interview: 0,
    interview_in_progress: 0,
    ready_to_send: 1,
    awaiting_tenant_sign: 2,
    awaiting_signatures: 2,
    active: 3,
    expired: 3,
    terminated: 3,
  };
  return map[stepKey] ?? 0;
}

export const ENV_STATUS_STYLE = {
  awaiting_signature: 'bg-yellow-100 text-yellow-700',
  sent: 'bg-yellow-100 text-yellow-700',
  pending: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-600',
  voided: 'bg-gray-100 text-gray-500',
};

export function envelopeStatusLabel(status) {
  if (!status) return 'none';
  const labels = {
    sent: 'awaiting signature',
    pending: 'preparing',
    awaiting_signature: 'awaiting signature',
    completed: 'completed',
    declined: 'declined',
    voided: 'voided',
  };
  return labels[status] || status.replace(/_/g, ' ');
}
