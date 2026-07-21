const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph, detailTable } = require('./utils');

function render({ tenantName, propertyName, propertyAddress, visitedAtFormatted, roomLabels }) {
  const rooms = Array.isArray(roomLabels) ? roomLabels : [roomLabels];
  const roomText = rooms.join(', ');
  const subject = `Maintenance follow-up completed — ${visitedAtFormatted}`;

  const text = [
    `Hi ${tenantName},`,
    '',
    `A maintenance follow-up visit at ${propertyName} has been completed.`,
    '',
    `Completed: ${visitedAtFormatted}`,
    `Room(s): ${roomText}`,
    `Address: ${propertyAddress}`,
    '',
    'You did not need to be present. Thank you if you were home to meet us.',
    '',
    'If something still needs attention, submit a maintenance request in your tenant portal or reply to this email.',
    '',
    BRAND.name,
  ].join('\n');

  const html = wrapEmail({
    title: 'Maintenance follow-up completed',
    preheader: `Follow-up held on ${visitedAtFormatted}`,
    accent: PALETTE.success,
    accentBg: PALETTE.successBg,
    heroEmoji: '✓',
    heroLabel: 'Follow-up held',
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([
        `A <strong>maintenance follow-up visit</strong> at ${escapeHtml(propertyName)} has been <strong>completed</strong>.`,
      ]),
      detailTable([
        ['When', visitedAtFormatted],
        ['Room(s)', roomText],
        ['Property', propertyAddress],
      ]),
      paragraph([
        'You <strong>did not need to be present</strong>. Thank you if you were home to meet us.',
      ]),
      paragraph([
        'If something still needs attention, submit a maintenance request in your tenant portal or reply to this email.',
      ]),
    ].join(''),
  });

  return { html, text, subject };
}

module.exports = { render };
