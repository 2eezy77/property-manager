#!/usr/bin/env node
/**
 * Import Newrez mortgage statement PDFs into mortgage_statements (RAG source).
 *
 *   node scripts/import-mortgage-statements.js path/to/a.pdf path/to/b.pdf
 *   node scripts/import-mortgage-statements.js --dir "C:/Users/Isaac/Downloads"
 *   node scripts/import-mortgage-statements.js --owner-email josemontero2002@gmail.com file.pdf
 *
 * Default: imports the five Monthly Statement*.pdf files from ~/Downloads when no paths given.
 */

require('../src/config/env');
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/client');
const {
  importPdfFile,
  resolveOwnerId,
} = require('../src/services/mortgage-statement.service');

const DEFAULT_FILES = [
  'Monthly Statement.pdf',
  'Monthly Statement (1).pdf',
  'Monthly Statement (2).pdf',
  'Monthly Statement (3).pdf',
  'Monthly Statement (4).pdf',
];

const args = process.argv.slice(2);

function argAfter(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

async function resolveOwnerFromArgs() {
  const email = argAfter('--owner-email');
  if (email) {
    const { rows } = await pool.query(
      `SELECT id, email FROM users WHERE email ILIKE $1 AND role IN ('owner', 'super_admin') LIMIT 1`,
      [email]
    );
    if (!rows[0]) {
      throw new Error(`No owner account for email: ${email}`);
    }
    return rows[0].id;
  }
  return resolveOwnerId();
}

function collectPdfPaths() {
  const dir = argAfter('--dir');
  if (dir) {
    const abs = path.resolve(dir);
    return fs.readdirSync(abs)
      .filter(f => f.toLowerCase().endsWith('.pdf'))
      .map(f => path.join(abs, f));
  }

  const positional = args.filter(a => !a.startsWith('--') && a !== argAfter('--owner-email'));
  if (positional.length) return positional.map(p => path.resolve(p));

  const downloads = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads');
  return DEFAULT_FILES.map(f => path.join(downloads, f));
}

async function main() {
  const ownerId = await resolveOwnerFromArgs();
  const files = collectPdfPaths();

  console.log(`Owner id: ${ownerId}`);
  console.log(`Importing ${files.length} PDF(s)…\n`);

  const results = { imported: [], skipped: [], errors: [] };

  for (const filePath of files) {
    const label = path.basename(filePath);
    if (!fs.existsSync(filePath)) {
      results.skipped.push({ file: label, reason: 'File not found' });
      continue;
    }
    try {
      const { parsed, row } = await importPdfFile(ownerId, filePath);
      results.imported.push({
        file: label,
        statement_date: row.statement_date,
        due_date: row.due_date,
        amount_due: row.amount_due,
        monthly_payment: row.monthly_payment,
        principal_balance: row.principal_balance,
        escrow_balance: row.escrow_balance,
        account_number: row.account_number,
      });
      console.log(`✓ ${label}`);
      console.log(`  statement ${parsed.statement_date} · due ${parsed.due_date} · principal $${parsed.principal_balance}`);
    } catch (err) {
      results.errors.push({ file: label, error: err.message });
      console.error(`✗ ${label}: ${err.message}`);
    }
  }

  console.log('\nSummary:', {
    imported: results.imported.length,
    skipped: results.skipped.length,
    errors: results.errors.length,
  });

  if (results.imported.length) {
    console.log('\nImported statements:');
    for (const r of results.imported) {
      console.log(`  ${r.statement_date} → due ${r.due_date}, principal $${r.principal_balance}, pay $${r.monthly_payment}`);
    }
  }

  await pool.end();
  process.exit(results.errors.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
