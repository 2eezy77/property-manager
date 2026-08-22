#!/usr/bin/env node
/**
 * Unit checks for Rocket Lawyer binder/interview status mapping + completion events.
 * Run: node scripts/test-rocketlawyer-status-policy.js
 *
 * Requires dummy DATABASE_URL / ENCRYPTION_KEY / STRIPE_SECRET_KEY on require
 * (Pool + Stripe clients are lazy; no network calls).
 */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/property_manager_test';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  || Buffer.alloc(32, 7).toString('base64');
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_rocketlawyer_status';

const {
  mapBinderStatus,
  mapInterviewStatus,
  normalizeRlEvent,
  isBinderCompletedEvent,
} = require('../src/services/rocketlawyer.service');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

check(mapBinderStatus('COMPLETED') === 'completed', 'COMPLETED → completed');
check(mapBinderStatus('SIGNED') === 'completed', 'SIGNED → completed');
check(mapBinderStatus('SIGNING_COMPLETE') === 'completed', 'SIGNING_COMPLETE → completed');
check(mapBinderStatus('SIGN_COMPLETED') === 'completed', 'SIGN_COMPLETED → completed');
check(mapBinderStatus('OUT_FOR_SIGNATURE') === 'sent', 'OUT_FOR_SIGNATURE → sent');
check(mapBinderStatus('SIGN_IN_PROGRESS') === 'sent', 'SIGN_IN_PROGRESS → sent');
check(mapBinderStatus('REVIEW_AND_SHARE') === 'sent', 'REVIEW_AND_SHARE → sent');
check(mapBinderStatus('VOIDED') === 'voided', 'VOIDED → voided');
check(mapBinderStatus('CANCELLED') === 'voided', 'CANCELLED → voided');
check(mapBinderStatus('BINDER_CANCELED') === 'voided', 'BINDER_CANCELED → voided');
check(mapBinderStatus('DECLINED') === 'declined', 'DECLINED → declined');
check(mapBinderStatus('SIGNER_DECLINED_TO_SIGN') === 'declined', 'SIGNER_DECLINED_TO_SIGN → declined');
check(mapBinderStatus('IN_PREPARATION') === 'pending', 'IN_PREPARATION → pending');
check(mapBinderStatus('DRAFT') === 'pending', 'DRAFT → pending');
check(mapBinderStatus('totally-unknown') === 'pending', 'unknown binder status defaults to pending');
check(mapBinderStatus(null) === 'pending', 'null binder status defaults to pending');
check(mapBinderStatus('completed') === 'completed', 'binder status matching is case-insensitive');

check(mapInterviewStatus('completed') === 'completed', 'interview completed');
check(mapInterviewStatus('CREATED') === 'draft', 'interview CREATED → draft');
check(mapInterviewStatus('draft') === 'draft', 'interview draft');
check(mapInterviewStatus('weird') === 'weird', 'unknown interview status passthrough');
check(mapInterviewStatus(null) === 'unknown', 'null interview status → unknown');

check(isBinderCompletedEvent('BINDER_SIGN_COMPLETED') === true, 'BINDER_SIGN_COMPLETED completes');
check(isBinderCompletedEvent('SIGN_COMPLETED') === true, 'SIGN_COMPLETED completes');
check(isBinderCompletedEvent('BINDER.SIGN.COMPLETED') === true, 'dotted BINDER.SIGN.COMPLETED completes');
check(isBinderCompletedEvent('SomethingSignCompletedHere') === true,
  'name containing sign+complet completes');
check(isBinderCompletedEvent('STATUS_UPDATE', { status: 'SIGN_COMPLETED' }) === true,
  'payload status SIGN_COMPLETED completes');
check(isBinderCompletedEvent('STATUS_UPDATE', { binderStatus: 'SIGN_COMPLETED' }) === true,
  'payload binderStatus SIGN_COMPLETED completes');
check(isBinderCompletedEvent('BINDER_CREATED') === false, 'BINDER_CREATED does not complete');
check(isBinderCompletedEvent('STATUS_UPDATE', { status: 'OUT_FOR_SIGNATURE' }) === false,
  'out-for-signature payload does not complete');

{
  const shaped = normalizeRlEvent({
    eventHandle: 'h1',
    name: 'BINDER_SIGN_COMPLETED',
    coreProperties: { eventUniqueId: 'uid-1' },
    payload: { binderId: 'b-9', status: 'SIGN_COMPLETED', extra: true },
  });
  check(shaped.event === 'BINDER_SIGN_COMPLETED', 'normalize uses event name');
  check(shaped.eventUniqueId === 'uid-1', 'normalize keeps eventUniqueId');
  check(shaped.binderId === 'b-9', 'normalize lifts binderId');
  check(shaped.status === 'SIGN_COMPLETED', 'normalize lifts status');
  check(shaped.extra === true, 'normalize spreads payload fields');
}

{
  const nested = normalizeRlEvent({
    eventHandle: 'h2',
    name: 'STATUS_UPDATE',
    payload: { binder: { id: 'b-nested' }, binderStatus: 'OUT_FOR_SIGNATURE' },
  });
  check(nested.binderId === 'b-nested', 'normalize falls back to binder.id');
  check(nested.status === 'OUT_FOR_SIGNATURE', 'normalize falls back to binderStatus');
}

{
  const passthrough = { already: 'flat', binderId: 'x' };
  check(normalizeRlEvent(passthrough) === passthrough, 'normalize leaves flat events unchanged');
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll Rocket Lawyer status policy checks passed.');
