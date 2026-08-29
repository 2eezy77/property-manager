/**
 * Periodic Cash App Gmail import — same idea as rent billing, with a Postgres
 * advisory lock so only one Railway instance runs the job at a time.
 */
const pool = require('../db/client');
const { syncCashAppFromGmail } = require('./cashapp-gmail.service');
const {
  syncEnabled,
  intervalMs,
  newerThanDays,
} = require('./cashapp-gmail-scheduler-policy');

/** Stable int lock key for pg_try_advisory_lock (cashapp-gmail-sync). */
const ADVISORY_LOCK_KEY = 742031517;

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

async function runCashAppGmailSync({ force = false } = {}) {
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

    const result = await syncCashAppFromGmail(actor.id, actor.role, {
      apply: true,
      newerThanDays: newerThanDays(),
      maxMessages: 150,
    });

    const inserted = result.inserted || 0;
    const depositApplied = result.depositApplied || 0;
    const synced = result.synced || 0;
    if (inserted || depositApplied || synced) {
      console.log(
        `[cashapp-gmail-sync] org=${actor.org_id} gmail=${actor.gmail_address || '?'} ` +
          `emails=${result.paymentCount} inserted=${inserted} deposits=${depositApplied} synced=${synced}`
      );
    } else {
      console.log(
        `[cashapp-gmail-sync] org=${actor.org_id} scanned ${result.paymentCount} email(s), nothing new`
      );
    }

    return {
      skipped: false,
      orgId: actor.org_id,
      paymentEmails: result.paymentCount,
      inserted,
      depositApplied,
      synced,
      skippedRows: result.skipped,
    };
  } catch (err) {
    if (err.code === 'NOT_CONNECTED' || err.code === 'NOT_CONFIGURED') {
      console.warn(`[cashapp-gmail-sync] ${err.message}`);
      return { skipped: true, reason: err.code.toLowerCase() };
    }
    console.error('[cashapp-gmail-sync]', err.message);
    return { skipped: false, error: err.message };
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
      } catch (unlockErr) {
        console.warn('[cashapp-gmail-sync] unlock:', unlockErr.message);
      }
    }
    client.release();
  }
}

function scheduleCashAppGmailSync() {
  if (!syncEnabled()) {
    console.log('[cashapp-gmail-sync] disabled (CASHAPP_GMAIL_SYNC_ENABLED=false)');
    return;
  }

  const everyMs = intervalMs();
  const minutes = Math.round(everyMs / 60000);

  // First run shortly after boot so deploys pick up recent cashtag payments.
  const startupDelayMs = Number(process.env.CASHAPP_GMAIL_SYNC_STARTUP_DELAY_MS ?? 45_000);

  const tick = () => {
    runCashAppGmailSync().catch((err) => {
      console.error('[cashapp-gmail-sync] tick failed:', err.message);
    });
  };

  setTimeout(() => {
    tick();
    setInterval(tick, everyMs);
  }, startupDelayMs);

  console.log(
    `[cashapp-gmail-sync] scheduled every ${minutes}m (first run in ${Math.round(startupDelayMs / 1000)}s)`
  );
}

module.exports = {
  scheduleCashAppGmailSync,
  runCashAppGmailSync,
  ADVISORY_LOCK_KEY,
  syncEnabled,
  intervalMs,
  newerThanDays,
};
