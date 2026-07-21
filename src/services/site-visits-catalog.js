/**
 * Inspection area catalog — 743 A Ave common zones + rentable rooms from units.
 */

const pool = require('../db/client');

const COMMON_AREAS = [
  { key: 'kitchen_living', label: 'Kitchen / living area' },
  { key: 'parking', label: 'Parking lot' },
  { key: 'lawn_porch', label: 'Front lawn / porch' },
];

const VALID_COMMON_KEYS = new Set(COMMON_AREAS.map((a) => a.key));

async function loadInspectionAreas(orgId, propertyId) {
  const { rows: rooms } = await pool.query(
    `SELECT un.id AS unit_id,
            un.unit_number AS room_label,
            u.id AS tenant_id,
            TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS tenant_name,
            u.email AS tenant_email
       FROM units un
       JOIN properties p ON p.id = un.property_id
       LEFT JOIN LATERAL (
         SELECT l.tenant_id
           FROM leases l
          WHERE l.unit_id = un.id AND l.status = 'active'
          ORDER BY l.created_at DESC
          LIMIT 1
       ) act ON TRUE
       LEFT JOIN users u ON u.id = act.tenant_id AND u.is_active = TRUE
      WHERE p.org_id = $1
        AND ($2::uuid IS NULL OR p.id = $2)
      ORDER BY un.unit_number ASC`,
    [orgId, propertyId]
  );

  return {
    common: COMMON_AREAS,
    rooms: rooms.map((r) => ({
      unitId: r.unit_id,
      label: r.room_label,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name?.trim() || null,
      tenantEmail: r.tenant_email,
      occupied: !!r.tenant_id,
    })),
  };
}

/** All three common areas are required on every visit. */
function mandatoryCommonAreas() {
  return COMMON_AREAS.map((a) => a.key);
}

function normalizeCommonAreas(_keys) {
  return mandatoryCommonAreas();
}

module.exports = {
  COMMON_AREAS,
  VALID_COMMON_KEYS,
  loadInspectionAreas,
  normalizeCommonAreas,
  mandatoryCommonAreas,
};
