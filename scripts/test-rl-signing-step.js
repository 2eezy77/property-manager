#!/usr/bin/env node
/**
 * Unit checks for Rocket Lawyer lease signing pipeline step derivation.
 * Wrong steps can resend binders, skip tenant sign, or hide RL setup blocks.
 * Run: node scripts/test-rl-signing-step.js
 */
'use strict';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

(async () => {
  const {
    deriveSigningStep,
    resolveDocumentId,
    docIsReady,
    docIsInterviewing,
    rlErrorMessage,
    RL_ERROR_MESSAGES,
    flowStepIndex,
    envelopeStatusLabel,
  } = await import('../client/src/utils/rlLeaseHelpers.js');

  assert(resolveDocumentId({ rl_document_id: 'doc-1' }) === 'doc-1', 'prefers rl_document_id');
  assert(
    resolveDocumentId({ document_url: 'rl-doc-abc123' }) === 'abc123',
    'parses rl-doc- document_url'
  );
  assert(docIsReady('completed') === true, 'completed doc is ready');
  assert(docIsReady('draft') === false, 'draft doc is not ready');
  assert(docIsInterviewing('in_progress') === true, 'in_progress is interviewing');
  assert(docIsInterviewing('completed') === false, 'completed is not interviewing');

  assert(
    deriveSigningStep({ lease: null }) === 'unknown',
    'missing lease is unknown'
  );
  assert(
    deriveSigningStep({ lease: { status: 'active' } }) === 'active',
    'active lease short-circuits'
  );
  assert(
    deriveSigningStep({ lease: { status: 'draft' }, rlReady: false }) === 'rl_pending',
    'RL app not ready → rl_pending'
  );
  assert(
    deriveSigningStep({
      lease: { status: 'draft', document_url: null },
      docStatus: null,
      latestEnvelope: null,
    }) === 'needs_interview',
    'no document id → needs_interview'
  );
  assert(
    deriveSigningStep({
      lease: { status: 'draft', rl_document_id: 'd1' },
      docStatus: 'in_progress',
      latestEnvelope: null,
    }) === 'interview_in_progress',
    'in-progress interview without PDF stays interviewing'
  );
  assert(
    deriveSigningStep({
      lease: { status: 'draft', rl_document_id: 'd1', document_url: 'https://example/lease.pdf' },
      docStatus: 'completed',
      latestEnvelope: null,
    }) === 'ready_to_send',
    'ready doc without envelope → ready_to_send'
  );
  assert(
    deriveSigningStep({
      lease: { status: 'pending_tenant_signature', rl_document_id: 'd1' },
      docStatus: 'completed',
      latestEnvelope: {
        status: 'sent',
        signers: [{ signer_role: 'Tenant', status: 'pending' }],
      },
    }) === 'awaiting_tenant_sign',
    'sent envelope with unsigned tenant → awaiting_tenant_sign'
  );
  assert(
    deriveSigningStep({
      lease: { status: 'pending_manager_signature', rl_document_id: 'd1' },
      docStatus: 'completed',
      latestEnvelope: {
        status: 'sent',
        signers: [
          { signer_role: 'Tenant', status: 'signed' },
          { signer_role: 'Landlord', status: 'pending' },
        ],
      },
    }) === 'awaiting_tenant_sign',
    'sent envelope stays awaiting_tenant_sign even after tenant signed'
  );
  assert(
    deriveSigningStep({
      lease: { status: 'pending_manager_signature', rl_document_id: 'd1' },
      docStatus: 'completed',
      latestEnvelope: {
        status: 'in_progress',
        signers: [
          { signer_role: 'Tenant', status: 'signed' },
          { signer_role: 'Landlord', status: 'pending' },
        ],
      },
    }) === 'awaiting_signatures',
    'non-sent envelope after tenant signed → awaiting_signatures'
  );
  assert(
    deriveSigningStep({
      lease: { status: 'draft', rl_document_id: 'd1' },
      docStatus: 'completed',
      latestEnvelope: { status: 'completed', signers: [] },
    }) === 'active',
    'completed envelope → active'
  );
  assert(
    deriveSigningStep({
      lease: { status: 'draft', rl_document_id: 'd1', document_url: 'https://example/lease.pdf' },
      docStatus: 'completed',
      latestEnvelope: { status: 'voided', signers: [] },
    }) === 'ready_to_send',
    'voided envelope with ready doc can be resent'
  );

  assert(
    rlErrorMessage({ response: { data: { code: 'RL_TEMPLATE_MISSING' } } }) ===
      RL_ERROR_MESSAGES.RL_TEMPLATE_MISSING,
    'maps RL_TEMPLATE_MISSING'
  );
  assert(
    rlErrorMessage({
      response: { data: { error: 'Set RL_LEASE_TEMPLATE_ID before continuing' } },
    }) === RL_ERROR_MESSAGES.RL_TEMPLATE_MISSING,
    'detects missing template from error text'
  );
  assert(flowStepIndex('ready_to_send') === 1, 'ready_to_send is send step');
  assert(flowStepIndex('awaiting_tenant_sign') === 2, 'tenant sign is sign step');
  assert(envelopeStatusLabel('sent') === 'awaiting signature', 'sent envelope label');

  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll RL signing step checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
