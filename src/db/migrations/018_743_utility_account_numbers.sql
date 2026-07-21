-- Link 743 A Ave to real Dominion + Norfolk InvoiceCloud account numbers from Gmail e-bills.
UPDATE properties
   SET dominion_account_number          = '210005533430',
       norfolk_utilities_account_number = '1055175'
 WHERE address_line1 ILIKE '%743 A%';
