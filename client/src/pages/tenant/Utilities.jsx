/**
 * Tenant utilities — open shares, dispute, history. Pay via Payments.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { Zap, Droplet, Flame, Globe, Trash2, Waves, Receipt, X, CreditCard } from 'lucide-react';
import api from '@/api/axios';
import PageHeader from '@/components/ui/PageHeader';

const fmt = (v) =>
  v != null
    ? '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
const fmtDate = (ts) =>
  ts ? new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const SERVICE_ICON = {
  electric: Zap, water: Droplet, gas: Flame, internet: Globe,
  trash: Trash2, sewer: Waves, other: Receipt,
};

function ServiceGlyph({ type }) {
  const Icon = SERVICE_ICON[type] || Receipt;
  return <Icon size={18} strokeWidth={2} />;
}

function hoursLeft(ts) {
  if (!ts) return null;
  const ms = new Date(ts) - new Date();
  return ms > 0 ? Math.ceil(ms / 3_600_000) : 0;
}

const STATUS_LABEL = {
  pending: 'Pending',
  notified: 'Open',
  disputed: 'Disputed',
  charging: 'Processing',
  paid: 'Paid',
  failed: 'Failed',
  waived: 'Waived',
};

function DisputeModal({ split, onClose, onSubmitted }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await api.post(`/api/utilities/splits/${split.id}/dispute`, { reason: reason.trim() });
      onSubmitted();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit dispute');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="w-full max-w-md bg-white shadow-xl rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Dispute utility share</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <p className="text-sm text-slate-600 capitalize">
            {split.service_type} · {fmt(split.amount)} · {fmtDate(split.period_start)} – {fmtDate(split.period_end)}
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Reason</label>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[100px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              placeholder="What looks wrong?"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !reason.trim()}
            className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit dispute'}
          </button>
        </form>
      </div>
    </div>
  );
}

function SplitRow({ split, onDispute }) {
  const hrs = hoursLeft(split.dispute_deadline_at);
  const canDispute = split.status === 'notified' && hrs > 0;
  const needsPay = ['notified', 'disputed', 'failed'].includes(split.status);

  return (
    <li className="flex items-start gap-4 px-5 py-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
        <ServiceGlyph type={split.service_type} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium capitalize text-slate-900">
          {split.service_type}
          {split.provider_name ? <span className="font-normal text-slate-400"> · {split.provider_name}</span> : null}
        </p>
        <p className="text-xs text-slate-500">
          {fmtDate(split.period_start)} – {fmtDate(split.period_end)}
          {split.due_date ? ` · Due ${fmtDate(split.due_date)}` : ''}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">{STATUS_LABEL[split.status] || split.status}</p>
        {canDispute && (
          <p className="mt-0.5 text-xs text-slate-400">Dispute window: {hrs}h left</p>
        )}
        {split.status === 'disputed' && (
          <p className="mt-0.5 text-xs font-medium text-amber-600">Awaiting manager review</p>
        )}
      </div>
      <div className="flex-none text-right space-y-1">
        <p className="font-semibold tabular-nums text-slate-900">{fmt(split.amount)}</p>
        {Number(split.utility_house_cover_per_tenant) > 0 && (
          <p className="text-xs text-slate-500 mt-0.5 max-w-[10rem]">
            {Number(split.amount) === 0
              ? 'Fully covered by house this month'
              : `Includes house utility allowance ($${Number(split.utility_house_cover_per_tenant).toFixed(0)}/tenant)`}
          </p>
        )}
        {canDispute && (
          <button
            type="button"
            onClick={() => onDispute(split)}
            className="block w-full text-xs font-medium text-amber-600 hover:underline"
          >
            Dispute
          </button>
        )}
        {needsPay && (
          <Link
            to="/tenant/payments"
            className="block text-xs font-medium text-indigo-600 hover:underline"
          >
            Pay in Payments
          </Link>
        )}
      </div>
    </li>
  );
}

export default function TenantUtilities() {
  const [splits, setSplits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [disputing, setDisputing] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/api/utilities/my-splits');
      setSplits(data.splits || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = splits.filter((s) => ['notified', 'disputed', 'charging', 'failed', 'pending'].includes(s.status));
  const history = splits.filter((s) => ['paid', 'waived'].includes(s.status));
  const openTotal = open.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        portal="tenant"
        title="Utilities"
        subtitle="Your water, electric, and other shared bill shares"
      />

      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Pay in the portal only</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          Open shares are paid under{' '}
          <Link to="/tenant/payments" className="font-medium text-indigo-700 hover:underline">Payments</Link>
          {' '}(bank ACH — no processing fee — or Cash App Pay with 2.9% + $0.30).
          Off-app transfers are not accepted. We only auto-debit if Autopay is on.
        </p>
        {openTotal > 0 && (
          <Link
            to="/tenant/payments"
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <CreditCard size={16} strokeWidth={2} />
            Pay {fmt(openTotal)} in Payments
          </Link>
        )}
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : (
        <>
          <section className="portal-card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Open shares</h2>
            </div>
            {open.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400 text-center">Nothing open right now.</p>
            ) : (
              <ul className="divide-y divide-slate-50">
                {open.map((s) => (
                  <SplitRow key={s.id} split={s} onDispute={setDisputing} />
                ))}
              </ul>
            )}
          </section>

          <section className="portal-card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">History</h2>
            </div>
            {history.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400 text-center">No paid or waived shares yet.</p>
            ) : (
              <ul className="divide-y divide-slate-50">
                {history.map((s) => (
                  <SplitRow key={s.id} split={s} onDispute={() => {}} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {disputing && (
        <DisputeModal
          split={disputing}
          onClose={() => setDisputing(null)}
          onSubmitted={() => {
            setDisputing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
