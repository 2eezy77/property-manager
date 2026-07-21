const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, detailTable } = require('./utils');

function render({ tenantName, propertyName, propertyAddress, visitedAtFormatted, roomLabels }) {
  const rooms = Array.isArray(roomLabels) ? roomLabels : [roomLabels];
  const roomText = rooms.join(', ');
  const subject = `Vacant room showing completed — ${visitedAtFormatted}`;

  const text = [
    `Hi ${tenantName},`,
    '',
    `A vacant room showing at ${propertyName} has been completed.`,
    '',
    `Completed: ${visitedAtFormatted}`,
    `Vacant room(s) shown: ${roomText}`,
    `Address: ${propertyAddress}`,
    '',
    'You did not need to be present. Thank you for your patience if you were home.',
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: 'Vacant room showing completed',
    preheader: `Showing held on ${visitedAtFormatted}`,
    accent: PALETTE.success,
    accentBg: PALETTE.successBg,
    heroEmoji: '✓',
    heroLabel: 'Showing held',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([
        `A <strong>vacant room showing</strong> at ${escapeHtml(propertyName)} has been <strong>completed</strong>.`,
      ]),
      detailTable([
        ['When', visitedAtFormatted],
        ['Vacant room(s) shown', roomText],
        ['Property', propertyAddress],
      ]),
      paragraph([
        'You <strong>did not need to be present</strong>. Thank you for your patience if you were home.',
      ]),
    ].join(''),
  });

  return { html, text, subject };
}

module.exports = { render };
