#!/usr/bin/env node
/**
 * AI agent triage: JSON parse + auto-reply / escalate / maintenance gates.
 * Run: node scripts/test-ai-agent-triage.js
 */
'use strict';

const {
  parseClassificationJson,
  shouldPostAutoReply,
  shouldEscalateClassification,
  shouldCreateMaintenanceFromClassification,
  shouldMarkAutoResponded,
} = require('../src/services/ai-agent-triage');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('ok:', msg);
  }
}

const clean = parseClassificationJson('{"category":"payment","urgency":"low","should_auto_respond":true,"auto_reply":"Thanks"}');
assert(clean && clean.category === 'payment', 'parses bare JSON');

const fenced = parseClassificationJson('```json\n{"urgency":"high","triage_status":"escalated"}\n```');
assert(fenced && fenced.urgency === 'high', 'strips markdown fences before parse');

assert(parseClassificationJson('not-json') === null, 'invalid JSON returns null');
assert(parseClassificationJson('') === null, 'empty string returns null');
assert(parseClassificationJson(null) === null, 'null returns null');
assert(parseClassificationJson('```json\n\n```') === null, 'empty fenced block returns null');

const autoOk = {
  should_auto_respond: true,
  auto_reply: 'We got your note.',
  urgency: 'medium',
  triage_status: 'triaged',
};
assert(shouldPostAutoReply(autoOk) === true, 'posts auto-reply when flag+body and not emergency');
assert(shouldMarkAutoResponded(autoOk) === true, 'marks auto_responded when not escalated');

assert(
  shouldPostAutoReply({ ...autoOk, urgency: 'emergency' }) === false,
  'never auto-replies on emergency urgency'
);
assert(
  shouldPostAutoReply({ ...autoOk, auto_reply: '' }) === false,
  'skips auto-reply without body'
);
assert(
  shouldPostAutoReply({ ...autoOk, should_auto_respond: false }) === false,
  'skips when should_auto_respond is false'
);

const escalatedAuto = { ...autoOk, triage_status: 'escalated' };
assert(shouldPostAutoReply(escalatedAuto) === true, 'can still post reply text when escalated');
assert(shouldMarkAutoResponded(escalatedAuto) === false, 'does not overwrite escalated triage with auto_responded');

assert(shouldEscalateClassification({ triage_status: 'escalated', urgency: 'low' }) === true, 'escalates on triage_status');
assert(shouldEscalateClassification({ triage_status: 'triaged', urgency: 'emergency' }) === true, 'escalates on emergency urgency');
assert(shouldEscalateClassification({ triage_status: 'triaged', urgency: 'high' }) === false, 'does not escalate routine high');
assert(shouldEscalateClassification(null) === false, 'null classification does not escalate');

assert(
  shouldCreateMaintenanceFromClassification({ create_maintenance_request: true }, 'unit-1') === true,
  'creates maintenance when flag set and unit present'
);
assert(
  shouldCreateMaintenanceFromClassification({ create_maintenance_request: true }, null) === false,
  'skips maintenance create without unit'
);
assert(
  shouldCreateMaintenanceFromClassification({ create_maintenance_request: false }, 'unit-1') === false,
  'skips when create flag is false'
);

if (failed) {
  console.error(`\ntest-ai-agent-triage: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\ntest-ai-agent-triage: OK');
