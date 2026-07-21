-- 006_property_utility_accounts.sql
-- Link properties to external utility provider account numbers for bill lookup.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS dominion_account_number          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS norfolk_utilities_account_number VARCHAR(20);

COMMENT ON COLUMN properties.dominion_account_number IS
  'Dominion Energy Virginia electric account (10-digit). Used by GET /api/utilities/provider-bills/dominion.';

COMMENT ON COLUMN properties.norfolk_utilities_account_number IS
  'City of Norfolk / HRUBS water-sewer account. Used by GET /api/utilities/provider-bills/norfolk.';

-- Demo defaults for 743 A Ave (Norfolk, VA)
UPDATE properties
   SET dominion_account_number          = COALESCE(dominion_account_number, '8207421000'),
       norfolk_utilities_account_number = COALESCE(norfolk_utilities_account_number, '7430012345')
 WHERE address_line1 ILIKE '%743 A%';
