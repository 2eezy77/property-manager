-- Share one Gmail connection per organization (admin / Isaac / Konstantin).

ALTER TABLE gmail_oauth_tokens
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE gmail_oauth_tokens g
   SET org_id = u.org_id
  FROM users u
 WHERE u.id = g.user_id
   AND g.org_id IS NULL
   AND u.org_id IS NOT NULL;

UPDATE gmail_oauth_tokens g
   SET org_id = (
     SELECT p.org_id FROM properties p
      WHERE p.address_line1 ILIKE '%743%' OR p.name ILIKE '%743%'
      LIMIT 1
   )
 WHERE g.org_id IS NULL;

-- Tie platform admin to the 743 A Ave org so they share the same Gmail + properties.
UPDATE users u
   SET org_id = (
     SELECT p.org_id FROM properties p
      WHERE p.address_line1 ILIKE '%743%' OR p.name ILIKE '%743%'
      LIMIT 1
   )
 WHERE u.org_id IS NULL
   AND u.role IN ('super_admin', 'owner', 'property_manager');

ALTER TABLE gmail_oauth_tokens DROP CONSTRAINT IF EXISTS gmail_oauth_tokens_pkey;
ALTER TABLE gmail_oauth_tokens DROP COLUMN IF EXISTS user_id;
DELETE FROM gmail_oauth_tokens a
 USING gmail_oauth_tokens b
 WHERE a.org_id IS NOT NULL AND b.org_id IS NOT NULL
   AND a.org_id = b.org_id AND a.ctid < b.ctid;
ALTER TABLE gmail_oauth_tokens ADD PRIMARY KEY (org_id);
