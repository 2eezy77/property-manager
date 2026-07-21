import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList, Wrench, MessageSquare, Banknote, Megaphone, Building2,
} from 'lucide-react';
import api from '@/api/axios';
import { useAuth } from '@/context/AuthContext';
import StatCard from '@/components/ui/StatCard';
import Panel from '@/components/ui/Panel';
import ActionDock from '@/components/ui/ActionDock';
import ProgressRing from '@/components/ui/ProgressRing';

function fmt(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n) || 0);
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

function hour() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

export default function ManagerDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState({ maintenance: [], threads: [], properties: [], stats: null, onboarding: [], offboarding: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.get('/api/maintenance?status=submitted'),
      api.get('/api/messages/inbox'),
      api.get('/api/properties'),
      api.get('/api/payments/manager?limit=1'),
      api.get('/api/tenants/onboarding?status=active&complete=false'),
      api.get('/api/tenants/offboarding?complete=false'),
    ]).then(([mR, tR, pR, payR, oR, obR]) => {
      setData({
        maintenance: mR.status === 'fulfilled' ? (mR.value.data.requests || []) : [],
        threads:     tR.status === 'fulfilled' ? (tR.value.data.threads || []) : [],
        properties:  pR.status === 'fulfilled' ? (pR.value.data.properties || []) : [],
        stats:       payR.status === 'fulfilled' ? payR.value.data.stats : null,
        onboarding:  oR.status === 'fulfilled' ? (oR.value.data.tenants || []) : [],
        offboarding: obR.status === 'fulfilled' ? (obR.value.data.tenants || []) : [],
      });
      setLoading(false);
    });
  }, []);

  const openMaint      = data.maintenance.length;
  const emergencyMaint = data.maintenance.filter(m => m.priority === 'emergency').length;
  const pendingThreads = data.threads.filter(t => t.triage_status === 'pending').length;
  const totalUnits     = data.properties.reduce((s, p) => s + Number(p.unit_count || 0), 0);
  const occupiedUnits  = data.properties.reduce((s, p) => s + Number(p.occupied_count || 0), 0);
  const occupancyPct   = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : null;
  const failedPayments = Number(data.stats?.failed_count || 0);
  const name           = user?.firstName || user?.first_name || 'Manager';

  const priorityMaint = data.maintenance.filter(m => ['emergency', 'high'].includes(m.priority)).slice(0, 5);

  return (
    <div className="stagger-section space-y-6">
      <div className="motion-intro">
        <p className="text-sm text-slate-500">Good {hour()}, {name}</p>
        <p className="mt-0.5 text-lg font-semibold text-slate-900">
          {openMaint + pendingThreads > 0
            ? `${openMaint + pendingThreads} item(s) need your attention today`
            : 'All clear — nothing urgent right now'}
        </p>
      </div>

      <ActionDock
        portal="manager"
        actions={[
          { to: '/manager/playbook',        label: 'Checklist',   icon: <ClipboardList size={22} strokeWidth={2} /> },
          { to: '/manager/maintenance',   label: 'Maintenance', icon: <Wrench size={22} strokeWidth={2} /> },
          { to: '/manager/messages',      label: 'Inbox',       icon: <MessageSquare size={22} strokeWidth={2} /> },
          { to: '/manager/payments',      label: 'Payments',    icon: <Banknote size={22} strokeWidth={2} /> },
          { to: '/manager/announcements', label: 'Announce',    icon: <Megaphone size={22} strokeWidth={2} /> },
        ]}
      />

      <div className="stagger-grid grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Maintenance" value={loading ? null : openMaint} sub={emergencyMaint > 0 ? `${emergencyMaint} emergency` : 'open requests'} to="/manager/maintenance" icon={<Wrench size={20} strokeWidth={2} />} tone={emergencyMaint > 0 ? 'danger' : 'manager'} loading={loading} />
        <StatCard label="Inbox" value={loading ? null : pendingThreads} sub="awaiting reply" to="/manager/messages" icon={<MessageSquare size={20} strokeWidth={2} />} tone={pendingThreads > 0 ? 'warning' : 'manager'} loading={loading} />
        <StatCard label="Collected" value={loading ? null : fmt(data.stats?.this_month)} sub={`${data.stats?.paid_count ?? 0} payments`} to="/manager/payments" icon={<Banknote size={20} strokeWidth={2} />} tone="manager" loading={loading} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="portal-card hover-lift motion-pop flex flex-col items-center justify-center p-6 lg:col-span-1">
          <ProgressRing
            percent={occupancyPct ?? 0}
            colorClass="stroke-emerald-500"
            label="Occupancy"
            sublabel={`${occupiedUnits}/${totalUnits} units`}
          />
          {!loading && failedPayments > 0 && (
            <p className="mt-4 text-center text-xs font-medium text-amber-600">
              {failedPayments} failed payment(s) this month
            </p>
          )}
        </div>

        <div className="space-y-6 lg:col-span-2">
        <Panel title="Tenant onboarding" actionTo="/manager/tenants" className="!p-0">
          <div className="-mx-5 -mb-5">
            {loading ? (
              <div className="space-y-2 p-5">{[1, 2].map(i => <div key={i} className="h-12 skeleton" />)}</div>
            ) : data.onboarding.length === 0 ? (
              <p className="py-8 text-center text-sm text-emerald-600 font-medium">All active tenants finished move-in checklist</p>
            ) : (
              <ul className="stagger-list divide-y divide-slate-100">
                {data.onboarding.map(t => (
                  <li key={t.id}>
                    <Link
                      to="/manager/tenants"
                      className="flex items-center justify-between gap-3 px-5 py-3.5 transition hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          {t.first_name} {t.last_name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {t.property_name}{t.unit_number ? ` · Unit ${t.unit_number}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                        {t.checkin?.completedCount ?? 0}/{t.checkin?.totalSteps ?? 5}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel title="Move-out offboarding" actionTo="/manager/tenants" className="!p-0">
          <div className="-mx-5 -mb-5">
            {loading ? (
              <div className="space-y-2 p-5">{[1, 2].map(i => <div key={i} className="h-12 skeleton" />)}</div>
            ) : data.offboarding.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No active move-out checklists</p>
            ) : (
              <ul className="stagger-list divide-y divide-slate-100">
                {data.offboarding.map(t => (
                  <li key={t.id}>
                    <Link
                      to="/manager/tenants"
                      className="flex items-center justify-between gap-3 px-5 py-3.5 transition hover:bg-rose-50/50"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          {t.first_name} {t.last_name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {t.property_name}{t.unit_number ? ` · Unit ${t.unit_number}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">
                        {t.offboarding?.completedCount ?? 0}/{t.offboarding?.totalSteps ?? 8}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel title="Priority Maintenance" actionTo="/manager/maintenance" className="!p-0">
          <div className="-mx-5 -mb-5">
            {loading ? (
              <div className="space-y-2 p-5">{[1, 2, 3].map(i => <div key={i} className="h-14 skeleton" />)}</div>
            ) : priorityMaint.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">No emergency or high-priority requests</p>
            ) : (
              <ul className="stagger-list divide-y divide-slate-100">
                {priorityMaint.map(m => (
                  <li key={m.id}>
                    <Link to="/manager/maintenance" className="flex items-start justify-between gap-3 px-5 py-4 transition hover:bg-slate-50">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{m.title}</p>
                        <p className="text-xs text-slate-500">{m.property_name} · Unit {m.unit_number}</p>
                      </div>
                      <UrgencyBadge u={m.priority} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel title="Inbox" actionTo="/manager/messages" className="!p-0">
          <div className="-mx-5 -mb-5">
            {loading ? (
              <div className="space-y-2 p-5">{[1, 2, 3].map(i => <div key={i} className="h-14 skeleton" />)}</div>
            ) : data.threads.slice(0, 5).length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">Inbox is clear</p>
            ) : (
              <ul className="stagger-list divide-y divide-slate-100">
                {data.threads.slice(0, 5).map(t => (
                  <li key={t.id}>
                    <Link to="/manager/messages" className="flex items-start justify-between gap-3 px-5 py-4 transition hover:bg-slate-50">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{t.subject || '(no subject)'}</p>
                        <p className="text-xs text-slate-500">{t.tenant_name} · {t.property_name}</p>
                      </div>
                      <UrgencyBadge u={t.urgency} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
        </div>
      </div>

      {!loading && data.properties.length > 0 && (
        <Panel title="Properties" actionTo="/manager/properties">
          <div className="stagger-grid grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.properties.map(p => (
              <Link
                key={p.id}
                to="/manager/properties"
                className="hover-lift flex items-center gap-4 rounded-2xl border border-slate-100 p-4 transition hover:border-emerald-200 hover:bg-emerald-50/40"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><Building2 size={22} strokeWidth={2} /></div>
                <div>
                  <p className="font-medium text-slate-900">{p.name}</p>
                  <p className="text-xs text-slate-500">{p.city}{p.state ? `, ${p.state}` : ''}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{p.occupied_count}/{p.unit_count} occupied</p>
                </div>
              </Link>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
