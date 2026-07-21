const pool = require('../db/client');

async function accessiblePropertyIds(userId, userRole) {
  if (['super_admin', 'owner'].includes(userRole)) {
    const { rows } = await pool.query(
      `SELECT p.id FROM properties p
       JOIN users u ON u.org_id = p.org_id WHERE u.id = $1`,
      [userId]
    );
    return rows.map((r) => r.id);
  }
  const { rows } = await pool.query(
    `SELECT property_id AS id FROM property_assignments WHERE user_id = $1`,
    [userId]
  );
  return rows.map((r) => r.id);
}

async function maintenanceRequestAccessible(requestId, userId, userRole) {
  if (userRole === 'tenant') {
    const { rows } = await pool.query(
      `SELECT 1 FROM maintenance_requests WHERE id = $1 AND tenant_id = $2`,
      [requestId, userId]
    );
    return rows.length > 0;
  }
  const propIds = await accessiblePropertyIds(userId, userRole);
  if (!propIds.length) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM maintenance_requests mr
      JOIN units un ON un.id = mr.unit_id
     WHERE mr.id = $1 AND un.property_id = ANY($2)`,
    [requestId, propIds]
  );
  return rows.length > 0;
}

module.exports = { accessiblePropertyIds, maintenanceRequestAccessible };
