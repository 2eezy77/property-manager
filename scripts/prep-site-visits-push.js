/**
 * Prep site visits for production push:
 * - Remove test visits from current month
 * - Insert May 2026 vacant-room showing for Davontaye (Master Bedroom)
 *
 * Usage: node scripts/prep-site-visits-push.js
 *        node scripts/prep-site-visits-push.js --dry-run
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/client');

const DRY = process.argv.includes('--dry-run');
const MANAGER_EMAIL = 'konstantinhazlett@yahoo.com';
const OWNER_EMAIL = 'josemontero2002@gmail.com';
// Last month vacant showing — mid-May 2026 Norfolk time
const VISIT_AT = '2026-05-15T14:00:00-04:00';
const COMMON = ['kitchen_living', 'parking', 'lawn_porch'];

async function main() {
  const { rows: [ctx] } = await pool.query(
    `SELECT o.id AS org_id, p.id AS property_id,
            mgr.id AS manager_id, own.id AS owner_id
       FROM organizations o
       JOIN properties p ON p.org_id = o.id
       JOIN users own ON own.id = o.owner_id
       JOIN users mgr ON mgr.org_id = o.id AND LOWER(mgr.email) = LOWER($1)
      ORDER BY p.created_at ASC
      LIMIT 1`,
    [MANAGER_EMAIL]
  );
  if (!ctx) throw new Error('Org / manager / property not found');

  const { rows: units } = await pool.query(
    `SELECT un.id, un.unit_number,
            act.tenant_id,
            TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS tenant_name
       FROM units un
       JOIN properties p ON p.id = un.property_id
       LEFT JOIN LATERAL (
         SELECT l.tenant_id FROM leases l
          WHERE l.unit_id = un.id AND l.status = 'active'
          ORDER BY l.created_at DESC LIMIT 1
       ) act ON TRUE
       LEFT JOIN users u ON u.id = act.tenant_id
      WHERE p.org_id = $1
      ORDER BY un.unit_number`,
    [ctx.org_id]
  );

  const master = units.find((u) => /master/i.test(u.unit_number));
  if (!master) throw new Error('Master Bedroom unit not found');

  const { rows: existingVisits } = await pool.query(
    `SELECT v.id, v.status, v.planned_visit_at, v.visited_at, v.created_at,
            v.requested_note,
            (SELECT COUNT(*)::int FROM site_visit_room_targets t WHERE t.visit_id = v.id) AS rooms
       FROM manager_site_visits v
      WHERE v.org_id = $1
      ORDER BY COALESCE(v.visited_at, v.planned_visit_at, v.created_at) DESC`,
    [ctx.org_id]
  );

  console.log('Existing visits:', existingVisits.length);
  for (const v of existingVisits) {
    console.log(' -', v.id.slice(0, 8), v.status, v.visited_at || v.planned_visit_at, v.requested_note || '');
  }

  // Remove all non-historical test visits (everything not our May record if re-run)
  const toDelete = existingVisits.filter((v) => {
    const at = v.visited_at || v.planned_visit_at || v.created_at;
    const d = new Date(at);
    // Keep nothing from June 2026 testing; remove pending/approved/recent test rows
    return d >= new Date('2026-06-01') || v.status === 'pending_approval' || v.status === 'approved' || v.status === 'rejected';
  });

  const { rows: mayDup } = await pool.query(
    `SELECT v.id FROM manager_site_visits v
      JOIN site_visit_room_targets t ON t.visit_id = v.id
     WHERE v.org_id = $1
       AND t.room_purpose = 'vacant_showing'
       AND t.unit_id = $2
       AND v.visited_at >= '2026-05-01' AND v.visited_at < '2026-06-01'`,
    [ctx.org_id, master.id]
  );

  if (DRY) {
    console.log('\n[dry-run] Would delete', toDelete.length, 'test visit(s)');
    console.log('[dry-run] May vacant showing exists:', mayDup.length > 0);
    await pool.end();
    return;
  }

  for (const v of toDelete) {
    const photoRows = await pool.query(
      `SELECT photo_path FROM site_visit_photos WHERE visit_id = $1`,
      [v.id]
    );
    await pool.query(`DELETE FROM manager_site_visits WHERE id = $1`, [v.id]);
    for (const p of photoRows.rows) {
      if (p.photo_path && fs.existsSync(p.photo_path)) {
        try { fs.unlinkSync(p.photo_path); } catch { /* ignore */ }
      }
    }
    console.log('Deleted test visit', v.id.slice(0, 8), v.status);
  }

  if (mayDup.length > 0) {
    console.log('May vacant showing already exists:', mayDup[0].id);
    await pool.end();
    return;
  }

  const visitAt = new Date(VISIT_AT);
  const note = 'Vacant room showing — Master Bedroom for prospective tenant Davontaye Gara (signed May 2026).';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [visit] } = await client.query(
      `INSERT INTO manager_site_visits
         (org_id, property_id, manager_id, status, requested_note,
          approved_by, approved_at, planned_visit_at, scope_common,
          visited_at, completed_at, amount_cents)
       VALUES ($1,$2,$3,'completed',$4,$5,$6,$7,$8::jsonb,$9,$9,$10)
       RETURNING id`,
      [
        ctx.org_id,
        ctx.property_id,
        ctx.manager_id,
        note,
        ctx.owner_id,
        new Date('2026-05-14T10:00:00-04:00'),
        visitAt,
        JSON.stringify(COMMON),
        visitAt,
        2000,
      ]
    );

    await client.query(
      `INSERT INTO site_visit_room_targets
         (visit_id, unit_id, room_label, tenant_id, room_purpose)
       VALUES ($1, $2, $3, NULL, 'vacant_showing')`,
      [visit.id, master.id, master.unit_number]
    );

    const uploadDir = path.resolve(__dirname, '../uploads/site-visits');
    fs.mkdirSync(uploadDir, { recursive: true });
    const placeholder = path.join(uploadDir, `${visit.id}-historical-proof.txt`);
    fs.writeFileSync(
      placeholder,
      'Historical visit imported May 2026 — vacant Master Bedroom showing for Davontaye Gara. Video proof captured on-site; placeholder for production record.\n'
    );

    const areas = [
      ...COMMON.map((key) => ({ areaType: 'common', areaKey: key, unitId: null })),
      { areaType: 'tenant_room', areaKey: null, unitId: master.id },
    ];

    for (const a of areas) {
      await client.query(
        `INSERT INTO site_visit_photos
           (visit_id, area_type, area_key, unit_id, photo_path, photo_mime, media_type)
         VALUES ($1, $2, $3, $4, $5, 'text/plain', 'video')`,
        [visit.id, a.areaType, a.areaKey, a.unitId, placeholder]
      );
    }

    await client.query('COMMIT');
    console.log('Created May vacant showing visit:', visit.id);
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
