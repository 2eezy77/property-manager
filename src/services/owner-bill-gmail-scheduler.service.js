/**
 * Periodic owner-bill Gmail checklist sync — same idea as Cash App / utilities
 * Gmail workers, with a Postgres advisory lock so only one Railway instance
 * runs the job at a time. Marks Owner Finance items paid/verified. Never charges.
 */
const pool = require('../db/client');
const { syncOwnerBillsFromGmail } = require('./owner-bill-gmail.service');

/** Stable int lock key for pg_try_advisory_lock (owner-bill-gmail-sync). */
const ADVISORY_LOCK_KEY = 742031519;

function syncEnabled() {
  return process.env.OWNER_BILL_GMAIL_SYNC_ENABLED !== 'false';
}

function intervalMs() {
  const minutes = Number(process.env.OWNER_BILL_GMAIL_SYNC_MINUTES ?? 30);
  const safe = Number.isFinite(minutes) && minutes >= 5 ? minutes : 30;
  return safe * 60 * 1000;
}

function newerThanDays() {
  const days = Number(process.env.OWNER_BILL_GMAIL_SYNC_NEWER_DAYS ?? 120);
  return Number.isFinite(days) && days >= 1 ? days : 120;
}

/** Prefer an active owner on an org that has Gmail connected. */
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

async function runOwnerBillGmailSync({ force = false } = {}) {
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
      return { skipped: true, reason: 'no_gmail' };
    }

    const result = await syncOwnerBillsFromGmail(actor.id, actor.role, {
      apply: true,
      newerThanDays: newerThanDays(),
      maxMessages: 200,
    });

    const applied = result.applied?.length || 0;
    const skipped = result.skipped?.length || 0;
    const errors = result.errors?.length || 0;
    console.log(
      `[owner-bill-gmail] org=${actor.org_id} gmail=${actor.gmail_address || '?'} ` +
        `scanned=${result.scanned} applied=${applied} skipped=${skipped} errors=${errors}`
    );

    return {
      skipped: false,
      orgId: actor.org_id,
      scanned: result.scanned,
      applied,
      skippedRows: skipped,
      errors,
    };
  } catch (err) {
    if (err.code === 'NOT_CONNECTED' || err.code === 'NOT_CONFIGURED') {
      console.warn(`[owner-bill-gmail] ${err.message}`);
      return { skipped: true, reason: err.code.toLowerCase() };
    }
    console.error('[owner-bill-gmail]', err.message);
    return { skipped: false, error: err.message };
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
      } catch (unlockErr) {
        console.warn('[owner-bill-gmail] unlock:', unlockErr.message);
      }
    }
    client.release();
  }
}

function scheduleOwnerBillGmailSync() {
  if (!syncEnabled()) {
    console.log('[owner-bill-gmail] disabled (OWNER_BILL_GMAIL_SYNC_ENABLED=false)');
    return;
  }

  const everyMs = intervalMs();
  const minutes = Math.round(everyMs / 60000);
  const startupDelayMs = Number(process.env.OWNER_BILL_GMAIL_SYNC_STARTUP_DELAY_MS ?? 75_000);

  const tick = () => {
    runOwnerBillGmailSync().catch((err) => {
      console.error('[owner-bill-gmail] tick failed:', err.message);
    });
  };

  setTimeout(() => {
    tick();
    setInterval(tick, everyMs);
  }, startupDelayMs);

  console.log(
    `[owner-bill-gmail] scheduled every ${minutes}m (first run in ${Math.round(startupDelayMs / 1000)}s)`
  );
}

module.exports = {
  scheduleOwnerBillGmailSync,
  runOwnerBillGmailSync,
  ADVISORY_LOCK_KEY,
};
