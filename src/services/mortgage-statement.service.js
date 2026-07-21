/**
 * mortgage-statement.service.js
 * Parse Newrez mortgage PDF text, persist statements, build owner finance RAG context.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../db/client');

const { PDFParse } = require('pdf-parse');

function money(raw) {
  if (!raw) return null;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseDateUs(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function grab(text, pattern) {
  const m = text.match(pattern);
  return m ? m[1].trim() : null;
}

function parseMortgageText(rawText, sourceFile = null) {
  const text = rawText.replace(/\r/g, '');

  const statementDate = parseDateUs(grab(text, /Statement Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i));
  const dueDate = parseDateUs(grab(text, /Next Due Date\s*(\d{1,2}\/\d{1,2}\/\d{4})/i));
  const amountDue = money(grab(text, /Total Amount Due\s*\$([\d,]+\.\d{2})/i)
    ?? grab(text, /Amount Due\s*\$([\d,]+\.\d{2})/i));
  const monthlyPayment = money(grab(text, /Regular Monthly Payment\s*\$([\d,]+\.\d{2})/i));
  const principalBalance = money(grab(text, /Outstanding Principal\s*\$([\d,]+\.\d{2})/i));
  const escrowBalance = money(grab(text, /Current Escrow Balance\s*\$([\d,]+\.\d{2})/i));
  const interestRateRaw = grab(text, /Interest Rate\s*([\d.]+)%/i);
  const interestRate = interestRateRaw ? Number(interestRateRaw) : null;
  const accountNumber = grab(text, /Account Number\s*(\d+)/i);

  const paymentLines = [...text.matchAll(
    /(\d{1,2}\/\d{1,2}\/\d{4})\s+Regular Payment[^\n]*/gi
  )];
  let lastPaymentDate = null;
  let lastPaymentAmount = null;
  if (paymentLines.length) {
    const line = paymentLines[paymentLines.length - 1][0];
    lastPaymentDate = parseDateUs(paymentLines[paymentLines.length - 1][1]);
    const amounts = [...line.matchAll(/\$([\d,]+\.\d{2})/g)].map((m) => money(m[1]));
    const paid = amounts.filter((a) => a > 0);
    lastPaymentAmount = paid.length ? paid[paid.length - 1] : amounts[amounts.length - 1];
  }

  return {
    statement_date: statementDate,
    due_date: dueDate,
    amount_due: amountDue,
    monthly_payment: monthlyPayment,
    principal_balance: principalBalance,
    escrow_balance: escrowBalance,
    interest_rate: interestRate,
    account_number: accountNumber,
    servicer: /newrez/i.test(text) ? 'Newrez LLC' : null,
    metadata: {
      last_payment_date: lastPaymentDate,
      last_payment_amount: lastPaymentAmount,
      property_hint: grab(text, /Property Address:\s*([^\n]+)/i),
    },
    raw_text: text,
    source_file: sourceFile,
  };
}

async function extractPdfText(filePath) {
  const data = fs.readFileSync(filePath);
  const parser = new PDFParse({ data });
  const result = await parser.getText();
  return result.text || '';
}

async function upsertStatement(ownerId, parsed) {
  if (!parsed.statement_date) {
    const err = new Error('Could not parse statement_date from PDF');
    err.code = 'PARSE_FAILED';
    throw err;
  }

  const { rows } = await pool.query(
    `INSERT INTO mortgage_statements (
       owner_id, statement_date, due_date, amount_due, monthly_payment,
       principal_balance, escrow_balance, interest_rate, account_number,
       servicer, raw_text, source_file, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (owner_id, statement_date, account_number)
     DO UPDATE SET
       due_date = EXCLUDED.due_date,
       amount_due = EXCLUDED.amount_due,
       monthly_payment = EXCLUDED.monthly_payment,
       principal_balance = EXCLUDED.principal_balance,
       escrow_balance = EXCLUDED.escrow_balance,
       interest_rate = EXCLUDED.interest_rate,
       servicer = COALESCE(EXCLUDED.servicer, mortgage_statements.servicer),
       raw_text = EXCLUDED.raw_text,
       source_file = EXCLUDED.source_file,
       metadata = EXCLUDED.metadata,
       imported_at = NOW()
     RETURNING *`,
    [
      ownerId,
      parsed.statement_date,
      parsed.due_date,
      parsed.amount_due,
      parsed.monthly_payment,
      parsed.principal_balance,
      parsed.escrow_balance,
      parsed.interest_rate,
      parsed.account_number,
      parsed.servicer || 'Newrez LLC',
      parsed.raw_text,
      parsed.source_file,
      JSON.stringify(parsed.metadata || {}),
    ]
  );
  return rows[0];
}

async function importPdfFile(ownerId, filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    const err = new Error(`File not found: ${abs}`);
    err.code = 'FILE_NOT_FOUND';
    throw err;
  }
  const rawText = await extractPdfText(abs);
  const parsed = parseMortgageText(rawText, path.basename(abs));
  const row = await upsertStatement(ownerId, parsed);
  return { parsed, row };
}

async function listStatements(ownerId, limit = 12) {
  const { rows } = await pool.query(
    `SELECT id, statement_date, due_date, amount_due, monthly_payment,
            principal_balance, escrow_balance, interest_rate, account_number,
            servicer, source_file, metadata, imported_at
     FROM mortgage_statements
     WHERE owner_id = $1
     ORDER BY statement_date DESC
     LIMIT $2`,
    [ownerId, limit]
  );
  return rows;
}

async function getLatestSummary(ownerId, { includeRawText = false } = {}) {
  const cols = includeRawText
    ? 'id, statement_date, due_date, amount_due, monthly_payment, principal_balance, escrow_balance, interest_rate, account_number, servicer, source_file, metadata, imported_at, raw_text'
    : 'id, statement_date, due_date, amount_due, monthly_payment, principal_balance, escrow_balance, interest_rate, account_number, servicer, source_file, metadata, imported_at';
  const { rows } = await pool.query(
    `SELECT ${cols}
     FROM mortgage_statements
     WHERE owner_id = $1
     ORDER BY statement_date DESC
     LIMIT 1`,
    [ownerId]
  );
  return rows[0] ?? null;
}

function fmtMoney(n) {
  if (n == null) return 'unknown';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function buildFinanceRagContext(ownerId) {
  const [latest, checklistRows] = await Promise.all([
    getLatestSummary(ownerId, { includeRawText: true }),
    pool.query(
      `SELECT category, label, amount_estimate, due_day, payment_method, notes,
              last_paid_at, last_verified_at
       FROM owner_payment_checklist
       WHERE owner_id = $1
       ORDER BY sort_order, label`,
      [ownerId]
    ),
  ]);

  const lines = ['# Owner personal finance context (for RAG / AI queries)', ''];

  if (latest) {
    const meta = latest.metadata || {};
    lines.push('## Latest mortgage statement (Newrez)');
    lines.push(`- Statement date: ${latest.statement_date}`);
    lines.push(`- Next payment due: ${latest.due_date ?? 'unknown'}`);
    lines.push(`- Total amount due: ${fmtMoney(latest.amount_due)}`);
    lines.push(`- Regular monthly payment: ${fmtMoney(latest.monthly_payment)}`);
    lines.push(`- Principal balance: ${fmtMoney(latest.principal_balance)}`);
    lines.push(`- Escrow balance: ${fmtMoney(latest.escrow_balance)}`);
    lines.push(`- Interest rate: ${latest.interest_rate != null ? `${latest.interest_rate}%` : 'unknown'}`);
    lines.push(`- Servicer: ${latest.servicer}`);
    if (meta.last_payment_date) {
      lines.push(`- Last payment: ${fmtMoney(meta.last_payment_amount)} on ${meta.last_payment_date}`);
    }
    lines.push('');
    lines.push('### Statement excerpt');
    lines.push((latest.raw_text || '').slice(0, 3500));
    lines.push('');
  } else {
    lines.push('## Mortgage: no statements imported yet.');
    lines.push('');
  }

  lines.push('## Owner payment checklist');
  if (!checklistRows.rows.length) {
    lines.push('- No checklist items configured.');
  } else {
    for (const item of checklistRows.rows) {
      const paid = item.last_paid_at
        ? `paid ${item.last_paid_at.toISOString().slice(0, 10)}`
        : 'not marked paid this cycle';
      const verified = item.last_verified_at
        ? `verified ${item.last_verified_at.toISOString().slice(0, 10)}`
        : 'not verified';
      lines.push(
        `- ${item.label} (${item.category}): est ${fmtMoney(item.amount_estimate)}` +
        `${item.due_day ? `, due ~day ${item.due_day}` : ''}` +
        `${item.payment_method ? `, via ${item.payment_method}` : ''}` +
        ` — ${paid}; ${verified}` +
        `${item.notes ? ` — ${item.notes}` : ''}`
      );
    }
  }

  lines.push('');
  lines.push('Property utility bills for 743 A Ave may also appear under /api/utilities (tenant-split bills).');

  return {
    context: lines.join('\n'),
    latest_mortgage: latest,
    checklist: checklistRows.rows,
  };
}

async function resolveOwnerId(explicitOwnerId) {
  if (explicitOwnerId) return explicitOwnerId;
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1`
  );
  if (!rows[0]) {
    const err = new Error('No owner user found');
    err.code = 'NO_OWNER';
    throw err;
  }
  return rows[0].id;
}

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 16);
}

module.exports = {
  parseMortgageText,
  extractPdfText,
  upsertStatement,
  importPdfFile,
  listStatements,
  getLatestSummary,
  buildFinanceRagContext,
  resolveOwnerId,
  fileHash,
};
