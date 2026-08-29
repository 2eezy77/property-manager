/**
 * Pure env gates for Cash App Gmail sync scheduler.
 * Opt-in only — retired off-app import stays off unless explicitly enabled.
 */

function syncEnabled(env = process.env) {
  return env.CASHAPP_GMAIL_SYNC_ENABLED === 'true';
}

function intervalMs(env = process.env) {
  const minutes = Number(env.CASHAPP_GMAIL_SYNC_MINUTES ?? 15);
  const safe = Number.isFinite(minutes) && minutes >= 5 ? minutes : 15;
  return safe * 60 * 1000;
}

function newerThanDays(env = process.env) {
  const days = Number(env.CASHAPP_GMAIL_SYNC_NEWER_DAYS ?? 30);
  return Number.isFinite(days) && days >= 1 ? days : 30;
}

module.exports = { syncEnabled, intervalMs, newerThanDays };
