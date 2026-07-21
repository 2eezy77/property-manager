/**
 * Shared helpers for email templates.
 */

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(amount) {
  return `$${parseFloat(amount).toFixed(2)}`;
}

function formatDate(dateStr) {
  if (!dateStr) return 'this month';
  const raw = dateStr instanceof Date ? dateStr.toISOString().slice(0, 10) : String(dateStr).slice(0, 10);
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function paragraph(lines) {
  return lines.filter((l) => l != null && l !== '').map((l) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">${l}</p>`).join('');
}

function detailRow(label, value) {
  return `<tr>
    <td style="padding:10px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;width:38%;">${escapeHtml(label)}</td>
    <td style="padding:10px 12px;font-size:14px;font-weight:600;color:#0f172a;border-bottom:1px solid #e2e8f0;">${escapeHtml(value)}</td>
  </tr>`;
}

function detailTable(rows) {
  const body = rows.map(([l, v]) => detailRow(l, v)).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#f8fafc;margin:0 0 20px;">
    <tbody>${body}</tbody>
  </table>`;
}

function sectionHeading(text) {
  return `<h3 style="margin:24px 0 10px;font-size:14px;font-weight:700;color:#0f172a;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(text)}</h3>`;
}

/** @param {string[]} items — HTML-safe lines (escape user content before passing) */
function bulletList(items) {
  const lis = items
    .filter(Boolean)
    .map(
      (line) =>
        `<li style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#334155;">${line}</li>`
    )
    .join('');
  return `<ul style="margin:0 0 20px;padding-left:22px;">${lis}</ul>`;
}

module.exports = {
  escapeHtml,
  formatMoney,
  formatDate,
  paragraph,
  detailRow,
  detailTable,
  sectionHeading,
  bulletList,
};
