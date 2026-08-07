-- House cover: $N × active tenants applied to combined monthly utilities.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS utility_house_cover_per_tenant NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (utility_house_cover_per_tenant >= 0);

ALTER TABLE utility_bills
  ADD COLUMN IF NOT EXISTS house_cover_applied NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tenant_pool_amount NUMERIC(10,2);

COMMENT ON COLUMN properties.utility_house_cover_per_tenant IS
  'USD per active lease overlapping the bill month; subtracted from combined monthly utilities before tenant splits. 743 A Ave seeded to 100.';

-- Seed 743 A Ave only (prod id + name match for safety).
UPDATE properties
   SET utility_house_cover_per_tenant = 100.00
 WHERE utility_house_cover_per_tenant = 0
   AND (
     id = 'b2577022-d7d3-467a-a886-48e6ddfa5316'
     OR id = 'cccccccc-0000-0000-0000-000000000001'
     OR name = '743 A Ave'
     OR address_line1 ILIKE '743 A%'
   );
