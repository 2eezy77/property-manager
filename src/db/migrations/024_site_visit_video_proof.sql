-- 024_site_visit_video_proof.sql
-- Track video vs legacy photo media on inspection proof.

ALTER TABLE site_visit_photos
    ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) NOT NULL DEFAULT 'photo'
        CHECK (media_type IN ('photo', 'video'));

-- Every visit includes all three common areas going forward
UPDATE manager_site_visits
   SET scope_common = '["kitchen_living","parking","lawn_porch"]'::jsonb
 WHERE scope_common IS NULL
    OR scope_common = '[]'::jsonb
    OR jsonb_array_length(scope_common) < 3;
