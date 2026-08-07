/**
 * One-shot ledger cleanup for Buckley Stone + Isaiah Reese.
 *
 * - Stone July: consolidate two $450 installments into one $900 (month complete)
 * - Clear partial_rent on succeeded rent rows when the billing month is fully paid
 * - Keep August as $450 each (Stone off-site Cash App; Isaiah on-site card)
 * - Hide/keep Isaiah's withdrawn off-site August Cash App as failed
 *
 * Dry-run: node scripts/fix-stone-isaiah-rent-ledger.js
 * Apply:   APPLY=1 node scripts/fix-stone-isaiah-rent-ledger.js
 */
const pool = require('../src/db/client');

const STONE_LEASE = 'ffffffff-0000-0000-0000-000000000001';
const ISAIAH_LEASE = 'ffffffff-0000-0000-0000-000000000002';
const STONE_JULY_PRIMARY = 'bbe1669e-9a5b-4e24-b4a1-1ef24a7eb827';
const STONE_JULY_KLOC = '108d23b5-d620-4aec-ac85-c7de1fd8d0e4';
const STONE_AUG = '37a7ffd5-576d-4b1d-bfcb-79be08034b90';
const ISAIAH_AUG_CARD = 'aa7b9b1c-7f53-4c0a-bc74-53107a58e004';

const APPLY = process.env.APPLY === '1';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Stone July: merge Kloc $450 into primary → $900 complete ─────────────
    const { rows: julyRows } = await client.query(
      `SELECT id, amount, status, metadata FROM payments WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      [[STONE_JULY_PRIMARY, STONE_JULY_KLOC]]
    );
    const primary = julyRows.find((r) => r.id === STONE_JULY_PRIMARY);
    const kloc = julyRows.find((r) => r.id === STONE_JULY_KLOC);
    if (!primary || !kloc) {
      throw new Error('Stone July payments missing — abort');
    }

    // Already consolidated?
    if (Number(primary.amount) >= 899.99 && kloc.status === 'failed') {
      console.log('Stone July already consolidated — skipping merge');
    } else {
      const pMeta = { ...(primary.metadata || {}) };
      const kMeta = { ...(kloc.metadata || {}) };
      const parts = [
        ...(Array.isArray(pMeta.cash_app_parts) ? pMeta.cash_app_parts : []),
        ...(Array.isArray(kMeta.cash_app_parts) ? kMeta.cash_app_parts : []),
      ];
      const refs = [pMeta.external_reference, kMeta.external_reference].filter(Boolean).join(', ');

      Object.assign(pMeta, {
        amount: 900,
        partial_rent: false,
        notes:
          'July rent paid in full: Stone Cash App $450 (Jul 8) + John Kloc $450 for Stone (Jul 19).',
        cash_app_parts: parts,
        external_reference: refs,
        payment_method: 'cash_app',
        july_complete: true,
        paid_by_third_party: 'John Kloc (second half)',
        consolidated_from: STONE_JULY_KLOC,
        consolidated_at: new Date().toISOString(),
      });

      console.log('Stone July primary → $900 complete', STONE_JULY_PRIMARY);
      console.log('Stone July Kloc → superseded/failed', STONE_JULY_KLOC);

      if (APPLY) {
        await client.query(
          `UPDATE payments
              SET amount = 900,
                  paid_at = '2026-07-19T12:00:00Z',
                  metadata = $2::jsonb,
                  updated_at = NOW()
            WHERE id = $1`,
          [STONE_JULY_PRIMARY, JSON.stringify(pMeta)]
        );
        await client.query(
          `UPDATE payments
              SET status = 'failed',
                  failure_reason = 'Merged into July full rent payment bbe1669e (Stone + John Kloc)',
                  metadata = metadata || $2::jsonb,
                  updated_at = NOW()
            WHERE id = $1`,
          [
            STONE_JULY_KLOC,
            JSON.stringify({
              superseded_by: STONE_JULY_PRIMARY,
              merged_into_full_july: true,
              rejected_at: new Date().toISOString(),
              rejected_reason: 'consolidated_into_full_month_payment',
            }),
          ]
        );
      }
    }

    // ── August notes / flags (keep $450 each) ───────────────────────────────
    console.log('Stone August stays $450 off-site Cash App', STONE_AUG);
    console.log('Isaiah August stays $450 on-site card', ISAIAH_AUG_CARD);
    if (APPLY) {
      await client.query(
        `UPDATE payments
            SET metadata = metadata || $2::jsonb,
                updated_at = NOW()
          WHERE id = $1`,
        [
          STONE_AUG,
          JSON.stringify({
            partial_rent: true,
            notes:
              'August rent first half $450 via off-site Cash App (Jul 29). $450 still owed. Flexible pay — no late fees.',
            august_offsite_half: true,
            ledger_clarified_at: new Date().toISOString(),
          }),
        ]
      );
      await client.query(
        `UPDATE payments
            SET metadata = metadata || $2::jsonb,
                updated_at = NOW()
          WHERE id = $1`,
        [
          ISAIAH_AUG_CARD,
          JSON.stringify({
            partial_rent: true,
            source: 'stripe_card',
            payment_method: 'card',
            notes:
              'August rent first half $450 via on-site Stripe card (Aug 3). Off-site Cash App refunded/withdrawn — $450 still owed.',
            august_onsite_card_half: true,
            ledger_clarified_at: new Date().toISOString(),
          }),
        ]
      );
    }

    // ── Clear partial_rent when month total >= rent ─────────────────────────
    const { rows: clearRows } = await client.query(
      `WITH month_paid AS (
         SELECT p.lease_id,
                date_trunc('month', p.period_start)::date AS month_start,
                l.monthly_rent::numeric AS rent,
                SUM(CASE WHEN p.status = 'succeeded' THEN (p.amount)::numeric ELSE 0 END) AS paid
           FROM payments p
           JOIN leases l ON l.id = p.lease_id
          WHERE p.lease_id = ANY($1::uuid[])
            AND p.payment_type = 'rent'
            AND p.period_start IS NOT NULL
          GROUP BY 1, 2, 3
       )
       SELECT p.id, p.lease_id, p.period_start::text, p.amount, p.metadata->>'partial_rent' AS partial_rent
         FROM payments p
         JOIN month_paid m
           ON m.lease_id = p.lease_id
          AND date_trunc('month', p.period_start)::date = m.month_start
        WHERE p.payment_type = 'rent'
          AND p.status = 'succeeded'
          AND m.paid >= m.rent - 0.01
          AND COALESCE(p.metadata->>'partial_rent', 'false') IN ('true', 't')
          AND NOT (p.id = ANY($2::uuid[]))`,
      [
        [STONE_LEASE, ISAIAH_LEASE],
        [STONE_AUG, ISAIAH_AUG_CARD],
      ]
    );
    console.log(
      'Clear partial_rent on completed-month rows:',
      clearRows.length,
      clearRows.map((r) => r.id.slice(0, 8))
    );
    if (APPLY && clearRows.length) {
      await client.query(
        `UPDATE payments
            SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{partial_rent}', 'false'::jsonb, true)
              || jsonb_build_object('month_complete_cleared_at', $2::text),
                updated_at = NOW()
          WHERE id = ANY($1::uuid[])`,
        [clearRows.map((r) => r.id), new Date().toISOString()]
      );
    }

    // Verify month totals (in-transaction view when APPLY)
    const { rows: totals } = await client.query(
      `SELECT CASE WHEN lease_id = $1 THEN 'Stone' ELSE 'Isaiah' END AS who,
              to_char(period_start, 'YYYY-MM') AS ym,
              SUM(CASE WHEN status = 'succeeded' THEN amount::numeric ELSE 0 END) AS paid
         FROM payments
        WHERE lease_id = ANY($2::uuid[])
          AND payment_type = 'rent'
          AND period_start >= '2026-06-01'
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [STONE_LEASE, [STONE_LEASE, ISAIAH_LEASE]]
    );
    console.log('Month totals after plan:', totals);

    if (APPLY) {
      await client.query('COMMIT');
      console.log('APPLY=1 committed');
    } else {
      await client.query('ROLLBACK');
      console.log('Dry-run only (ROLLBACK). Re-run with APPLY=1 to commit.');
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
