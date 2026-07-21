-- Electric bill metadata: tenant charges vs statement balance, submeter shares, chargeable date.

ALTER TABLE utility_bills
  ADD COLUMN IF NOT EXISTS tenant_charge_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS statement_balance NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS amount_source VARCHAR(32),
  ADD COLUMN IF NOT EXISTS chargeable_after DATE,
  ADD COLUMN IF NOT EXISTS amount_pulled_at TIMESTAMPTZ;

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS electric_share_percent NUMERIC(5,2)
    CHECK (electric_share_percent IS NULL OR (electric_share_percent >= 0 AND electric_share_percent <= 100));

UPDATE utility_bills SET tenant_charge_amount = total_amount WHERE tenant_charge_amount IS NULL;
UPDATE utility_bills SET chargeable_after = period_end WHERE chargeable_after IS NULL AND service_type = 'electric';
