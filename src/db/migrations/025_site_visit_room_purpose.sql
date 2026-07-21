-- 025_site_visit_room_purpose.sql
-- Per-room visit purpose: routine inspection, maintenance follow-up, vacant showing.

ALTER TABLE site_visit_room_targets
    ADD COLUMN IF NOT EXISTS room_purpose VARCHAR(40) NOT NULL DEFAULT 'routine_inspection'
        CHECK (room_purpose IN ('routine_inspection', 'maintenance_followup', 'vacant_showing'));

ALTER TABLE site_visit_tenant_notices
    ADD COLUMN IF NOT EXISTS notice_type VARCHAR(40) NOT NULL DEFAULT 'room_inspection'
        CHECK (notice_type IN (
            'room_inspection',
            'maintenance_followup',
            'vacant_showing',
            'room_inspection_completed',
            'maintenance_followup_completed',
            'vacant_showing_completed'
        ));

UPDATE site_visit_room_targets
   SET room_purpose = 'vacant_showing'
 WHERE tenant_id IS NULL
   AND room_purpose = 'routine_inspection';
