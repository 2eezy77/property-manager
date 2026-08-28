/**
 * Pure triage helpers for the AI communication agent.
 * Keep decision gates in sync with processInboundMessage in ai-agent.service.js.
 */

'use strict';

/**
 * Strip optional markdown fences and parse model JSON.
 * Returns null when the payload is not valid JSON.
 */
function parseClassificationJson(rawText) {
  if (rawText == null) return null;
  const jsonText = String(rawText)
    .replace(/^```json?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

/** Mirror the auto-reply gate in processInboundMessage (step 4). */
function shouldPostAutoReply(cls) {
  if (!cls || typeof cls !== 'object') return false;
  return Boolean(cls.should_auto_respond && cls.auto_reply && cls.urgency !== 'emergency');
}

/** Mirror the escalation gate in processInboundMessage (step 5). */
function shouldEscalateClassification(cls) {
  if (!cls || typeof cls !== 'object') return false;
  return cls.triage_status === 'escalated' || cls.urgency === 'emergency';
}

/**
 * Mirror the maintenance auto-create gate in processInboundMessage (step 6).
 * Requires a unit to attach the request.
 */
function shouldCreateMaintenanceFromClassification(cls, unitId) {
  if (!cls || typeof cls !== 'object') return false;
  return Boolean(cls.create_maintenance_request && unitId);
}

/**
 * After an auto-reply, only flip triage to auto_responded when not already escalated.
 */
function shouldMarkAutoResponded(cls) {
  if (!shouldPostAutoReply(cls)) return false;
  return cls.triage_status !== 'escalated';
}

module.exports = {
  parseClassificationJson,
  shouldPostAutoReply,
  shouldEscalateClassification,
  shouldCreateMaintenanceFromClassification,
  shouldMarkAutoResponded,
};
