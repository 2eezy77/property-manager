-- 028_property_operating_bank.sql
-- Enum value only (Postgres requires commit before use in same migration runner).

ALTER TYPE bank_account_purpose ADD VALUE IF NOT EXISTS 'property_operating';
