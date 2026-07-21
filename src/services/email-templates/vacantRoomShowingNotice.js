const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, detailTable } = require('./utils');

function render({ tenantName, propertyName, propertyAddress, plannedAtFormatted, roomLabels }) {
  const rooms = Array.isArray(roomLabels) ? roomLabels : [roomLabels];
  const roomText = rooms.join(', ');
  const subject = `Vacant room showing scheduled — ${plannedAtFormatted}`;

  const text = [
    `Hi ${tenantName},`,
    '',
    `A prospective tenant may tour a vacant room at ${propertyName}.`,
    '',
    `Scheduled: ${plannedAtFormatted}`,
    `Vacant room(s): ${roomText}`,
    `Address: ${propertyAddress}`,
    '',
    'You do not need to be present or prepare your room. You may be home if you wish.',
    '',
    'The visit may include common areas (kitchen, parking, porch). We will not enter your leased room unless it is listed above.',
    '',
    'If you have questions, reply to this email.',
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: 'Vacant room showing scheduled',
    preheader: `Showing on ${plannedAtFormatted}`,
    accent: PALETTE.info,
    accentBg: PALETTE.infoBg,
    heroEmoji: '🏠',
    heroLabel: 'Courtesy notice',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([
        `A <strong>prospective tenant</strong> may tour a vacant room at ${escapeHtml(propertyName)}.`,
      ]),
      detailTable([
        ['When', plannedAtFormatted],
        ['Vacant room(s)', roomText],
        ['Property', propertyAddress],
      ]),
      paragraph([
        'You <strong>do not need to be present</strong> or prepare your room. You may be home if you wish.',
      ]),
      paragraph([
        'The visit may include common areas (kitchen, parking, porch). We will <strong>not enter your leased room</strong> unless it is listed above.',
      ]),
    ].join(''),
  });

  return { html, text, subject };
}

module.exports = { render };
