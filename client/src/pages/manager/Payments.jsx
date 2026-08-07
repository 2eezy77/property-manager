import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Banknote, Clock, AlertTriangle, CheckCircle2, XCircle, ChevronDown,
} from 'lucide-react';
import api from '@/api/axios';
import StatCard from '@/components/ui/StatCard';
import PageIntro from '@/components/ui/PageIntro';
import TableScroll from '@/components/ui/TableScroll';
import RentCollectionPanel from '@/components/manager/RentCollectionPanel';
import { apiErrorMessage } from '@/utils/apiErrorMessage';

function showToast(message, variant = 'error') {
  window.dispatchEvent(new CustomEvent('api:toast', { detail: { message, variant } }));
}

function fmt(ts) { return ts ? new Date(ts).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}) : '—'; }
function fmtPeriod(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString([], { month: 'short', year: 'numeric' });
}
function fmtMoney(v) { return v != null ? '$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2}) : '—'; }

function paymentMethodLabel(p) {
  if (p.source === 'cash_app_import') return 'Cash App (archived off-app)';
  if (p.source === 'stripe_cashapp') return 'Cash App Pay';
  if (p.payment_method) {
    const base = METHOD_LABEL[p.payment_method] || p.payment_method;
    return p.partial_rent === 'true' ? `${base} (partial)` : base;
  }
  if (p.stripe_payment_intent_id) return 'Bank (ACH)';
  if (p.status === 'succeeded') return 'ACH';
  return '—';
}

const STATUS_META = {
  succeeded:  { label:'Succeeded', color:'bg-green-100 text-green-700' },
  failed:     { label:'Failed',    color:'bg-red-100 text-red-600' },
  pending:    { label:'Pending',   color:'bg-yellow-100 text-yellow-700' },
  processing: { label:'Processing',color:'bg-blue-100 text-blue-700' },
  refunded:   { label:'Refunded',  color:'bg-gray-100 text-gray-500' },
};

const TYPE_LABEL = { rent:'Rent', late_fee:'Late Fee', security_deposit:'Security Deposit', utility:'Utility', other:'Other' };

const METHOD_LABEL = {
  cash_app: 'Cash App', check: 'Check', zelle: 'Zelle', venmo: 'Venmo',
  wire: 'Wire', cash: 'Cash', other: 'Other',
};

function monthKeyFromDate(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonthKey() {
  return monthKeyFromDate(new Date());
}

function monthLabelFromKey(key) {
  if (!key || key === 'unknown') return 'Unknown period';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Prefer billing period_start so rent lands in the right month section. */
function paymentMonthKey(p) {
  return monthKeyFromDate(p.period_start) || monthKeyFromDate(p.paid_at) || monthKeyFromDate(p.created_at) || 'unknown';
}

function groupPaymentsByMonth(rows) {
  const map = new Map();
  for (const p of rows || []) {
    const key = paymentMonthKey(p);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, payments]) => {
      const succeeded = payments.filter((p) => p.status === 'succeeded');
      const collected = succeeded.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      return {
        key,
        label: monthLabelFromKey(key),
        payments,
        count: payments.length,
        collected,
        isCurrent: key === currentMonthKey(),
      };
    });
}

const HEALTH_ICON = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle };
function healthGlyph(status) {
  const I = HEALTH_ICON[status];
  return I ? <I size={14} strokeWidth={2} /> : <span className="font-mono text-xs">?</span>;
}

function PaymentHealthPanel({ report, onClose }) {
  if (!report) return null;
  const tone = {
    pass: 'text-emerald-700',
    warn: 'text-amber-700',
    fail: 'text-red-700',
  };
  const stripeSection = report.stripe;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Payment stack health</h2>
          <p className="text-sm text-slate-500">
            {report.ok ? 'All critical checks passed.' : 'Fix failed items before go-live rent collection.'}
            {' '}
            Pass {report.summary.pass} · Warn {report.summary.warn} · Fail {report.summary.fail}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-800">
          Dismiss
        </button>
      </div>
      {stripeSection?.actions?.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-semibold text-amber-900">Stripe actions</p>
          <ul className="mt-2 space-y-2">
            {stripeSection.actions.map((a) => (
              <li key={a.id} className="text-amber-900">
                <span className="inline-flex align-middle">{healthGlyph(a.status)}</span>{' '}
                {a.message}
                {a.fix && <p className="mt-0.5 text-xs text-amber-800">{a.fix}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
        {report.checks.map((c) => (
          <li key={c.id} className={`rounded-lg bg-slate-50 px-3 py-2 ${tone[c.status] || 'text-slate-700'}`}>
            <span className="mr-2 inline-flex align-middle">{healthGlyph(c.status)}</span>
            {c.message}
            {c.fix && <p className="mt-1 text-xs text-slate-600">{c.fix}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaymentRow({ p }) {
  const meta = STATUS_META[p.status] || { label: p.status, color: 'bg-gray-100 text-gray-500' };
  const method = paymentMethodLabel(p);
  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3">
        <p className="font-medium text-gray-800">{p.tenant_name}</p>
        <p className="text-xs text-gray-400">{p.tenant_email}</p>
      </td>
      <td className="px-4 py-3 text-gray-500">
        {p.property_name}<br /><span className="text-xs">Unit {p.unit_number}</span>
      </td>
      <td className="px-4 py-3 font-semibold text-gray-800">{fmtMoney(p.amount)}</td>
      <td className="px-4 py-3 text-gray-500">{TYPE_LABEL[p.payment_type] || p.payment_type}</td>
      <td className="px-4 py-3 text-gray-500">
        <p>{method}</p>
        {p.external_reference && (
          <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[12rem]" title={p.external_reference}>{p.external_reference}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span>
        {p.status === 'processing' && (
          <p className="mt-0.5 text-xs text-blue-600">ACH settling</p>
        )}
        {p.status === 'failed' && p.failure_reason && (
          <p
            className="mt-0.5 text-xs text-red-500 max-w-[12rem] truncate"
            title={p.failure_reason}
          >
            {/customer declined/i.test(p.failure_reason)
              ? 'Cancelled before finish'
              : /superseded|duplicate import/i.test(p.failure_reason)
                ? 'Replaced / duplicate'
                : p.failure_reason}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-gray-400">{fmtPeriod(p.period_start)}</td>
      <td className="px-4 py-3 text-xs text-gray-400">{fmt(p.paid_at || p.created_at)}</td>
    </tr>
  );
}

function MonthPaymentsTable({ payments }) {
  return (
    <TableScroll className="portal-table">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {['Tenant', 'Property', 'Amount', 'Type', 'Method', 'Status', 'Period', 'Date'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {payments.map((p) => (
            <PaymentRow key={p.id} p={p} />
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function MonthSection({ month, expanded, onToggle }) {
  return (
    <section
      className={`rounded-xl border bg-white overflow-hidden ${
        month.isCurrent ? 'border-indigo-200 shadow-sm' : 'border-gray-200'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition ${
          month.isCurrent ? 'bg-indigo-50/60' : 'bg-slate-50/80 hover:bg-slate-50'
        }`}
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{month.label}</h3>
            {month.isCurrent && (
              <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Current
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {month.count} payment{month.count === 1 ? '' : 's'}
            {' · '}
            {fmtMoney(month.collected)} succeeded
          </p>
        </div>
        <ChevronDown
          size={18}
          strokeWidth={2}
          className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-gray-100">
          <MonthPaymentsTable payments={month.payments} />
        </div>
      )}
    </section>
  );
}

export default function ManagerPayments() {
  const [payments, setPayments] = useState([]);
  const [stats, setStats]       = useState(null);
  const [tenants, setTenants]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType]     = useState('');
  const [filterTenant, setFilterTenant] = useState('');
  const [page, setPage]         = useState(1);
  const [hasMore, setHasMore]   = useState(false);
  const [runningBilling, setRunningBilling] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthReport, setHealthReport] = useState(null);
  const [rentStatus, setRentStatus] = useState(null);
  const [rentStatusLoading, setRentStatusLoading] = useState(true);
  const [expandedMonths, setExpandedMonths] = useState(() => new Set([currentMonthKey()]));
  const limit = 100;

  useEffect(() => {
    api.get('/api/tenants?status=active')
      .then(({ data }) => setTenants(data.tenants || []))
      .catch(() => {});
    api.get('/api/payments/rent-status')
      .then(({ data }) => setRentStatus(data))
      .catch(() => {})
      .finally(() => setRentStatusLoading(false));
  }, []);

  useEffect(() => { setPage(1); }, [filterStatus, filterType, filterTenant]);

  const load = useCallback(async (pageNum = 1, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterType)   params.set('payment_type', filterType);
      if (filterTenant) params.set('tenant_id', filterTenant);
      params.set('page', pageNum);
      params.set('limit', limit);
      const { data } = await api.get(`/api/payments/manager?${params}`);
      const rows = data.payments || [];
      setPayments(prev => append ? [...prev, ...rows] : rows);
      setStats(data.stats || null);
      setHasMore(rows.length === limit && pageNum < (data.pagination?.pages ?? 1));
      if (!append) {
        setExpandedMonths(new Set([currentMonthKey()]));
      }
    } catch(e) { console.error(e); } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filterStatus, filterType, filterTenant]);

  useEffect(() => { load(1, false); }, [load]);

  useEffect(() => {
    if (page > 1) load(page, true);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const months = useMemo(() => groupPaymentsByMonth(payments), [payments]);

  function toggleMonth(key) {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function runBilling() {
    setRunningBilling(true);
    try {
      const { data } = await api.post('/api/payments/run-billing', {}, { skipGlobalError: true });
      const parts = [];
      if (data.invoices != null) parts.push(`${data.invoices} invoice(s)`);
      if (data.fees != null) parts.push(`${data.fees} late fee(s)`);
      showToast(parts.length ? `Billing run complete: ${parts.join(', ')}.` : 'Billing run complete.', 'success');
      setPage(1);
      load(1, false);
      api.get('/api/payments/rent-status').then(({ data }) => setRentStatus(data)).catch(() => {});
    } catch (err) {
      showToast(apiErrorMessage(err, 'Billing run failed.'));
    } finally {
      setRunningBilling(false);
    }
  }

  async function runPaymentHealth() {
    setHealthLoading(true);
    try {
      const { data } = await api.get('/api/payments/health', { skipGlobalError: true });
      setHealthReport(data);
      showToast(
        data.ok
          ? 'Payment stack healthy — Stripe, Plaid, and webhooks OK.'
          : `${data.summary.fail} critical issue(s) — review health panel.`,
        data.ok ? 'success' : 'error'
      );
    } catch (err) {
      showToast(apiErrorMessage(err, 'Payment health check failed.'));
    } finally {
      setHealthLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageIntro
        subtitle="Rent collection and payment history for your properties. Tenants pay in the portal (ACH, card, or Cash App Pay) — off-app Cash App is disabled."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={runBilling}
              disabled={runningBilling}
              className="rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50 disabled:opacity-50"
            >
              {runningBilling ? 'Running billing…' : 'Run billing'}
            </button>
            <button
              type="button"
              onClick={runPaymentHealth}
              disabled={healthLoading}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              {healthLoading ? 'Checking…' : 'Payment health'}
            </button>
          </div>
        }
      />

      {healthReport && (
        <PaymentHealthPanel report={healthReport} onClose={() => setHealthReport(null)} />
      )}

      <RentCollectionPanel data={rentStatus} loading={rentStatusLoading} />

      {!rentStatusLoading && rentStatus?.summary?.needs_relink > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {rentStatus.summary.needs_relink} tenant{rentStatus.summary.needs_relink === 1 ? '' : 's'} need
          {' '}to reconnect a bank in Tenant → Payments before ACH can run.
        </p>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="This Month" value={fmtMoney(stats.this_month)} sub="rent collected" icon={<Banknote size={20} strokeWidth={2} />} tone="manager" />
          <StatCard label="Outstanding" value={fmtMoney(stats.outstanding)} sub="unpaid balance" icon={<Clock size={20} strokeWidth={2} />} tone="warning" />
          <StatCard label="Failed" value={stats.failed_count ?? 0} sub="need follow-up" icon={<AlertTriangle size={20} strokeWidth={2} />} tone="danger" />
          <StatCard label="Tenants Paid" value={stats.paid_count ?? 0} sub="this month" icon={<CheckCircle2 size={20} strokeWidth={2} />} tone="success" />
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select value={filterTenant} onChange={e => setFilterTenant(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">All tenants</option>
          {tenants.map(t => (
            <option key={t.id} value={t.id}>
              {[t.first_name, t.last_name].filter(Boolean).join(' ')} — Unit {t.unit_number}
              {t.bank_link_status === 'needs_relink' ? ' — needs relink' : ''}
            </option>
          ))}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">All statuses</option>
          {Object.entries(STATUS_META).map(([v,m]) => <option key={v} value={v}>{m.label}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">All types</option>
          {Object.entries(TYPE_LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" /></div>
      ) : payments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="mb-3 flex justify-center text-slate-300"><Banknote size={40} strokeWidth={1.5} /></div>
          <p className="font-medium text-gray-700">No payments found</p>
          <p className="text-sm text-gray-400 mt-1">Payments appear here after tenants pay through the portal (ACH, card, or Cash App Pay).</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Grouped by billing month. Current month is open; older months stay collapsed — tap a month to expand.
          </p>
          {months.map((month) => (
            <MonthSection
              key={month.key}
              month={month}
              expanded={expandedMonths.has(month.key)}
              onToggle={() => toggleMonth(month.key)}
            />
          ))}
          {hasMore && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setPage(p => p + 1)}
                disabled={loadingMore}
                className="text-sm text-indigo-600 hover:underline disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more history'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
