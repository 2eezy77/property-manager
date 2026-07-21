const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, detailTable } = require('./utils');

function render({ tenantName, propertyName, propertyAddress, plannedAtFormatted, roomLabels }) {
  const rooms = Array.isArray(roomLabels) ? roomLabels : [roomLabels];
  const roomText = rooms.join(', ');
  const subject = `Room inspection scheduled — ${plannedAtFormatted}`;

  const text = [
    `Hi ${tenantName},`,
    '',
    `This is notice of a routine property inspection per your lease at ${propertyName}.`,
    '',
    `Scheduled: ${plannedAtFormatted}`,
    `Area(s): ${roomText}`,
    `Address: ${propertyAddress}`,
    '',
    'You do not need to be present for this inspection, but you may be home if you wish.',
    '',
    'You received at least 24 hours notice as required. Entry is limited to the area(s) listed above.',
    '',
    'If you have questions, reply to this email.',
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: 'Room inspection scheduled',
    preheader: `Inspection on ${plannedAtFormatted}`,
    accent: PALETTE.info,
    accentBg: PALETTE.infoBg,
    heroEmoji: '🏠',
    heroLabel: '24-hour inspection notice',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([
        `This is notice of a <strong>routine property inspection</strong> per your lease at ${escapeHtml(propertyName)}.`,
      ]),
      detailTable([
        ['When', plannedAtFormatted],
        ['Room(s)', roomText],
        ['Property', propertyAddress],
      ]),
      paragraph([
        'You <strong>do not need to be present</strong> for this inspection, but you may be home if you wish.',
      ]),
      paragraph([
        'You received at least <strong>24 hours notice</strong> as required. Entry is limited to the area(s) listed above.',
      ]),
    ].join(''),
  });

  return { html, text, subject };
}

module.exports = { render };
