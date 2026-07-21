-- Tenants created before org_id was consistently set often have NULL org_id.
-- Impersonation ("View as") and org-scoped queries need lease → property.org_id.

UPDATE users u
SET org_id = sub.org_id
FROM (
  SELECT DISTINCT ON (l.tenant_id)
         l.tenant_id,
         p.org_id
    FROM leases l
    JOIN units un ON un.id = l.unit_id
    JOIN properties p ON p.id = un.property_id
   WHERE p.org_id IS NOT NULL
   ORDER BY l.tenant_id,
            CASE
              WHEN l.status = 'active' THEN 0
              WHEN l.status = 'pending_signature' THEN 1
              ELSE 2
            END,
            l.created_at DESC NULLS LAST
) sub
WHERE u.id = sub.tenant_id
  AND u.role = 'tenant'
  AND u.org_id IS NULL;
