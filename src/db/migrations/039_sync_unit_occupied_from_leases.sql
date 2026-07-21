-- units.is_occupied was a manual flag and drifted from real leases
-- (e.g. Lily's Room 4 had an active lease but is_occupied=false → Properties showed 3/5).
-- Keep the column in sync with active leases for any UI that still reads it.
-- Occupancy counts in GET /api/properties now derive from leases directly.

UPDATE units u
SET is_occupied = EXISTS (
      SELECT 1 FROM leases l
       WHERE l.unit_id = u.id AND l.status = 'active'
    ),
    updated_at = NOW()
WHERE is_occupied IS DISTINCT FROM EXISTS (
      SELECT 1 FROM leases l
       WHERE l.unit_id = u.id AND l.status = 'active'
    );
