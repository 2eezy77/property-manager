/**
 * Pure helpers for Dominion portal MFA email/SMS-fallback OTP extraction.
 * Dominion does not support authenticator TOTP — codes arrive by email or SMS.
 */

'use strict';

const CODE_PATTERNS = [
  /\b(?:verification|security|authentication|one[-\s]?time|login)\s+code(?:\s+is)?[:\s]+(\d{6})\b/i,
  /\b(?:your\s+)?code(?:\s+is)?[:\s]+(\d{6})\b/i,
  /\b(\d{6})\b(?:\s+is\s+your\s+(?:verification|security|authentication)\s+code)/i,
  /enter\s+(?:this\s+)?(?:code|:)\s*(\d{6})\b/i,
];

function extractCode(text) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  for (const re of CODE_PATTERNS) {
    const m = flat.match(re);
    if (m?.[1]) return m[1];
  }
  // Last resort: lone 6-digit token in short MFA-looking bodies
  if (flat.length < 800) {
    const all = [...flat.matchAll(/\b(\d{6})\b/g)].map((m) => m[1]);
    if (all.length === 1) return all[0];
  }
  return null;
}

/** True when body/subject looks like MFA rather than a routine bill email. */
function looksLikeMfa(blob) {
  return /verif|security code|one[-\s]?time|authentication|sign[- ]?in|login code|passcode/i.test(
    String(blob || '')
  );
}

module.exports = {
  CODE_PATTERNS,
  extractCode,
  looksLikeMfa,
};
