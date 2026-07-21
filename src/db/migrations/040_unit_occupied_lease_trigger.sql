-- Keep units.is_occupied in sync whenever lease status changes.
-- Occupancy API counts already use active leases; this prevents the flag from drifting again.

CREATE OR REPLACE FUNCTION sync_unit_occupied_from_leases()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_unit_id UUID;
BEGIN
  target_unit_id := COALESCE(NEW.unit_id, OLD.unit_id);
  IF target_unit_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE units u
     SET is_occupied = EXISTS (
           SELECT 1 FROM leases l
            WHERE l.unit_id = target_unit_id AND l.status = 'active'
         ),
         updated_at = NOW()
   WHERE u.id = target_unit_id
     AND u.is_occupied IS DISTINCT FROM EXISTS (
           SELECT 1 FROM leases l
            WHERE l.unit_id = target_unit_id AND l.status = 'active'
         );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_leases_sync_unit_occupied ON leases;
CREATE TRIGGER trg_leases_sync_unit_occupied
AFTER INSERT OR UPDATE OF status, unit_id OR DELETE ON leases
FOR EACH ROW
EXECUTE FUNCTION sync_unit_occupied_from_leases();
