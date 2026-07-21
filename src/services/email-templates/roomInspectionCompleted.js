const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, detailTable } = require('./utils');

function render({ tenantName, propertyName, propertyAddress, visitedAtFormatted, roomLabels }) {
  const rooms = Array.isArray(roomLabels) ? roomLabels : [roomLabels];
  const roomText = rooms.join(', ');
  const subject = `Room inspection completed — ${visitedAtFormatted}`;

  const text = [
    `Hi ${tenantName},`,
    '',
    `A routine property inspection at ${propertyName} has been completed.`,
    '',
    `Completed: ${visitedAtFormatted}`,
    `Room(s) inspected: ${roomText}`,
    `Address: ${propertyAddress}`,
    '',
    'You did not need to be present for this inspection. You are welcome to be home if you wish.',
    '',
    'If you have questions, reply to this email.',
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: 'Room inspection completed',
    preheader: `Your room was inspected on ${visitedAtFormatted}`,
    accent: PALETTE.success,
    accentBg: PALETTE.successBg,
    heroEmoji: '✓',
    heroLabel: 'Inspection held',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([
        `A <strong>routine property inspection</strong> at ${escapeHtml(propertyName)} has been <strong>completed</strong>.`,
      ]),
      detailTable([
        ['When', visitedAtFormatted],
        ['Room(s) inspected', roomText],
        ['Property', propertyAddress],
      ]),
      paragraph([
        'You <strong>did not need to be present</strong> for this inspection. You are welcome to be home if you wish.',
      ]),
      paragraph(['Entry was limited to the area(s) listed above.']),
    ].join(''),
  });

  return { html, text, subject };
}

module.exports = { render };
