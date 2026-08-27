/**
 * Pure Cash App CSV field helpers (quoted CSV + statement dates).
 */

function parseCashAppDate(dateStr) {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { date: null, dateIso: null };
  const dateIso = `${m[1]}-${m[2]}-${m[3]}`;
  return { date: new Date(`${dateIso}T12:00:00`), dateIso };
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

module.exports = {
  parseCashAppDate,
  parseCsvLine,
};
