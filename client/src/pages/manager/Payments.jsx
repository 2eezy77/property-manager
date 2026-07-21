import React, { useState, useEffect, useCallback } from 'react';
import {
  Banknote, Clock, AlertTriangle, CheckCircle2, XCircle,
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
  if (p.payment_method) {
    const base = METHOD_LABEL[p.payment_method] || p.payment_method;
    return p.partial_rent === 'true' ? `${base} (partial)` : base;
  }
  if (p.source === 'cash_app_import' || p.source === 'stripe_cashapp') return 'Cash App';
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

const TYPE_LABEL = { rent:'Rent', late_fee:'Late Fee', security_deposit:'Security Deposit', other:'Other' };

const METHOD_LABEL = {
  cash_app: 'Cash App', check: 'Check', zelle: 'Zelle', venmo: 'Venmo',
  wire: 'Wire', cash: 'Cash', other: 'Other',
};

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
  const [syncingCashApp, setSyncingCashApp] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthReport, setHealthReport] = useState(null);
  const [rentStatus, setRentStatus] = useState(null);
  const [rentStatusLoading, setRentStatusLoading] = useState(true);
  const limit = 50;

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
    } catch(e) { console.error(e); } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filterStatus, filterType, filterTenant]);

  useEffect(() => { load(1, false); }, [load]);

  useEffect(() => {
    if (page > 1) load(page, true);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function syncCashApp() {
    setSyncingCashApp(true);
    try {
      const { data } = await api.post('/api/payments/cashapp/sync-gmail', {}, { skipGlobalError: true });
      const parts = [];
      if (data.inserted != null) parts.push(`${data.inserted} imported`);
      if (data.synced) parts.push(`${data.synced} updated`);
      if (data.cleared) parts.push(`${data.cleared} replaced`);
      showToast(
        parts.length
          ? `Cash App sync complete: ${parts.join(', ')} from ${data.paymentEmails} email(s).`
          : `Cash App sync complete (${data.paymentEmails} email(s) scanned).`,
        'success'
      );
      setPage(1);
      load(1, false);
      api.get('/api/payments/rent-status').then(({ data: rs }) => setRentStatus(rs)).catch(() => {});
    } catch (err) {
      showToast(apiErrorMessage(err, 'Cash App sync failed.'));
    } finally {
      setSyncingCashApp(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageIntro
        subtitle="Rent collection and payment history for your properties."
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
            <button
              type="button"
              onClick={syncCashApp}
              disabled={syncingCashApp}
              className="rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50 disabled:opacity-50"
            >
              {syncingCashApp ? 'Syncing Cash App…' : 'Sync Cash App from Gmail'}
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
          <p className="text-sm text-gray-400 mt-1">Payments appear here after tenants pay through the portal (ACH or Cash App Pay).</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200">
          <TableScroll className="portal-table">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>{['Tenant','Property','Amount','Type','Method','Status','Period','Date'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {payments.map(p => {
                const meta = STATUS_META[p.status] || { label:p.status, color:'bg-gray-100 text-gray-500' };
                const method = paymentMethodLabel(p);
                return (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3"><p className="font-medium text-gray-800">{p.tenant_name}</p><p className="text-xs text-gray-400">{p.tenant_email}</p></td>
                    <td className="px-4 py-3 text-gray-500">{p.property_name}<br/><span className="text-xs">Unit {p.unit_number}</span></td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{fmtMoney(p.amount)}</td>
                    <td className="px-4 py-3 text-gray-500">{TYPE_LABEL[p.payment_type] || p.payment_type}</td>
                    <td className="px-4 py-3 text-gray-500">
                      <p>{method}</p>
                      {p.external_reference && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[12rem]" title={p.external_reference}>{p.external_reference}</p>
                      )}
                    </td>
                    <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span>
                      {p.status === 'processing' && (
                        <p className="mt-0.5 text-xs text-blue-600">ACH settling</p>
                      )}
                      {p.status === 'failed' && p.failure_reason && (
                        <p className="mt-0.5 text-xs text-red-500 max-w-[12rem] truncate" title={p.failure_reason}>{p.failure_reason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{fmtPeriod(p.period_start)}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{fmt(p.paid_at || p.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </TableScroll>
          {hasMore && (
            <div className="px-4 py-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={loadingMore}
                className="text-sm text-indigo-600 hover:underline disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
