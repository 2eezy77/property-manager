const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, detailTable } = require('./utils');

function render({ tenantName, propertyName, propertyAddress, plannedAtFormatted, roomLabels }) {
  const rooms = Array.isArray(roomLabels) ? roomLabels : [roomLabels];
  const roomText = rooms.join(', ');
  const subject = `Maintenance follow-up scheduled — ${plannedAtFormatted}`;

  const text = [
    `Hi ${tenantName},`,
    '',
    `We are scheduling a maintenance follow-up visit at ${propertyName}.`,
    '',
    `Scheduled: ${plannedAtFormatted}`,
    `Room(s): ${roomText}`,
    `Address: ${propertyAddress}`,
    '',
    'You do not need to be present, but you may be home if you wish so we can address any remaining items with you.',
    '',
    'You received at least 24 hours notice. Entry is limited to the area(s) listed above.',
    '',
    'If you have questions, reply to this email.',
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: 'Maintenance follow-up scheduled',
    preheader: `Follow-up on ${plannedAtFormatted}`,
    accent: PALETTE.accentDefault,
    accentBg: '#eef2ff',
    heroEmoji: '🔧',
    heroLabel: '24-hour notice',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([
        `We are scheduling a <strong>maintenance follow-up visit</strong> at ${escapeHtml(propertyName)}.`,
      ]),
      detailTable([
        ['When', plannedAtFormatted],
        ['Room(s)', roomText],
        ['Property', propertyAddress],
      ]),
      paragraph([
        'You <strong>do not need to be present</strong>, but you may be home if you wish so we can finish any remaining work with you.',
      ]),
      paragraph([
        'You received at least <strong>24 hours notice</strong>. Entry is limited to the area(s) listed above.',
      ]),
    ].join(''),
  });

  return { html, text, subject };
}

module.exports = { render };
