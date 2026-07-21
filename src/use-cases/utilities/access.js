const pool = require('../../db/client');
const { useCaseError } = require('./errors');

async function accessiblePropertyIds(userId, role) {
  if (['super_admin', 'owner'].includes(role)) {
    const { rows } = await pool.query(
      `SELECT p.id
         FROM properties p
         JOIN users u ON u.org_id = p.org_id
        WHERE u.id = $1`,
      [userId]
    );
    return rows.map(r => r.id);
  }

  const { rows } = await pool.query(
    `SELECT property_id AS id FROM property_assignments WHERE user_id = $1`,
    [userId]
  );
  return rows.map(r => r.id);
}

async function loadAccessibleProperties(userId, role) {
  if (['super_admin', 'owner'].includes(role)) {
    const { rows } = await pool.query(
      `SELECT p.*
         FROM properties p
         JOIN users u ON u.org_id = p.org_id
        WHERE u.id = $1
        ORDER BY p.name ASC`,
      [userId]
    );
    return rows;
  }

  const { rows } = await pool.query(
    `SELECT p.*
       FROM properties p
       JOIN property_assignments pa ON pa.property_id = p.id
      WHERE pa.user_id = $1
      ORDER BY p.name ASC`,
    [userId]
  );
  return rows;
}

async function assertPropertyAccess(propertyId, userId, role) {
  const propIds = await accessiblePropertyIds(userId, role);
  if (!propIds.includes(propertyId)) {
    throw useCaseError('FORBIDDEN', 'Property not accessible.');
  }
  return propIds;
}

module.exports = {
  accessiblePropertyIds,
  loadAccessibleProperties,
  assertPropertyAccess,
};
