/**
 * Pure manager-playbook insight builders (no DB).
 * Used by manager-playbook-insights.service.js and unit tests.
 */

function insight(level, headline, rows = []) {
  return { level, headline, rows: rows.slice(0, 8) };
}

function row(label, detail, status = 'info', extra = {}) {
  return { label, detail: detail || undefined, status, ...extra };
}

function onboardingRows(roster, stepKey, missingLabel, emailSubject) {
  const missing = roster.filter((t) => !t.checkin[stepKey]);
  if (!missing.length) {
    return insight('ok', 'All active tenants completed this step.');
  }
  const rows = missing.map((t) =>
    row(t.name, t.unitLine, 'warn', {
      email: t.email,
      emailSubject,
      emailHint: 'Send reminder',
    })
  );
  return insight(
    'action',
    `${missing.length} tenant${missing.length === 1 ? '' : 's'} still need${missing.length === 1 ? 's' : ''} this: ${missingLabel}.`,
    rows
  );
}

function buildRentInsight(roster) {
  const { monthLabel, tenants, groups, summary } = roster;

  if (!summary.total) {
    return insight('ok', 'No active leases on your properties.');
  }

  const mapTenant = (t) =>
    row(t.name, `${t.unitLine ? `${t.unitLine} · ` : ''}${t.detail}`, t.rowStatus, {
      email: t.email,
      emailSubject: t.emailSubject,
      emailHint: t.emailHint,
      shouldEmail: t.shouldEmail,
      statusLabel: t.statusLabel,
    });

  const rentGroups = {
    upToDate: groups.upToDate.map(mapTenant),
    partial: groups.partial.map(mapTenant),
    late: groups.late.map(mapTenant),
    pending: groups.pending.map(mapTenant),
    due: groups.due.map(mapTenant),
    collections: [],
  };

  let level = 'ok';
  let headline = `${summary.up_to_date} of ${summary.total} up to date for ${monthLabel}.`;
  if (summary.late > 0 || summary.partial > 0) {
    level = summary.late > 0 ? 'action' : 'watch';
    const bits = [`${summary.up_to_date} up to date`];
    if (summary.partial > 0) bits.push(`${summary.partial} partial`);
    if (summary.late > 0) bits.push(`${summary.late} late`);
    headline = bits.join(' · ');
    if (summary.email_count > 0) {
      headline += ` · email ${summary.email_count} tenant${summary.email_count === 1 ? '' : 's'}`;
    }
  } else if (summary.pending > 0 || summary.due > 0) {
    level = 'watch';
    headline = `${summary.up_to_date} up to date · ${summary.pending} processing · ${summary.due} in grace (no email yet)`;
  }

  const rows = [
    ...rentGroups.late,
    ...rentGroups.partial,
    ...rentGroups.due,
    ...rentGroups.pending,
    ...rentGroups.upToDate,
  ];

  return { ...insight(level, headline, rows), rentGroups, summary };
}

function buildUtilitiesInsight(bills, tenantOwed) {
  const draftBills = bills.filter((b) => b.status === 'draft');
  const notifyBills = bills.filter((b) => b.status === 'notified');
  const rows = [];

  for (const b of draftBills) {
    rows.push(
      row(
        `${b.service_type || 'Utility'} bill`,
        `${b.property_name || 'Property'} · $${Number(b.total_amount || 0).toFixed(2)} — draft, notify tenants`,
        'warn'
      )
    );
  }
  for (const b of notifyBills.slice(0, 3)) {
    rows.push(
      row(
        `${b.service_type || 'Utility'} — notified`,
        `$${Number(b.total_amount || 0).toFixed(2)} · ready to charge after dispute window`,
        'info'
      )
    );
  }
  for (const t of tenantOwed) {
    const disputed = Number(t.disputed_count || 0) > 0;
    const owed = Number(t.owed || 0);
    let detail = owed > 0 ? `Owes $${owed.toFixed(2)} utility` : 'Utility dispute open';
    if (disputed) detail += ' · review dispute';
    rows.push(
      row(t.name, detail, disputed ? 'danger' : 'warn', {
        email: t.email,
        emailSubject: 'Utility bill share — 743 A Ave',
        emailHint: disputed ? 'Resolve dispute' : 'Email tenant',
      })
    );
  }

  if (!rows.length) {
    return insight('ok', 'No draft utility bills or outstanding tenant shares.');
  }

  const parts = [];
  if (draftBills.length) parts.push(`${draftBills.length} draft bill${draftBills.length === 1 ? '' : 's'}`);
  if (tenantOwed.length) parts.push(`${tenantOwed.length} tenant${tenantOwed.length === 1 ? '' : 's'} owe utility`);
  return insight('action', parts.join(' · ') || 'Utility work in progress.', rows);
}

module.exports = {
  insight,
  row,
  onboardingRows,
  buildRentInsight,
  buildUtilitiesInsight,
};
