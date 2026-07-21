const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph } = require('./utils');

/** Manager broadcast (channel may be email in future). */
function render({ tenantName, title, body, senderName, propertyName }) {
  const text = [
    `Hi ${tenantName},`,
    '',
    title,
    '',
    body,
    '',
    `— ${senderName || 'Property management'}, ${propertyName || BRAND.property}`,
    '',
    BRAND.name,
  ].join('\n');

  const bodyBlock = escapeHtml(body).replace(/\n/g, '<br />');
  const html = wrapEmail({
    title: title,
    preheader: title,
    accent: PALETTE.accentDefault,
    accentBg: '#eef2ff',
    heroEmoji: '📢',
    heroLabel: 'Announcement',
    ctaUrl: BRAND.portalUrl,
    ctaLabel: 'Open portal',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      `<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0f172a;line-height:1.3;">${escapeHtml(title)}</h2>`,
      `<div style="margin:0 0 20px;padding:20px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;font-size:15px;line-height:1.65;color:#334155;">${bodyBlock}</div>`,
      paragraph([
        `<span style="color:#64748b;">— ${escapeHtml(senderName || 'Property management')}, ${escapeHtml(propertyName || BRAND.property)}</span>`,
      ]),
    ].join(''),
  });

  return { html, text };
}

module.exports = { render };
