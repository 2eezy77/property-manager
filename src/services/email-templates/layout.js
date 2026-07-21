/**
 * Table-based HTML email shell — inline CSS only.
 */

const { BRAND, PALETTE } = require('./brand');
const { escapeHtml } = require('./utils');

/**
 * @param {object} opts
 * @param {string} opts.title — document title
 * @param {string} [opts.preheader] — inbox preview line (hidden)
 * @param {string} opts.bodyHtml — main card content
 * @param {string} [opts.ctaUrl]
 * @param {string} [opts.ctaLabel]
 * @param {string} [opts.accent] — hex accent for hero + button
 * @param {string} [opts.accentBg] — hero background
 * @param {string} [opts.heroEmoji] — single emoji in hero circle
 * @param {string} [opts.heroLabel] — short label under emoji
 */
function wrapEmail({
  title,
  preheader = '',
  bodyHtml,
  ctaUrl,
  ctaLabel,
  accent = PALETTE.accentDefault,
  accentBg = '#eef2ff',
  heroEmoji = '🏠',
  heroLabel = '',
}) {
  const pre = escapeHtml(preheader || title);
  const footerLinkLabel =
    ctaUrl && /\/manager/.test(String(ctaUrl)) ? 'Open manager portal' : 'Open tenant portal';
  const ctaBlock =
    ctaUrl && ctaLabel
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
          <tr>
            <td style="border-radius:10px;background:${accent};">
              <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(ctaLabel)}</a>
            </td>
          </tr>
        </table>`
      : '';

  const heroLabelBlock = heroLabel
    ? `<p style="margin:12px 0 0;font-size:13px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${accent};">${escapeHtml(heroLabel)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${PALETTE.shell};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${pre}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PALETTE.shell};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr>
            <td style="padding:0 0 20px;text-align:center;">
              <span style="font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${PALETTE.ink};">${escapeHtml(BRAND.name)}</span>
              <span style="display:block;margin-top:4px;font-size:12px;color:${PALETTE.muted};">${escapeHtml(BRAND.property)} · ${escapeHtml(BRAND.location)}</span>
            </td>
          </tr>
          <tr>
            <td style="border-radius:16px 16px 0 0;background:linear-gradient(135deg,${PALETTE.headerFrom} 0%,${PALETTE.headerTo} 100%);height:8px;font-size:0;line-height:8px;">&nbsp;</td>
          </tr>
          <tr>
            <td style="background:${PALETTE.card};border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(15,23,42,0.08);padding:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:28px 32px 8px;text-align:center;background:${accentBg};border-bottom:1px solid ${PALETTE.border};">
                    <div style="width:56px;height:56px;line-height:56px;border-radius:50%;background:${PALETTE.card};margin:0 auto;font-size:28px;box-shadow:0 2px 8px rgba(15,23,42,0.06);">${heroEmoji}</div>
                    ${heroLabelBlock}
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 32px 8px;">
                    ${bodyHtml}
                    ${ctaBlock}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 16px 8px;text-align:center;font-size:12px;line-height:1.5;color:${PALETTE.muted};">
              <p style="margin:0 0 8px;">This is an automated message from ${escapeHtml(BRAND.name)}. Please do not reply to this email.</p>
              <p style="margin:0;">
                <a href="${escapeHtml(ctaUrl || BRAND.portalUrl)}" style="color:${accent};text-decoration:none;font-weight:600;">${escapeHtml(footerLinkLabel)}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { wrapEmail };
