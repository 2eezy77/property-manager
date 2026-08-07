/**
 * Periodic utilities pipeline: Gmail import → combine/recalc → notify → remind.
 * Never ACH tenants. Advisory-locked for multi-instance Railway.
 */
const pool = require('../db/client');

/** Stable int lock key for pg_try_advisory_lock (utilities-sync). */
const ADVISORY_LOCK_KEY = 742031518;

function syncEnabled() {
  return process.env.UTILITIES_SYNC_ENABLED !== 'false';
}

function intervalMs() {
  const minutes = Number(process.env.UTILITIES_SYNC_MINUTES ?? 20);
  const safe = Number.isFinite(minutes) && minutes >= 5 ? minutes : 20;
  return safe * 60 * 1000;
}

async function resolveGmailActor() {
  const { rows } = await pool.query(
    `SELECT u.id, u.role, t.org_id, t.gmail_address
       FROM gmail_oauth_tokens t
       JOIN users u ON u.org_id = t.org_id
        AND u.is_active = TRUE
        AND u.role IN ('owner', 'property_manager')
      WHERE t.refresh_token_encrypted IS NOT NULL
      ORDER BY CASE u.role WHEN 'owner' THEN 0 ELSE 1 END, u.created_at ASC
      LIMIT 1`
  );
  return rows[0] || null;
}

async function runUtilitiesSync({ force = false } = {}) {
  if (!force && !syncEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }

  const client = await pool.connect();
  let locked = false;
  try {
    const { rows: lockRows } = await client.query(
      'SELECT pg_try_advisory_lock($1) AS ok',
      [ADVISORY_LOCK_KEY]
    );
    if (!lockRows[0]?.ok) {
      return { skipped: true, reason: 'lock_held' };
    }
    locked = true;

    const actor = await resolveGmailActor();
    if (!actor) {
      // Still run reminders if Gmail missing (existing notified bills)
      const {
        sendUtilityReminders,
      } = require('./utility-comms.service');
      const reminders = await sendUtilityReminders();
      return { skipped: false, reason: 'no_gmail', import: null, reminders };
    }

    const uc = require('../use-cases/utilities');
    const {
      autoNotifyEligibleDrafts,
      sendUtilityReminders,
    } = require('./utility-comms.service');

    let imported = null;
    try {
      imported = await uc.executeImportFromGmail({
        userId: actor.id,
        role: actor.role,
        maxMessages: 25,
      });
    } catch (err) {
      if (err.code === 'NOT_CONNECTED' || err.code === 'NOT_CONFIGURED') {
        console.warn(`[utilities-sync] gmail: ${err.message}`);
      } else {
        console.warn('[utilities-sync] import:', err.message);
      }
    }

    let combined = null;
    let recalc = null;
    try {
      combined = await uc.executeCombineMonthlyDrafts({
        userId: actor.id,
        role: actor.role,
      });
    } catch (err) {
      console.warn('[utilities-sync] combine:', err.message);
    }

    try {
      recalc = await uc.executeRecalculateSplits({
        userId: actor.id,
        role: actor.role,
      });
    } catch (err) {
      console.warn('[utilities-sync] recalc:', err.message);
    }

    const notify = await autoNotifyEligibleDrafts({
      userId: actor.id,
      role: actor.role,
    });

    // Reminders only for already-notified bills; skip entirely while auto-notify is off
    // so we don't ping tenants after an accidental notify + rollback.
    const reminders = notify.disabled
      ? { reminded3: 0, reminded7: 0, overdueStaff: 0, disabled: true }
      : await sendUtilityReminders();

    console.log(
      `[utilities-sync] org=${actor.org_id} ` +
        `import=${imported?.created ?? imported?.imported ?? 0} ` +
        `notify=${notify.disabled ? 'DISABLED' : notify.notified} ` +
        `remind3=${reminders.reminded3} remind7=${reminders.reminded7}`
    );

    return {
      skipped: false,
      orgId: actor.org_id,
      import: imported,
      combined,
      recalc,
      notify,
      reminders,
    };
  } catch (err) {
    console.error('[utilities-sync]', err.message);
    return { skipped: false, error: err.message };
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
      } catch (unlockErr) {
        console.warn('[utilities-sync] unlock:', unlockErr.message);
      }
    }
    client.release();
  }
}

function scheduleUtilitiesSync() {
  if (!syncEnabled()) {
    console.log('[utilities-sync] disabled (UTILITIES_SYNC_ENABLED=false)');
    return;
  }

  const everyMs = intervalMs();
  const minutes = Math.round(everyMs / 60000);
  const startupDelayMs = Number(process.env.UTILITIES_SYNC_STARTUP_DELAY_MS ?? 60_000);

  const tick = () => {
    runUtilitiesSync().catch((err) => {
      console.error('[utilities-sync] tick failed:', err.message);
    });
  };

  setTimeout(() => {
    tick();
    setInterval(tick, everyMs);
  }, startupDelayMs);

  console.log(
    `[utilities-sync] scheduled every ${minutes}m (first run in ${Math.round(startupDelayMs / 1000)}s)`
  );
}

module.exports = {
  scheduleUtilitiesSync,
  runUtilitiesSync,
  ADVISORY_LOCK_KEY,
};
