const { wrapEmail } = require('./layout');
const { BRAND, PALETTE } = require('./brand');
const { escapeHtml, paragraph } = require('./utils');

const COPY = {
  room_inspection: {
    subject: (propertyName) => `Inspection cancelled — ${propertyName}`,
    title: 'Inspection cancelled',
    preheader: 'Scheduled inspection will not occur',
    heroLabel: 'Inspection update',
    line: (when, property) =>
      `The room inspection scheduled for ${when} at ${property} has been cancelled.`,
    reschedule: 'We will send a new notice if the inspection is rescheduled.',
    inAppTitle: 'Inspection cancelled',
    inAppBody: (when) =>
      `The inspection scheduled for ${when || 'your room'} was cancelled. We will notify you if rescheduled.`,
    notificationType: 'room_inspection_cancelled',
  },
  maintenance_followup: {
    subject: (propertyName) => `Maintenance follow-up cancelled — ${propertyName}`,
    title: 'Maintenance follow-up cancelled',
    preheader: 'Scheduled follow-up will not occur',
    heroLabel: 'Visit update',
    line: (when, property) =>
      `The maintenance follow-up scheduled for ${when} at ${property} has been cancelled.`,
    reschedule: 'We will send a new notice if the visit is rescheduled.',
    inAppTitle: 'Maintenance follow-up cancelled',
    inAppBody: (when) =>
      `The maintenance follow-up scheduled for ${when || 'your room'} was cancelled. We will notify you if rescheduled.`,
    notificationType: 'maintenance_followup_cancelled',
  },
  vacant_showing: {
    subject: (propertyName) => `Room showing cancelled — ${propertyName}`,
    title: 'Vacant room showing cancelled',
    preheader: 'Scheduled showing will not occur',
    heroLabel: 'Showing update',
    line: (when, property) =>
      `The vacant room showing scheduled for ${when} at ${property} has been cancelled.`,
    reschedule: 'We will send a new notice if a showing is rescheduled.',
    inAppTitle: 'Room showing cancelled',
    inAppBody: (when) =>
      `The vacant room showing scheduled for ${when || 'the property'} was cancelled. We will notify you if rescheduled.`,
    notificationType: 'vacant_showing_cancelled',
  },
};

function render({ tenantName, propertyName, plannedAtFormatted, roomLabels, noticeType = 'room_inspection' }) {
  const rooms = Array.isArray(roomLabels) ? roomLabels : [roomLabels];
  const roomText = rooms.filter(Boolean).join(', ');
  const when = plannedAtFormatted || 'the previously notified time';
  const meta = COPY[noticeType] || COPY.room_inspection;
  const subject = meta.subject(propertyName);

  const text = [
    `Hi ${tenantName},`,
    '',
    meta.line(when, propertyName),
    roomText ? `Affected area(s): ${roomText}` : '',
    '',
    meta.reschedule,
    '',
    BRAND.name,
  ].filter(Boolean).join('\n');

  const html = wrapEmail({
    title: meta.title,
    preheader: meta.preheader,
    accent: PALETTE.warning,
    accentBg: PALETTE.warningBg,
    heroEmoji: '📅',
    heroLabel: meta.heroLabel,
    bodyHtml: [
      paragraph([`Hi <strong>${escapeHtml(tenantName)}</strong>,`]),
      paragraph([escapeHtml(meta.line(when, propertyName))]),
      roomText ? paragraph([`Affected area(s): ${escapeHtml(roomText)}`]) : '',
      paragraph([meta.reschedule]),
    ].join(''),
  });

  return { html, text, subject, inAppTitle: meta.inAppTitle, inAppBody: meta.inAppBody(when), notificationType: meta.notificationType };
}

module.exports = { render, COPY };
