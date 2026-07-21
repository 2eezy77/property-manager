/**
 * Email template registry + dev preview helpers (no SMTP).
 */

const rentDue = require('./rentDue');
const rentOverdue = require('./rentOverdue');
const lateFeeApplied = require('./lateFeeApplied');
const lateFeeAppliedStaff = require('./lateFeeAppliedStaff');
const paymentSucceeded = require('./paymentSucceeded');
const paymentFailed = require('./paymentFailed');
const paymentSucceededStaff = require('./paymentSucceededStaff');
const paymentFailedStaff = require('./paymentFailedStaff');
const maintenanceCreated = require('./maintenanceCreated');
const maintenanceCreatedStaff = require('./maintenanceCreatedStaff');
const maintenanceStatus = require('./maintenanceStatus');
const maintenanceStatusStaff = require('./maintenanceStatusStaff');
const maintenanceBill = require('./maintenanceBill');
const maintenanceBillStaff = require('./maintenanceBillStaff');
const utilityBillNotify = require('./utilityBillNotify');
const announcement = require('./announcement');
const portalLaunch = require('./portalLaunch');
const tenantPortalCredentials = require('./tenantPortalCredentials');
const tenantPasswordChangedStaff = require('./tenantPasswordChangedStaff');

const SAMPLE = {
  tenantName: 'Stone Buckley',
  tenantEmail: 'buckleystone1@gmail.com',
  monthlyRent: 900,
  lateFeeAmount: 50,
  utilityShare: 42.5,
  amount: 900,
  unitLabel: 'Unit 2',
  unitNumber: '2',
  propertyName: '743 A Ave',
  dueDate: '2026-06-01',
  gracePeriodDays: 5,
  daysOverdue: 7,
  paymentId: '00000000-0000-4000-8000-000000000001',
  lateFeeId: '00000000-0000-4000-8000-000000000002',
  failureReason: 'Insufficient funds',
  paymentType: 'rent',
  title: 'Kitchen sink leaking',
  priority: 'high',
  oldStatus: 'open',
  newStatus: 'in_progress',
  statusLabel: 'in progress',
  scheduledAt: '2026-06-10T14:00:00Z',
  note: 'Plumber scheduled for Tuesday afternoon.',
  serviceType: 'electric',
  periodStart: '2026-05-01',
  periodEnd: '2026-05-31',
  senderName: 'Konstantin Hazlett',
  body: 'Reminder: trash pickup is every Thursday. Please keep bins at the curb by 7 AM.',
  announcementTitle: 'Trash pickup reminder',
  isEmergency: false,
};

/** @type {Record<string, { label: string; category: string; sampleSubject: string; render: (data: object) => { html: string; text: string } }>} */
const TEMPLATES = {
  rentDue: {
    label: 'Rent due reminder',
    category: 'Payments',
    sampleSubject: 'Rent due June 1, 2026 - $900.00',
    render: (d) => rentDue.render(d),
  },
  rentOverdue: {
    label: 'Rent overdue',
    category: 'Payments',
    sampleSubject: 'Overdue rent - $900.00',
    render: (d) => rentOverdue.render(d),
  },
  lateFeeApplied: {
    label: 'Late fee applied (tenant)',
    category: 'Payments',
    sampleSubject: 'Late fee applied - $50.00',
    render: (d) => lateFeeApplied.render(d),
  },
  lateFeeAppliedStaff: {
    label: 'Late fee applied (staff)',
    category: 'Payments',
    sampleSubject: 'Late fee applied - Stone Buckley',
    render: (d) => lateFeeAppliedStaff.render(d),
  },
  paymentSucceeded: {
    label: 'Payment confirmed - rent',
    category: 'Payments',
    sampleSubject: 'Rent payment confirmed - $900.00',
    render: (d) => paymentSucceeded.render({ ...d, paymentType: 'rent' }),
  },
  paymentSucceededUtility: {
    label: 'Payment confirmed - utility',
    category: 'Payments',
    sampleSubject: 'Utility payment confirmed - $42.50',
    render: (d) =>
      paymentSucceeded.render({
        ...d,
        paymentType: 'utility',
        amount: 42.5,
      }),
  },
  paymentFailed: {
    label: 'Payment failed - rent',
    category: 'Payments',
    sampleSubject: 'Rent payment failed - $900.00',
    render: (d) => paymentFailed.render({ ...d, paymentType: 'rent' }),
  },
  paymentFailedUtility: {
    label: 'Payment failed - utility',
    category: 'Payments',
    sampleSubject: 'Utility payment failed - $42.50',
    render: (d) =>
      paymentFailed.render({
        ...d,
        paymentType: 'utility',
        amount: 42.5,
      }),
  },
  paymentSucceededStaff: {
    label: 'Payment received (staff)',
    category: 'Payments',
    sampleSubject: 'Stone Buckley - rent payment received',
    render: (d) => paymentSucceededStaff.render(d),
  },
  paymentFailedStaff: {
    label: 'Payment failed (staff)',
    category: 'Payments',
    sampleSubject: 'Payment failed - Stone Buckley',
    render: (d) => paymentFailedStaff.render(d),
  },
  maintenanceCreated: {
    label: 'Maintenance created (tenant)',
    category: 'Maintenance',
    sampleSubject: 'Maintenance request received',
    render: (d) => maintenanceCreated.render(d),
  },
  maintenanceCreatedStaff: {
    label: 'Maintenance created (staff)',
    category: 'Maintenance',
    sampleSubject: '[Maintenance] Kitchen sink leaking',
    render: (d) => maintenanceCreatedStaff.render(d),
  },
  maintenanceCreatedStaffEmergency: {
    label: 'Maintenance emergency (staff)',
    category: 'Maintenance',
    sampleSubject: '[Maintenance] EMERGENCY - No heat',
    render: (d) =>
      maintenanceCreatedStaff.render({
        ...d,
        title: 'No heat in unit',
        priority: 'emergency',
        isEmergency: true,
      }),
  },
  maintenanceStatus: {
    label: 'Maintenance status (tenant)',
    category: 'Maintenance',
    sampleSubject: 'Maintenance update - in progress',
    render: (d) => maintenanceStatus.render(d),
  },
  maintenanceStatusStaff: {
    label: 'Maintenance status (staff)',
    category: 'Maintenance',
    sampleSubject: 'Maintenance in progress',
    render: (d) => maintenanceStatusStaff.render(d),
  },
  maintenanceBill: {
    label: 'Maintenance charge (tenant)',
    category: 'Maintenance',
    sampleSubject: 'Charge for maintenance - $125.00',
    render: (d) => maintenanceBill.render({ ...d, amount: 125 }),
  },
  maintenanceBillStaff: {
    label: 'Maintenance charge (staff)',
    category: 'Maintenance',
    sampleSubject: 'Maintenance charge recorded',
    render: (d) => maintenanceBillStaff.render({ ...d, amount: 125 }),
  },
  utilityBillNotify: {
    label: 'Utility bill share (UC03)',
    category: 'Utilities',
    sampleSubject: 'Utility bill - electric',
    render: (d) => utilityBillNotify.render(d),
  },
  announcement: {
    label: 'Property announcement',
    category: 'Announcements',
    sampleSubject: 'Trash pickup reminder',
    render: (d) =>
      announcement.render({
        tenantName: d.tenantName,
        title: d.announcementTitle,
        body: d.body,
        senderName: d.senderName,
        propertyName: d.propertyName,
      }),
  },
  portalLaunchOwner: {
    label: 'Portal launch — owner',
    category: 'Onboarding',
    sampleSubject: 'Montero Rentals portal is live — utilities & rent',
    render: () => portalLaunch.renderOwner({ recipientName: 'Jose' }),
  },
  portalLaunchManager: {
    label: 'Portal launch — manager',
    category: 'Onboarding',
    sampleSubject: 'Your Montero Rentals manager portal — utilities & rent',
    render: () => portalLaunch.renderManager({ recipientName: 'Konstantin' }),
  },
  portalLaunchTenant: {
    label: 'Portal launch — tenant',
    category: 'Onboarding',
    sampleSubject: 'Your Montero Rentals tenant portal — rent & utilities',
    render: () =>
      portalLaunch.renderTenant({
        recipientName: 'Stone',
        unitLabel: 'Unit 2',
        loginEmail: 'buckleystone1@gmail.com',
        temporaryPassword: 'SamplePass1!',
        proratedElectric: false,
      }),
  },
  tenantPortalCredentials: {
    label: 'Portal login credentials',
    category: 'Onboarding',
    sampleSubject: 'Your Montero Rentals login — keep this email private',
    render: () =>
      tenantPortalCredentials.render({
        tenantName: 'Stone',
        email: 'buckleystone1@gmail.com',
        temporaryPassword: 'SamplePass1!',
        unitLabel: 'Unit 2',
        propertyName: '743 A Ave',
        role: 'tenant',
      }),
  },
  tenantPasswordChangedStaff: {
    label: 'Tenant changed password (staff)',
    category: 'Onboarding',
    sampleSubject: 'Tenant updated portal password — Stone Buckley',
    render: () =>
      tenantPasswordChangedStaff.render({
        tenantName: 'Stone Buckley',
        tenantEmail: 'buckleystone1@gmail.com',
        unitLabel: 'Unit 2',
        propertyName: '743 A Ave',
        changedAt: new Date(),
      }),
  },
};

function sampleDataFor(key) {
  const base = { ...SAMPLE, amount: SAMPLE.monthlyRent };

  if (key === 'lateFeeApplied' || key === 'lateFeeAppliedStaff') {
    base.amount = SAMPLE.lateFeeAmount;
  } else if (
    key === 'paymentSucceededUtility' ||
    key === 'paymentFailedUtility' ||
    key === 'utilityBillNotify'
  ) {
    base.amount = SAMPLE.utilityShare;
    if (key !== 'utilityBillNotify') base.paymentType = 'utility';
  }

  return base;
}

/** Render one template with sample data (for preview sends). */
function renderTemplateEmail(key) {
  const entry = TEMPLATES[key];
  if (!entry) return null;
  const data = sampleDataFor(key);
  const { html, text } = entry.render(data);
  return {
    key,
    label: entry.label,
    subject: entry.sampleSubject,
    html,
    text,
  };
}

function listTemplateKeys() {
  return Object.keys(TEMPLATES);
}

function renderPreview(key) {
  const entry = TEMPLATES[key];
  if (!entry) return null;
  const data = sampleDataFor(key);
  return {
    key,
    label: entry.label,
    category: entry.category,
    sampleSubject: entry.sampleSubject,
    ...entry.render(data),
  };
}

function renderAllPreviewsHtml() {
  const keys = listTemplateKeys();
  const blocks = keys
    .map((key) => {
      const { label, category, sampleSubject } = TEMPLATES[key];
      return `
    <article class="block" id="${key}">
      <header class="block-head">
        <span class="cat">${category}</span>
        <h2>${label}</h2>
        <p class="subj">${sampleSubject}</p>
        <code>${key}</code>
        <a class="solo" href="/api/dev/email-previews/${key}" target="_blank">Open alone ↗</a>
      </header>
      <iframe src="/api/dev/email-previews/${key}" title="${label}" loading="lazy"></iframe>
    </article>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>All email previews - Montero Rentals</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #e2e8f0; margin: 0; padding: 24px 16px 80px; color: #0f172a; }
    .top { max-width: 640px; margin: 0 auto 24px; text-align: center; }
    .top h1 { font-size: 22px; margin: 0 0 6px; }
    .top p { color: #64748b; font-size: 14px; margin: 0; }
    .top a { color: #4f46e5; }
    .block { max-width: 640px; margin: 0 auto 32px; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgb(0 0 0 / 8%); }
    .block-head { padding: 16px 20px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
    .cat { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
    .block-head h2 { margin: 4px 0 2px; font-size: 18px; }
    .subj { margin: 0; font-size: 13px; color: #475569; }
    code { font-size: 11px; background: #e2e8f0; padding: 2px 6px; border-radius: 4px; }
    .solo { float: right; font-size: 12px; font-weight: 600; }
    iframe { display: block; width: 100%; height: 520px; border: 0; background: #f1f5f9; }
  </style>
</head>
<body>
  <div class="top">
    <h1>All ${keys.length} email templates</h1>
    <p>Preview only · no mail sent · <a href="/api/dev/email-previews">Back to index</a></p>
  </div>
  ${blocks}
</body>
</html>`;
}

function renderPreviewIndexHtml() {
  const keys = listTemplateKeys();
  const byCategory = {};
  for (const key of keys) {
    const { category, label, sampleSubject } = TEMPLATES[key];
    if (!byCategory[category]) byCategory[category] = [];
    byCategory[category].push({ key, label, sampleSubject });
  }

  const sections = Object.entries(byCategory)
    .map(
      ([cat, items]) => `
    <section style="margin-bottom:32px;">
      <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin:0 0 12px;">${cat}</h2>
      <ul style="list-style:none;padding:0;margin:0;">
        ${items
          .map(
            (i) => `
          <li style="margin:0 0 8px;">
            <a href="/api/dev/email-previews/${i.key}" style="color:#4f46e5;font-weight:600;text-decoration:none;font-size:16px;">${i.label}</a>
            <span style="display:block;font-size:12px;color:#94a3b8;margin-top:2px;">${i.sampleSubject} · <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">${i.key}</code></span>
          </li>`
          )
          .join('')}
      </ul>
    </section>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Email previews - Montero Rentals</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f8fafc; margin: 0; padding: 40px 24px; color: #0f172a; }
    .wrap { max-width: 640px; margin: 0 auto; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    .meta { color: #64748b; font-size: 14px; margin-bottom: 32px; }
    .badge { display: inline-block; background: #ecfdf5; color: #059669; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Montero Rentals - email templates</h1>
    <p class="meta">${keys.length} templates · preview only · no mail sent <span class="badge">DEV</span></p>
    <p class="meta" style="margin-top:12px;"><a href="/api/dev/email-previews/all" style="font-weight:600;">View all ${keys.length} stacked ↓</a></p>
    ${sections}
  </div>
</body>
</html>`;
}

function isEmailPreviewAllowed() {
  return process.env.NODE_ENV !== 'production' || process.env.EMAIL_PREVIEW === '1';
}

module.exports = {
  TEMPLATES,
  listTemplateKeys,
  renderPreview,
  renderTemplateEmail,
  sampleDataFor,
  renderPreviewIndexHtml,
  renderAllPreviewsHtml,
  isEmailPreviewAllowed,
  rentDue,
  rentOverdue,
  lateFeeApplied,
  lateFeeAppliedStaff,
  paymentSucceeded,
  paymentFailed,
  paymentSucceededStaff,
  paymentFailedStaff,
  maintenanceCreated,
  maintenanceCreatedStaff,
  maintenanceStatus,
  maintenanceStatusStaff,
  maintenanceBill,
  maintenanceBillStaff,
  utilityBillNotify,
  announcement,
};
