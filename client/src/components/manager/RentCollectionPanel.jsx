import React from 'react';

function mailtoLink(email, subject) {
  if (!email || !subject) return null;
  const q = new URLSearchParams();
  q.set('subject', subject);
  return `mailto:${email}?${q.toString()}`;
}

function TenantRow({ t }) {
  const href = mailtoLink(t.email, t.emailSubject);
  const badgeClass =
    t.status === 'up_to_date'
      ? 'bg-emerald-100 text-emerald-800'
      : t.status === 'partial'
        ? 'bg-orange-100 text-orange-800'
        : t.status === 'late' || t.status === 'collections'
          ? 'bg-red-100 text-red-800'
          : t.status === 'pending'
            ? 'bg-blue-100 text-blue-800'
            : 'bg-amber-100 text-amber-800';

  return (
    <li className="flex items-start gap-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-slate-900">{t.name}</p>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${badgeClass}`}>
            {t.statusLabel}
          </span>
          {t.unitLine ? <span className="text-xs text-slate-500">{t.unitLine}</span> : null}
          {t.needsRelink ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
              Bank relink
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-slate-600">{t.detail}</p>
      </div>
      <div className="shrink-0 text-right">
        {t.shouldEmail && href ? (
          <a href={href} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
            {t.emailHint || 'Email'}
          </a>
        ) : t.status === 'up_to_date' ? (
          <span className="text-xs font-medium text-emerald-700">No email</span>
        ) : t.status === 'pending' ? (
          <span className="text-xs font-medium text-slate-500">Wait</span>
        ) : (
          <span className="text-xs font-medium text-slate-500">No email yet</span>
        )}
      </div>
    </li>
  );
}

function Section({ title, tone, tenants, empty }) {
  if (!tenants?.length) {
    if (empty) return <p className="py-3 text-sm text-slate-500">{empty}</p>;
    return null;
  }
  const border =
    tone === 'late'
      ? 'border-red-200'
      : tone === 'partial'
        ? 'border-orange-200'
        : tone === 'ok'
          ? 'border-emerald-200'
          : tone === 'pending'
            ? 'border-blue-200'
            : 'border-amber-200';
  return (
    <div className={`rounded-lg border ${border} bg-white/80`}>
      <h4 className="border-b border-inherit px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-600">
        {title}
      </h4>
      <ul className="divide-y divide-slate-100 px-3">
        {tenants.map((t) => (
          <TenantRow key={t.tenantId || t.name} t={t} />
        ))}
      </ul>
    </div>
  );
}

/** Staff rent roster: up to date vs late, with email hints (owner + manager). */
export default function RentCollectionPanel({ data, loading }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="h-24 skeleton rounded-lg" />
      </div>
    );
  }
  if (!data?.summary?.total && !data?.collections?.length) {
    return null;
  }

  const { monthLabel, groups, summary } = data;

  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50/80 to-white p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">Rent this month — {monthLabel}</h3>
        <p className="text-sm text-slate-600">
          <span className="font-medium text-emerald-700">{summary.up_to_date} up to date</span>
          {summary.partial > 0 && (
            <>
              {' · '}
              <span className="font-medium text-orange-700">{summary.partial} partial</span>
            </>
          )}
          {summary.late > 0 && (
            <>
              {' · '}
              <span className="font-medium text-red-700">{summary.late} late</span>
            </>
          )}
          {summary.collections > 0 && (
            <>
              {' · '}
              <span className="font-medium text-red-800">{summary.collections} collections</span>
            </>
          )}
          {summary.email_count > 0 && (
            <>
              {' · '}
              <span className="font-medium text-indigo-700">email {summary.email_count}</span>
            </>
          )}
          {summary.needs_relink > 0 && (
            <>
              {' · '}
              <span className="font-medium text-amber-700">{summary.needs_relink} bank relink</span>
            </>
          )}
        </p>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Green = full rent paid. Orange = partial (shows paid vs still owed). Red = late. Blue = ACH or Cash App processing. Amber = grace, no email yet.
      </p>

      <div className="mt-4 grid gap-3 grid-cols-1 lg:grid-cols-2">
        {summary.total > 0 && (
          <>
            <Section
              title={`Up to date (${groups.upToDate.length})`}
              tone="ok"
              tenants={groups.upToDate}
              empty="No one has paid yet this month."
            />
            <Section
              title={`Partial payment (${groups.partial?.length ?? 0})`}
              tone="partial"
              tenants={groups.partial}
              empty={null}
            />
            <Section
              title={`Late — email tenant (${groups.late.length})`}
              tone="late"
              tenants={groups.late}
              empty="Nobody is late."
            />
          </>
        )}
        {(groups.collections?.length > 0) && (
          <div className="lg:col-span-2">
            <Section
              title={`Collections — former tenants (${groups.collections.length})`}
              tone="late"
              tenants={groups.collections}
              empty={null}
            />
          </div>
        )}
        {(groups.pending.length > 0 || groups.due.length > 0) && (
          <div className="lg:col-span-2 grid gap-3 sm:grid-cols-2">
            <Section title={`Processing (${groups.pending.length})`} tone="pending" tenants={groups.pending} />
            <Section title={`Due soon — no email yet (${groups.due.length})`} tone="due" tenants={groups.due} />
          </div>
        )}
      </div>
    </div>
  );
}
