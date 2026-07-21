import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CreditCard, Banknote, Users, User, Zap, Mail, Footprints, ScrollText,
  DollarSign, FileText, AlertTriangle,
} from 'lucide-react';
import api from '@/api/axios';
import { useAuth } from '@/context/AuthContext';
import { canPreviewTenantPortal } from '@/utils/roles';
import StatCard from '@/components/ui/StatCard';
import Panel from '@/components/ui/Panel';
import ActionDock from '@/components/ui/ActionDock';
import ProgressRing from '@/components/ui/ProgressRing';
import MiniBarChart from '@/components/ui/MiniBarChart';
import { RecentActivitySnippet } from '@/pages/admin/AuditLogs';

function fmt(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n) || 0);
}

function hour() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function relLogin(iso) {
  if (!iso) return 'Never logged in';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function UrgencyBadge({ u }) {
  const map = {
    emergency: 'bg-red-100 text-red-700',
    high:      'bg-orange-100 text-orange-700',
    medium:    'bg-yellow-100 text-yellow-700',
    low:       'bg-slate-100 text-slate-500',
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[u] || map.low}`}>{u}</span>;
}

export default function AdminDashboardPage() {
  const { user, startImpersonation } = useAuth();
  const navigate = useNavigate();
  const canViewAsTenant = canPreviewTenantPortal(user?.role);
  const [data, setData] = useState({ properties: [], tenants: [], stats: null, maintenance: [], payments: [] });
  const [mortgage, setMortgage] = useState(null);
  const [oversight, setOversight] = useState(null);
  const [visitPayroll, setVisitPayroll] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.get('/api/properties'),
      api.get('/api/tenants?status=active'),
      api.get('/api/payments/manager?limit=6'),
      api.get('/api/maintenance?status=submitted'),
      api.get('/api/owner/mortgage/summary'),
      api.get('/api/owner/manager-oversight'),
      api.get('/api/site-visits/payroll'),
    ]).then(([pR, tR, payR, mR, mgR, oR, vpR]) => {
      setData({
        properties:  pR.status === 'fulfilled' ? (pR.value.data.properties || []) : [],
        tenants:     tR.status === 'fulfilled' ? (tR.value.data.tenants || []) : [],
        stats:       payR.status === 'fulfilled' ? payR.value.data.stats : null,
        payments:    payR.status === 'fulfilled' ? (payR.value.data.payments || []) : [],
        maintenance: mR.status === 'fulfilled' ? (mR.value.data.requests || []) : [],
      });
      setMortgage(mgR.status === 'fulfilled' ? mgR.value.data.summary : null);
      setOversight(oR.status === 'fulfilled' ? oR.value.data.snapshot : null);
      setVisitPayroll(vpR.status === 'fulfilled' ? vpR.value.data.payroll : null);
      setLoading(false);
    });
  }, []);

  const property = data.properties.find((p) => !/sunset|miami/i.test(`${p.name} ${p.city}`))
    ?? data.properties[0];
  const propertyLabel = property?.name ?? 'your portfolio';
  const totalUnits    = data.properties.reduce((s, p) => s + Number(p.unit_count || 0), 0);
  const occupiedUnits = data.properties.reduce((s, p) => s + Number(p.occupied_count || 0), 0);
  const occupancyPct  = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;
  const monthlyRent   = data.tenants.reduce((s, t) => s + Number(t.monthly_rent || 0), 0);
  const collected     = Number(data.stats?.this_month || 0);
  const collectPct    = monthlyRent > 0 ? Math.min(100, Math.round((collected / monthlyRent) * 100)) : 0;
  const name          = user?.firstName || 'Owner';
  const mgr           = oversight?.manager;
  const mgrName       = mgr?.name || 'Property manager';
  const oc            = oversight?.counts;
  const onboardGap    = oc?.onboarding_incomplete ?? 0;
  const offboardGap   = oc?.offboarding_incomplete ?? 0;
  const playbookDone  = oversight?.playbook?.completed ?? 0;
  const playbookTotal = oversight?.playbook?.total ?? 0;
  const oversightTitle = mgr ? `Manager oversight — ${mgrName}` : 'Manager oversight';

  return (
    <div className="stagger-section space-y-6">
      <div className="motion-intro flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">Good {hour()}, {name}</p>
          <p className="mt-0.5 text-lg font-semibold text-slate-900">
            {propertyLabel}
          </p>
        </div>
        <Link
          to="/manager"
          className="btn-motion inline-flex items-center justify-center rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700"
        >
          Manager tools →
        </Link>
      </div>

      <ActionDock
        portal="admin"
        actions={[
          { to: '/admin/finance',     label: 'My Bills',      icon: <CreditCard size={22} strokeWidth={2} /> },
          { to: '/manager/payments',  label: 'Rent Ledger',   icon: <Banknote size={22} strokeWidth={2} /> },
          { to: '/manager/tenants',   label: 'Tenants',       icon: <Users size={22} strokeWidth={2} /> },
          { to: '/admin/users',       label: 'Users',         icon: <User size={22} strokeWidth={2} /> },
          { to: '/manager/utilities', label: 'Utilities',     icon: <Zap size={22} strokeWidth={2} /> },
          { to: '/admin/portal-launch', label: 'Launch emails', icon: <Mail size={22} strokeWidth={2} /> },
          { to: '/admin/site-visits',   label: 'Boots on site', icon: <Footprints size={22} strokeWidth={2} /> },
          { to: '/admin/activity',      label: 'Activity log',  icon: <ScrollText size={22} strokeWidth={2} /> },
        ]}
      />

      {!loading && visitPayroll?.visitCount > 0 && !visitPayroll?.alreadyPaid && !visitPayroll?.processing && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-violet-950">
              Pay {visitPayroll.manager?.name || 'Konstantin'} — {visitPayroll.visitCount} site visit{visitPayroll.visitCount === 1 ? '' : 's'}
            </p>
            <p className="mt-1 text-xs text-violet-800">
              {fmt(visitPayroll.totalDollars ?? visitPayroll.totalCents / 100)} due for {visitPayroll.monthLabel}
              {visitPayroll.payoutBank?.linked
                ? ` · ${visitPayroll.payoutBank.institutionName} ····${visitPayroll.payoutBank.accountMask}`
                : ' · Zelle or bank on file in Boots on site'}
            </p>
          </div>
          <Link
            to="/admin/site-visits#pay-konstantin"
            className="btn-motion inline-flex shrink-0 items-center justify-center rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700"
          >
            Pay now →
          </Link>
        </div>
      )}

      <div className="stagger-grid grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Collected" value={loading ? null : fmt(collected)} sub={`${data.stats?.paid_count ?? 0}/${data.tenants.length} paid`} to="/manager/payments" icon={<DollarSign size={20} strokeWidth={2} />} tone="admin" loading={loading} />
        <StatCard label="Expected Rent" value={loading ? null : fmt(monthlyRent)} sub="Active leases" to="/manager/leases" icon={<FileText size={20} strokeWidth={2} />} tone="default" loading={loading} />
        <StatCard label="Open Items" value={loading ? null : data.maintenance.length + Number(data.stats?.failed_count || 0)} sub="Maintenance + failed pay" to="/manager/maintenance" icon={<AlertTriangle size={20} strokeWidth={2} />} tone="warning" loading={loading} />
      </div>

      <Panel title={oversightTitle}>
        {loading ? (
          <div className="space-y-4">
            <div className="h-4 w-48 skeleton rounded" />
            <div className="stagger-grid grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 skeleton rounded-xl" />)}
            </div>
          </div>
        ) : !oversight ? (
          <p className="text-sm text-slate-500">Manager oversight snapshot unavailable.</p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-600">
                {mgr ? (
                  <>
                    <span className="font-medium text-slate-900">{mgr.email}</span>
                    <span className="mx-2 text-slate-300">·</span>
                    Last login: {relLogin(mgr.last_login_at)}
                  </>
                ) : (
                  <span>No property manager account found for this organization.</span>
                )}
                {oversight.property?.name && (
                  <p className="mt-1 text-xs text-slate-500">
                    Portfolio focus: {oversight.property.name}
                    {oversight.property.city ? ` · ${oversight.property.city}` : ''}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to="/manager/maintenance" className="btn-motion rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-violet-300 hover:text-violet-700">Maintenance</Link>
                <Link to="/manager/messages" className="btn-motion rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-violet-300 hover:text-violet-700">Inbox</Link>
                <Link to="/manager/tenants?onboarding=incomplete" className="btn-motion rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-violet-300 hover:text-violet-700">Onboarding</Link>
                <Link to="/manager/payments" className="btn-motion rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-violet-300 hover:text-violet-700">Payments</Link>
              </div>
            </div>

            {playbookTotal > 0 && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-sm">
                <p className="font-semibold text-emerald-900">
                  Konstantin&apos;s playbook — {playbookDone}/{playbookTotal} steps done
                </p>
                <p className="mt-1 text-xs text-emerald-800">
                  Property manager move-in checklist for 743 A Ave.
                  <Link to="/admin/playbook" className="ml-1 font-semibold underline">Open playbook</Link>
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Recent maintenance</p>
                {oversight.recent?.maintenance?.length ? (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                    {oversight.recent.maintenance.map((m) => (
                      <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{m.title}</p>
                          <p className="text-xs text-slate-500">{m.property_name} · Unit {m.unit_number} · {m.status}</p>
                        </div>
                        <UrgencyBadge u={m.priority} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">No open maintenance requests</p>
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Inbox needing triage</p>
                {oversight.recent?.inbox_threads?.length ? (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                    {oversight.recent.inbox_threads.map((t) => (
                      <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{t.subject || '(no subject)'}</p>
                          <p className="text-xs text-slate-500">{t.tenant_name} · {t.property_name}</p>
                        </div>
                        <UrgencyBadge u={t.urgency} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-emerald-600">Inbox clear — no pending threads</p>
                )}
              </div>
            </div>

            {(onboardGap > 0 || offboardGap > 0 || oversight.optional?.utility_bills?.length > 0 || oversight.optional?.last_announcement) && (
              <div className="grid grid-cols-1 gap-4 text-sm text-slate-600 sm:grid-cols-3">
                {offboardGap > 0 && (
                  <div className="rounded-xl bg-rose-50 px-4 py-3">
                    <p className="font-semibold text-rose-900">Move-out offboarding</p>
                    <ul className="mt-2 space-y-1 text-xs text-rose-800">
                      {(oversight.recent?.offboarding_tenants || []).map((t) => (
                        <li key={t.id}>{t.first_name} {t.last_name} — {t.offboarding.completedCount}/{t.offboarding.totalSteps} steps</li>
                      ))}
                    </ul>
                  </div>
                )}
                {onboardGap > 0 && (
                  <div className="rounded-xl bg-amber-50 px-4 py-3">
                    <p className="font-semibold text-amber-900">Tenant onboarding</p>
                    <ul className="mt-2 space-y-1 text-xs text-amber-800">
                      {oversight.recent.onboarding_tenants.map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-2">
                          <span>{t.first_name} {t.last_name} — {t.checkin.completedCount}/{t.checkin.totalSteps} steps</span>
                          {canViewAsTenant && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await startImpersonation(t.id, '/admin');
                                  navigate('/tenant');
                                } catch (err) {
                                  window.dispatchEvent(new CustomEvent('api:toast', {
                                    detail: {
                                      message: err?.response?.data?.message || 'Could not open tenant preview.',
                                      variant: 'error',
                                    },
                                  }));
                                }
                              }}
                              className="shrink-0 font-semibold text-blue-700 hover:underline"
                            >
                              View as
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {oversight.optional?.last_announcement && (
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="font-semibold text-slate-900">Last announcement</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {oversight.optional.last_announcement.title || '(no title)'}
                      {' · '}
                      {new Date(oversight.optional.last_announcement.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                )}
                {(oc?.utility_bills_pending ?? 0) > 0 && (
                  <div className="rounded-xl bg-violet-50 px-4 py-3">
                    <p className="font-semibold text-violet-900">Utilities</p>
                    <p className="mt-1 text-xs text-violet-800">
                      {oc.utility_bills_pending} bill(s) need action
                      <Link to="/manager/utilities" className="ml-1 font-semibold underline">Open utilities</Link>
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Main column — activity feed */}
        <div className="space-y-6 lg:col-span-8">
          <Panel title="Active Tenants" actionTo="/manager/tenants" className="!p-0">
            <div className="-mx-5 -mb-5">
              {loading ? (
                <div className="space-y-2 p-5">{[1, 2, 3].map(i => <div key={i} className="h-14 skeleton" />)}</div>
              ) : data.tenants.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">No active tenants</p>
              ) : (
                <ul className="stagger-list divide-y divide-slate-100">
                  {data.tenants.map(t => (
                    <li key={t.id} className="flex items-center gap-4 px-5 py-4 transition hover:bg-slate-50">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-sm font-bold text-violet-700">
                        {t.first_name?.[0]}{t.last_name?.[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900">{t.first_name} {t.last_name}</p>
                        <p className="text-xs text-slate-500">Unit {t.unit_number} · {fmt(t.monthly_rent)}/mo</p>
                      </div>
                      {Number(t.outstanding_balance) > 0 ? (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                          {fmt(t.outstanding_balance)} due
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Current</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          <Panel title="Recent Payments" actionTo="/manager/payments" className="!p-0">
            <div className="-mx-5 -mb-5">
              {loading ? (
                <div className="space-y-2 p-5">{[1, 2, 3].map(i => <div key={i} className="h-12 skeleton" />)}</div>
              ) : !data.payments.length ? (
                <p className="py-10 text-center text-sm text-slate-400">No payments yet</p>
              ) : (
                <ul className="stagger-list divide-y divide-slate-100">
                  {data.payments.map(p => (
                    <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{p.tenant_name}</p>
                        <p className="text-xs text-slate-500">Unit {p.unit_number} · {p.status}</p>
                      </div>
                      <p className={`shrink-0 text-sm font-bold tabular-nums ${p.status === 'succeeded' ? 'text-emerald-600' : 'text-slate-700'}`}>
                        {fmt(p.amount)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        </div>

        {/* Right rail — property spotlight (Azmir-style) */}
        <div className="space-y-6 lg:col-span-4">
          <div className="hover-lift motion-pop overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 p-6 text-white shadow-lg">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Primary Property</p>
            <h2 className="mt-2 text-xl font-bold leading-snug">{property?.name ?? 'Property'}</h2>
            <p className="mt-1 text-sm text-white/75">
              {property ? `${property.city}${property.state ? `, ${property.state}` : ''}` : 'Norfolk, VA'}
            </p>
            <div className="mt-6 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/10 py-3">
                <p className="text-xl font-bold">{totalUnits || '—'}</p>
                <p className="text-[10px] text-white/70">Units</p>
              </div>
              <div className="rounded-xl bg-white/10 py-3">
                <p className="text-xl font-bold">{occupancyPct}%</p>
                <p className="text-[10px] text-white/70">Full</p>
              </div>
              <div className="rounded-xl bg-white/10 py-3">
                <p className="text-xl font-bold">{data.tenants.length}</p>
                <p className="text-[10px] text-white/70">Tenants</p>
              </div>
            </div>
          </div>

          <RecentActivitySnippet />

          <Panel title="Rent Collection">
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
              <ProgressRing
                percent={collectPct}
                colorClass="stroke-violet-500"
                sublabel="this month"
              />
              <div className="min-w-0 flex-1 space-y-4">
                <MiniBarChart
                  colorClass="bg-violet-500"
                  bars={[
                    { label: 'Expected', value: monthlyRent },
                    { label: 'Collected', value: collected },
                    { label: 'Remaining', value: Math.max(0, monthlyRent - collected) },
                  ]}
                />
                <p className="text-xs text-slate-400">
                  {data.stats?.failed_count
                    ? `${data.stats.failed_count} failed payment(s) need follow-up`
                    : 'All ACH payments processing normally'}
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="Mortgage" actionTo="/admin/finance">
            {loading ? (
              <div className="h-20 skeleton rounded-xl" />
            ) : !mortgage ? (
              <p className="text-sm text-slate-400">Import statements via npm run import:mortgage</p>
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-lg font-bold text-slate-900">{fmt(mortgage.monthly_payment)}/mo</p>
                <p className="text-slate-500">
                  Principal {fmt(mortgage.principal_balance)} · due {mortgage.due_date ?? '—'}
                </p>
                <p className="text-xs text-slate-400">Newrez · stmt {mortgage.statement_date}</p>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
