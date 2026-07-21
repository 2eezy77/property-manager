/**
 * Dominion Energy electric bill amount rules: tenant charges vs account balance.
 */

const TYPICAL_TENANT_CHARGE = 200;

function parseAmountMatch(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return Number(m[1].replace(/,/g, ''));
  }
  return null;
}

const CURRENT_CHARGE_PATTERNS = [
  /current\s+charges[^$0-9]{0,40}\$?\s*([\d,]+\.\d{2})/i,
  /current\s+amount[^$0-9]{0,40}\$?\s*([\d,]+\.\d{2})/i,
  /energy\s+charges\s+for\s+(?:the\s+)?period[^$0-9]{0,40}\$?\s*([\d,]+\.\d{2})/i,
  /energy\s+charges[^$0-9]{0,40}\$?\s*([\d,]+\.\d{2})/i,
  /charges\s+for\s+(?:this\s+)?period[^$0-9]{0,40}\$?\s*([\d,]+\.\d{2})/i,
];

const STATEMENT_BALANCE_PATTERNS = [
  /amount\s+due[^$0-9]{0,40}\$?\s*([\d,]+\.\d{2})/i,
  /amount\s+due[^$0-9]{0,40}([\d,]+\.\d{2})/i,
  /balance\s+due[^$0-9]{0,40}\$?\s*([\d,]+\.\d{2})/i,
  /total\s+account\s+balance[^$0-9]{0,40}\$?\s*([\d,]+\.\d{2})/i,
  /account\s+balance[^$0-9]{0,40}\$?\s*([\d,]+\.\d{2})/i,
];

function parseDominionAmounts(text) {
  const warnings = [];
  const current = parseAmountMatch(text, CURRENT_CHARGE_PATTERNS);
  const statement = parseAmountMatch(text, STATEMENT_BALANCE_PATTERNS);

  let tenant_charge_amount = current;
  let amount_source = 'current_charges';

  if (tenant_charge_amount == null && statement != null) {
    tenant_charge_amount = statement;
    amount_source = 'amount_due_fallback';
    warnings.push(
      'Current charges not found; using amount due / balance due as tenant charge (may be full account balance).'
    );
  }

  if (tenant_charge_amount == null) {
    const dollar = [...text.matchAll(/\$\s*([\d,]+\.\d{2})/g)]
      .map((m) => Number(m[1].replace(/,/g, '')))
      .filter((n) => n >= 5);
    if (dollar.length) {
      tenant_charge_amount = Math.min(...dollar);
      amount_source = 'parsed_total';
      warnings.push('Used smallest dollar amount in email as tenant charge.');
    }
  }

  const validation = validateElectricAmount({
    tenant_charge_amount,
    statement_balance: statement,
  });
  warnings.push(...validation);

  return {
    tenant_charge_amount,
    statement_balance: statement,
    amount_source,
    warnings,
  };
}

function resolveElectricChargeAmount(parsedOrBill) {
  if (parsedOrBill == null) return null;
  if (parsedOrBill.tenant_charge_amount != null) {
    return Number(parsedOrBill.tenant_charge_amount);
  }
  if (parsedOrBill.total_amount != null) {
    return Number(parsedOrBill.total_amount);
  }
  return null;
}

function dayOnly(value) {
  if (!value) return '';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s.slice(0, 10);
}

function computeChargeableAfter(periodEnd) {
  return dayOnly(periodEnd) || null;
}

function isElectricBillChargeable(bill) {
  if (!bill || bill.service_type !== 'electric') return true;
  const after = dayOnly(bill.chargeable_after || bill.period_end);
  if (!after) return true;
  const today = new Date().toISOString().slice(0, 10);
  return today >= after;
}

function validateElectricAmount({ tenant_charge_amount, statement_balance }) {
  const warnings = [];
  const charge = tenant_charge_amount != null ? Number(tenant_charge_amount) : null;
  const balance = statement_balance != null ? Number(statement_balance) : null;

  if (charge == null || Number.isNaN(charge)) return warnings;

  if (balance != null && !Number.isNaN(balance) && Math.abs(charge - balance) < 0.01) {
    warnings.push(
      'Tenant charge equals statement balance; verify this is current-period charges, not full account balance.'
    );
  }

  if (charge >= TYPICAL_TENANT_CHARGE * 2) {
    warnings.push(
      `Tenant charge $${charge.toFixed(2)} is unusually high (>= 2× typical ~$${TYPICAL_TENANT_CHARGE}); confirm not using account balance.`
    );
  }

  return warnings;
}

function isDominionProvider(providerName, from, text) {
  const hay = `${providerName || ''} ${from || ''} ${text || ''}`.toLowerCase();
  return hay.includes('dominion') || hay.includes('domenergy');
}

module.exports = {
  parseDominionAmounts,
  resolveElectricChargeAmount,
  computeChargeableAfter,
  isElectricBillChargeable,
  validateElectricAmount,
  isDominionProvider,
  TYPICAL_TENANT_CHARGE,
};
