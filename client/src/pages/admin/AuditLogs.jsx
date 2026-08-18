import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import api from '@/api/axios';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import PageHeader from '@/components/ui/PageHeader';
import Panel from '@/components/ui/Panel';

const CATEGORIES = [
  ['', 'All'],
  ['payments', 'Payments'],
  ['utilities', 'Utilities'],
  ['visits', 'Visits'],
  ['leases', 'Leases'],
];

const WHEN_OPTIONS = [
  ['7d', '7 days'],
  ['24h', '24 hours'],
  ['30d', '30 days'],
  ['', 'All time'],
];

const ROLE_OPTIONS = [
  ['', 'Everyone'],
  ['property_manager', 'Manager'],
  ['tenant', 'Tenants'],
  ['owner', 'Owners'],
];

function fmtWhen(iso) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function actorLabel(row) {
  const n = [row.actor_first_name, row.actor_last_name].filter(Boolean).join(' ');
  return n || row.actor_email || 'Unknown';
}

function impersonatorLabel(row) {
  const n = [row.imp_first_name, row.imp_last_name].filter(Boolean).join(' ');
  return n || 'Owner';
}

function roleLabel(role) {
  if (role === 'property_manager') return 'Manager';
  if (role === 'tenant') return 'Tenant';
  if (role === 'owner') return 'Owner';
  return role || '';
}

function CategoryBadge({ cat }) {
  const colors = {
    auth: 'bg-slate-100 text-slate-700',
    utilities: 'bg-teal-50 text-teal-800',
    payments: 'bg-emerald-50 text-emerald-800',
    visits: 'bg-sky-50 text-sky-800',
    leases: 'bg-amber-50 text-amber-800',
    maintenance: 'bg-orange-50 text-orange-800',
    users: 'bg-violet-50 text-violet-800',
    communications: 'bg-indigo-50 text-indigo-800',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${colors[cat] || 'bg-gray-100 text-gray-600'}`}>
      {cat}
    </span>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        active ? 'bg-violet-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:border-violet-200'
      }`}
    >
      {children}
    </button>
  );
}

export default function ActivityLogPage() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('');
  const [since, setSince] = useState('7d');
  const [role, setRole] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  const [showSignIns, setShowSignIns] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (category) params.set('category', category);
      if (since) params.set('since', since);
      if (role) params.set('role', role);
      if (failedOnly) params.set('failed', '1');
      if (showSignIns) params.set('hideAuth', '0');
      const { data } = await api.get(`/api/owner/activity-log?${params}`);
      setLogs(data.logs || []);
      setTotal(data.total ?? 0);
      setPolicy(data.policy || null);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load activity log.'));
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [category, since, role, failedOnly, showSignIns]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        portal="admin"
        title="Activity log"
        subtitle="Paid charges and real portal changes — not sign-ins or payment starts."
        actions={(
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Refresh
          </button>
        )}
      />

      <Panel className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          {WHEN_OPTIONS.map(([v, l]) => (
            <FilterChip key={v || 'all'} active={since === v} onClick={() => setSince(v)}>{l}</FilterChip>
          ))}
          <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:block" />
          {CATEGORIES.map(([v, l]) => (
            <FilterChip key={v || 'all-types'} active={category === v} onClick={() => setCategory(v)}>{l}</FilterChip>
          ))}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600"
          >
            {ROLE_OPTIONS.map(([v, l]) => (
              <option key={v || 'everyone'} value={v}>{l}</option>
            ))}
          </select>
          <label className="ml-auto flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={failedOnly}
              onChange={(e) => setFailedOnly(e.target.checked)}
              className="rounded border-slate-300 text-violet-600"
            />
            Failed only
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showSignIns}
              onChange={(e) => setShowSignIns(e.target.checked)}
              className="rounded border-slate-300 text-violet-600"
            />
            Include sign-ins
          </label>
        </div>
      </Panel>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
        </div>
      ) : logs.length === 0 ? (
        <div className="portal-card p-10 text-center text-sm text-slate-500 space-y-2">
          <p>Nothing matches these filters yet.</p>
          <p className="text-xs">
            Try <strong>All time</strong> or turn on <strong>Include sign-ins</strong>.
          </p>
        </div>
      ) : (
        <div className="portal-card overflow-hidden !p-0">
          <p className="px-4 py-2 text-xs text-slate-500 border-b border-slate-100">
            Showing {logs.length} of {total} events (newest first)
          </p>
          <ul className="divide-y divide-slate-100">
            {logs.map((row) => (
              <li key={row.id} className="px-4 py-3 hover:bg-slate-50/80">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900 flex-1 min-w-0">
                    {row.summary}
                  </p>
                  <span className="text-xs text-slate-400 whitespace-nowrap">{fmtWhen(row.created_at)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <CategoryBadge cat={row.category} />
                  <span>{actorLabel(row)}</span>
                  {row.actor_role && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                      {roleLabel(row.actor_role)}
                    </span>
                  )}
                  {row.impersonator_user_id && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 font-medium">
                      Preview: {impersonatorLabel(row)}
                    </span>
                  )}
                  {row.status_code >= 400 && (
                    <span className="text-red-600 font-semibold">Failed</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Compact list for owner dashboard — outcomes only, no sign-in spam */
export function RecentActivitySnippet() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/owner/activity-log?limit=5&since=7d')
      .then(({ data }) => setLogs(data.logs || []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Panel
      title="Recent portal activity"
      actionTo="/admin/activity"
      actionLabel="Full log"
    >
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 skeleton rounded-lg" />)}</div>
      ) : logs.length === 0 ? (
        <p className="text-sm text-slate-500 py-4 text-center">
          No payments or portal changes this week yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 -mx-1">
          {logs.map((row) => (
            <li key={row.id} className="py-2.5 px-1">
              <p className="text-sm text-slate-800 line-clamp-2">{row.summary}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{fmtWhen(row.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
      <Link
        to="/admin/activity"
        className="mt-3 block text-center text-xs font-semibold text-violet-700 hover:underline"
      >
        Open activity log
      </Link>
    </Panel>
  );
}
