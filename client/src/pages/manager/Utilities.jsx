/**
 * Utilities.jsx — Manager / Owner utility bill splitter.
 *
 * Use cases: src/use-cases/utilities/catalog.js (Sommerville model)
 *   UC1  Create bill                 → CreateBillModal
 *   UC2  Preview equal split          (server returns splits in create response)
 *   UC3  Notify tenants              → BillDetail notify action
 *   UC4  Tenant disputes share       (tenant portal)
 *   UC5  Resolve dispute             → TenantCard waive / reject
 *   UC6  Charge ACH                  → BillDetail + TenantCard charge
 *   UC7  Settle via webhook          (automatic — bill status badge)
 *   UC8  Connect org Gmail           → header Connect Gmail (owner only)
 *   UC9  Import from Gmail           → header Import from Gmail
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap, Droplet, Flame, Globe, Trash2, Waves, Receipt,
  X, AlertTriangle, ExternalLink,
} from 'lucide-react';
import api from '@/api/axios';
import PageHeader from '@/components/ui/PageHeader';
import TableScroll from '@/components/ui/TableScroll';
import { useAuth } from '@/context/AuthContext';

// ── Formatting helpers (match conventions in sibling manager pages) ───────────
const fmt      = (ts) => ts ? new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtBillingMonth = (ym) => {
  if (!ym) return '—';
  const [y, m] = String(ym).split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};
const fmtMoney = (v)  => v != null ? '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const fmtDateTime = (ts) => ts ? new Date(ts).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : '—';
const hoursLeft = (ts) => {
  if (!ts) return null;
  const ms = new Date(ts) - new Date();
  return ms > 0 ? Math.ceil(ms / 3_600_000) : 0;
};

const SERVICE_TYPES = [
  ['electric','Electric'], ['water','Water'], ['gas','Gas'],
  ['internet','Internet'], ['trash','Trash'], ['sewer','Sewer'], ['other','Other'],
];

const BILL_STATUS_META = {
  draft:     { label: 'Draft',     color: 'bg-gray-100 text-gray-600'   },
  notified:  { label: 'Notified',  color: 'bg-blue-100 text-blue-700'   },
  charging:  { label: 'Charging',  color: 'bg-amber-100 text-amber-700' },
  settled:   { label: 'Settled',   color: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-500'   },
};

const SPLIT_STATUS_META = {
  pending:   { label: 'Pending',   color: 'bg-gray-100 text-gray-600'   },
  notified:  { label: 'Notified',  color: 'bg-blue-100 text-blue-700'   },
  disputed:  { label: 'Disputed',  color: 'bg-orange-100 text-orange-700' },
  charging:  { label: 'Charging',  color: 'bg-amber-100 text-amber-700' },
  paid:      { label: 'Paid',      color: 'bg-green-100 text-green-700' },
  failed:    { label: 'Failed',    color: 'bg-red-100 text-red-600'     },
  waived:    { label: 'Waived',    color: 'bg-purple-100 text-purple-700' },
};

const SERVICE_ICON = {
  electric: Zap, water: Droplet, gas: Flame, internet: Globe,
  trash: Trash2, sewer: Waves, other: Receipt,
};

function ServiceGlyph({ type, size = 18, className = '' }) {
  const Icon = SERVICE_ICON[type] || Receipt;
  return <Icon size={size} strokeWidth={2} className={className} />;
}

const SERVICE_LABEL = Object.fromEntries(SERVICE_TYPES);

function fmtPeriodRange(start, end) {
  if (!start && !end) return '—';
  const a = start ? fmt(start) : '—';
  const b = end ? fmt(end) : '—';
  return a === b ? a : `${a} – ${b}`;
}

/** Build a readable calculate-splits result for the status banner. */
function buildCalculateBanner(data) {
  const policy = data.collectible_policy || {};
  const collectible = (data.bills || []).filter((b) => b.status === 'draft');
  const services = [...new Set(collectible.map((b) => SERVICE_LABEL[b.service_type] || b.service_type))];

  let summary = 'No open draft bills to collect.';
  if (collectible.length === 1) {
    summary = `Updated 1 collectible bill (${services[0] || 'utility'}).`;
  } else if (collectible.length > 1) {
    summary = `Updated ${collectible.length} collectible bills (${services.join(' + ')}).`;
  }

  const footerParts = [];
  if (policy.settled_older) {
    footerParts.push(`${policy.settled_older} older bill${policy.settled_older === 1 ? '' : 's'} marked settled`);
  }
  if (policy.splits_waived) {
    footerParts.push(`${policy.splits_waived} historical split${policy.splits_waived === 1 ? '' : 's'} waived`);
  }

  return {
    type: 'calculate',
    summary,
    footer: footerParts.length ? `${footerParts.join('. ')}.` : null,
    bills: collectible.map((b) => ({
      key: b.bill_id,
      service_type: b.service_type,
      label: SERVICE_LABEL[b.service_type] || b.service_type,
      meta: `${fmtPeriodRange(b.period_start, b.period_end)} · ${fmtMoney(b.total_amount)} total`,
      tenants: (b.tenants || []).map((t) => ({
        name: t.name,
        amount: t.amount,
        detail: t.prorated
          ? `${t.occupancy_days} of ${t.bill_days} days (from ${fmt(t.effective_start)})`
          : 'Full billing period',
      })),
    })),
  };
}

function UtilityStatusBanner({ banner, onDismiss }) {
  if (!banner) return null;

  if (banner.type === 'text') {
    return (
      <div className="text-sm text-slate-700 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-2 flex justify-between gap-3">
        <span>{banner.text}</span>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="shrink-0 text-slate-400 hover:text-slate-600" aria-label="Dismiss"><X size={16} /></button>
        )}
      </div>
    );
  }

  if (banner.type === 'calculate') {
    return (
      <div className="text-sm text-slate-700 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3 space-y-3">
        <div className="flex justify-between gap-3">
          <div>
            <p className="font-semibold text-slate-900">{banner.summary}</p>
            {banner.footer && <p className="mt-1 text-xs text-slate-600">{banner.footer}</p>}
          </div>
          {onDismiss && (
            <button type="button" onClick={onDismiss} className="shrink-0 text-slate-400 hover:text-slate-600 leading-none" aria-label="Dismiss"><X size={18} /></button>
          )}
        </div>
        {banner.bills?.length > 0 ? (
          <ul className="space-y-2.5 border-t border-indigo-100/80 pt-3">
            {banner.bills.map((bill) => (
              <li key={bill.key} className="rounded-lg bg-white/80 border border-indigo-100/60 px-3 py-2">
                <p className="flex items-center gap-1.5 font-medium text-slate-900">
                  <ServiceGlyph type={bill.service_type} size={16} className="text-slate-500" />
                  {bill.label}
                </p>
                <p className="text-xs text-slate-500">{bill.meta}</p>
                <ul className="mt-1.5 space-y-0.5 text-xs text-slate-700">
                  {bill.tenants.map((t) => (
                    <li key={`${bill.key}-${t.name}`} className="flex justify-between gap-2">
                      <span>{t.name}</span>
                      <span className="tabular-nums text-right">
                        {fmtMoney(t.amount)}
                        {t.detail && <span className="block text-[10px] font-normal text-slate-500">{t.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-600 border-t border-indigo-100/80 pt-2">
            Older periods are on file as settled only — tenants are not charged for those.
          </p>
        )}
      </div>
    );
  }

  return null;
}

function Badge({ meta, fallback }) {
  if (!meta) return fallback ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{fallback}</span> : null;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateBillModal (UC1)
// ─────────────────────────────────────────────────────────────────────────────
function CreateBillModal({ onClose, onCreated }) {
  const [properties, setProperties] = useState([]);
  const [form, setForm] = useState({
    property_id: '',
    service_type: 'electric',
    provider_name: '',
    period_start: '',
    period_end: '',
    total_amount: '',
    due_date: '',
    notes: '',
    bill_document_url: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  useEffect(() => {
    api.get('/api/properties').then(r => {
      const list = r.data.properties || [];
      setProperties(list);
      if (list.length === 1) setForm(f => ({ ...f, property_id: list[0].id }));
    }).catch(() => {});
  }, []);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      const payload = {
        ...form,
        total_amount: parseFloat(form.total_amount),
        provider_name:     form.provider_name      || null,
        notes:             form.notes              || null,
        bill_document_url: form.bill_document_url  || null,
      };
      const { data } = await api.post('/api/utilities/bills', payload);
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || 'Failed to create bill');
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400";
  const labelCls = "block text-xs font-medium text-gray-500 mb-1";

  return (
    <div className="modal-overlay">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">New Utility Bill</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 leading-none" aria-label="Close"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Property *</label>
              <select className={inputCls} value={form.property_id}
                onChange={e => set('property_id', e.target.value)} required>
                <option value="">Select property…</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Service *</label>
              <select className={inputCls} value={form.service_type}
                onChange={e => set('service_type', e.target.value)} required>
                {SERVICE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Provider (optional)</label>
            <input className={inputCls} placeholder="e.g. Dominion Energy"
              value={form.provider_name} onChange={e => set('provider_name', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Period Start *</label>
              <input type="date" className={inputCls} value={form.period_start}
                onChange={e => set('period_start', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>Period End *</label>
              <input type="date" className={inputCls} value={form.period_end}
                onChange={e => set('period_end', e.target.value)} required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Total Amount ($) *</label>
              <input type="number" min="0" step="0.01" className={inputCls}
                placeholder="300.00"
                value={form.total_amount}
                onChange={e => set('total_amount', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>Due Date *</label>
              <input type="date" className={inputCls} value={form.due_date}
                onChange={e => set('due_date', e.target.value)} required />
            </div>
          </div>

          <div>
            <label className={labelCls}>Bill PDF URL (optional)</label>
            <input className={inputCls} placeholder="https://…"
              value={form.bill_document_url}
              onChange={e => set('bill_document_url', e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>Notes (optional)</label>
            <textarea className={`${inputCls} resize-none`} rows={2}
              value={form.notes}
              onChange={e => set('notes', e.target.value)} />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create bill'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DisputeReasonModal (UC4 — viewed here as read-only, but managers may
// want to see the full reason text in a popup if it's long)
// ─────────────────────────────────────────────────────────────────────────────
function DisputeReasonView({ split, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Dispute from {split.first_name} {split.last_name}</h3>
        <p className="text-xs text-gray-400 mb-4">Submitted {fmtDateTime(split.disputed_at)}</p>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{split.dispute_reason}</p>
        <button onClick={onClose} className="mt-6 w-full px-4 py-2 bg-gray-100 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-200">
          Close
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TenantCard — use-case card per tenant on a bill.
// Surfaces only the actions appropriate for the split's current state.
// ─────────────────────────────────────────────────────────────────────────────
function TenantCard({ split, bill, onAction, busy }) {
  const meta       = SPLIT_STATUS_META[split.status];
  const fullName   = `${split.first_name ?? ''} ${split.last_name ?? ''}`.trim() || split.email;
  const hrs        = hoursLeft(bill.dispute_deadline_at);
  const billOpen   = ['notified','charging'].includes(bill.status);
  const canCharge  = billOpen && split.status === 'notified' && split.has_verified_bank;
  const canWaive   = !['paid','waived'].includes(split.status);
  const canReject  = split.status === 'disputed';
  const [showReason, setShowReason] = useState(false);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm flex flex-col">
      {/* Identity */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-semibold text-gray-900">{fullName}</p>
          <p className="text-xs text-gray-400">Unit {split.unit_number} · Active lease</p>
        </div>
        <Badge meta={meta} />
      </div>

      {/* Bank */}
      <div className="text-xs text-gray-500 mb-3">
        {split.has_verified_bank ? (
          <>Bank: {split.institution_name || 'Verified'} <span className="text-gray-400">•••• {split.account_mask}</span></>
        ) : (
          <span className="inline-flex items-center gap-1 text-orange-600 font-medium"><AlertTriangle size={14} strokeWidth={2} /> No verified bank account</span>
        )}
      </div>

      {/* Amount */}
      <div className="mb-3">
        <p className="text-xs text-gray-400 uppercase tracking-wide">Share</p>
        <p className="text-2xl font-bold text-gray-900">{fmtMoney(split.amount)}</p>
      </div>

      {/* State-specific detail */}
      {split.status === 'notified' && hrs !== null && (
        <p className="text-xs text-gray-500 mb-3">
          Dispute window: <span className="font-medium text-gray-700">{hrs > 0 ? `${hrs}h left` : 'closed'}</span>
        </p>
      )}
      {split.status === 'disputed' && (
        <div className="mb-3 rounded-lg bg-orange-50 border border-orange-100 p-2">
          <p className="text-xs font-semibold text-orange-700 mb-0.5">Disputed</p>
          <p className="text-xs text-orange-900 line-clamp-2">{split.dispute_reason}</p>
          {split.dispute_reason && split.dispute_reason.length > 80 && (
            <button onClick={() => setShowReason(true)} className="mt-1 text-xs text-orange-700 hover:underline font-medium">
              Read more
            </button>
          )}
        </div>
      )}
      {split.status === 'charging' && (
        <p className="text-xs text-blue-600 mb-3">ACH initiated — settles in 4–5 business days</p>
      )}
      {split.status === 'paid' && split.paid_at && (
        <p className="text-xs text-green-600 mb-3">Paid {fmt(split.paid_at)}</p>
      )}
      {split.status === 'failed' && (
        <p className="text-xs text-red-600 mb-3 line-clamp-2">Failed: {split.failure_reason || 'Payment was returned'}</p>
      )}
      {split.status === 'waived' && (
        <p className="text-xs text-purple-600 mb-3">Waived by manager</p>
      )}

      {/* Actions — only show what makes sense for this state */}
      <div className="mt-auto flex flex-wrap gap-2 pt-2">
        {canCharge && (
          <button onClick={() => onAction('charge', split)} disabled={busy}
            className="text-xs font-medium px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            Charge now
          </button>
        )}
        {canReject && (
          <button onClick={() => onAction('reject', split)} disabled={busy}
            className="text-xs font-medium px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50">
            Reject dispute
          </button>
        )}
        {canWaive && (
          <button onClick={() => onAction('waive', split)} disabled={busy}
            className="text-xs font-medium px-3 py-1.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Waive
          </button>
        )}
        {split.status === 'failed' && (
          <button onClick={() => onAction('retry', split)} disabled={busy}
            className="text-xs font-medium px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            Retry charge
          </button>
        )}
      </div>

      {showReason && <DisputeReasonView split={split} onClose={() => setShowReason(false)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BillDetail — selected bill summary + tenant card grid
// ─────────────────────────────────────────────────────────────────────────────
function BillDetail({ billId, onChange, onClose }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/utilities/bills/${billId}`);
      setData(data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load bill');
    } finally {
      setLoading(false);
    }
  }, [billId]);

  useEffect(() => { load(); }, [load]);

  async function handleNotify() {
    if (!confirm('Notify all tenants? This starts a 48-hour dispute window before you can charge.')) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/api/utilities/bills/${billId}/notify`);
      setData(data);
      onChange?.();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to notify');
    } finally { setBusy(false); }
  }

  async function handleChargeAll() {
    const deadline = data?.bill?.dispute_deadline_at;
    const past = deadline && new Date(deadline) <= new Date();
    const msg = past
      ? 'Charge all eligible (non-disputed) tenants via ACH now?'
      : 'Dispute window has not closed. Charge anyway (force)?';
    if (!confirm(msg)) return;
    setBusy(true); setError('');
    try {
      const { data: result } = await api.post(`/api/utilities/bills/${billId}/charge`, { force: !past });
      setData({ bill: result.bill, splits: result.splits });
      if (result.skipped?.length) {
        alert(`Charged ${result.charged.length}, skipped ${result.skipped.length}.\n\n` +
              result.skipped.map(s => `• ${s.reason}${s.detail ? ': ' + s.detail : ''}`).join('\n'));
      }
      onChange?.();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to charge');
    } finally { setBusy(false); }
  }

  async function handleSplitAction(action, split) {
    setBusy(true); setError('');
    try {
      if (action === 'charge' || action === 'retry') {
        // Single-split charge: just trigger the bill-level charge — server skips
        // splits that already have payment_id, so this only fires the eligible ones.
        const { data: result } = await api.post(`/api/utilities/bills/${billId}/charge`, { force: true });
        setData({ bill: result.bill, splits: result.splits });
      } else if (action === 'waive') {
        if (!confirm(`Waive ${split.first_name}'s share of ${fmtMoney(split.amount)}?`)) { setBusy(false); return; }
        const { data: result } = await api.post(`/api/utilities/splits/${split.id}/waive`);
        setData(result);
      } else if (action === 'reject') {
        if (!confirm('Reject this dispute? The tenant will be charged.')) { setBusy(false); return; }
        const { data: result } = await api.post(`/api/utilities/splits/${split.id}/reject-dispute`);
        setData(result);
      }
      onChange?.();
    } catch (e) {
      setError(e.response?.data?.message || `Failed: ${action}`);
    } finally { setBusy(false); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-gray-400">No data.</p>;
  }

  const { bill, splits } = data;
  const meta     = BILL_STATUS_META[bill.status];
  const hrs      = hoursLeft(bill.dispute_deadline_at);
  const isElectric = bill.service_type === 'electric';
  const tenantCharges = bill.tenant_charge_amount ?? bill.total_amount;
  const chargeableAfter = bill.chargeable_after || bill.period_end;
  const todayStr = new Date().toISOString().slice(0, 10);
  const periodNotEnded = isElectric && chargeableAfter && todayStr < chargeableAfter.slice(0, 10);
  const canNotify = bill.status === 'draft' && !periodNotEnded;
  const canCharge = ['notified','charging'].includes(bill.status);
  const canDelete = bill.status === 'draft';

  async function handleDelete() {
    if (!confirm('Delete this draft bill? This cannot be undone.')) return;
    setBusy(true); setError('');
    try {
      await api.delete(`/api/utilities/bills/${billId}`);
      onClose();
      onChange?.();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to delete bill');
    } finally { setBusy(false); }
  }

  // Aggregates for the summary
  const sum = splits.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    acc._paid    += s.status === 'paid'   ? Number(s.amount) : 0;
    acc._pending += ['pending','notified','disputed','charging'].includes(s.status) ? Number(s.amount) : 0;
    return acc;
  }, { _paid: 0, _pending: 0 });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <ServiceGlyph type={bill.service_type} size={24} className="text-slate-600" />
              <h2 className="text-xl font-bold text-gray-900 capitalize">{bill.service_type}</h2>
              <Badge meta={meta} fallback={bill.status} />
            </div>
            <p className="text-sm text-gray-500">
              {bill.property_name} · {fmt(bill.period_start)} — {fmt(bill.period_end)}
            </p>
            {bill.provider_name && <p className="text-xs text-gray-400 mt-0.5">Provider: {bill.provider_name}</p>}
          </div>
          <button onClick={onClose} className="inline-flex items-center gap-1 text-gray-400 hover:text-gray-600 text-sm">Close <X size={14} /></button>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {isElectric ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">Tenant charges</p>
              <p className="font-semibold text-gray-900">{fmtMoney(tenantCharges)}</p>
            </div>
          ) : (
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">Total</p>
              <p className="font-semibold text-gray-900">{fmtMoney(bill.total_amount)}</p>
            </div>
          )}
          {isElectric && bill.statement_balance != null && (
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">Account balance</p>
              <p className="font-semibold text-gray-600">{fmtMoney(bill.statement_balance)}</p>
              <p className="text-[10px] text-gray-400">Not collected from tenants</p>
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Due</p>
            <p className="font-semibold text-gray-900">{fmt(bill.due_date)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Paid</p>
            <p className="font-semibold text-green-600">{fmtMoney(sum._paid)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Outstanding</p>
            <p className="font-semibold text-gray-900">{fmtMoney(sum._pending)}</p>
          </div>
        </div>

        {isElectric && (bill.amount_source || bill.chargeable_after || bill.amount_pulled_at) && (
          <div className="mt-3 text-xs text-gray-500 space-y-0.5">
            {bill.amount_source && (
              <p>Amount source: <span className="font-medium text-gray-700">{bill.amount_source}</span></p>
            )}
            {bill.chargeable_after && (
              <p>Chargeable after: <span className="font-medium text-gray-700">{fmt(bill.chargeable_after)}</span></p>
            )}
            {bill.amount_pulled_at && (
              <p>Amount pulled: <span className="font-medium text-gray-700">{fmtDateTime(bill.amount_pulled_at)}</span></p>
            )}
          </div>
        )}

        {periodNotEnded && bill.status === 'draft' && (
          <p className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Billing period has not ended yet. Notify tenants on or after {fmt(chargeableAfter)}.
          </p>
        )}

        {bill.dispute_deadline_at && bill.status !== 'settled' && (
          <p className="mt-3 text-xs text-gray-500">
            Dispute window {hrs > 0 ? `closes in ${hrs}h` : 'closed'} ·
            <span className="ml-1">{fmtDateTime(bill.dispute_deadline_at)}</span>
          </p>
        )}

        {bill.notes && <p className="mt-3 text-xs text-gray-500 italic">"{bill.notes}"</p>}

        {/* Bill-level actions */}
        <div className="mt-4 flex flex-wrap gap-2">
          {bill.status === 'draft' && periodNotEnded && (
            <span className="px-4 py-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg">
              Notify unavailable until {fmt(chargeableAfter)}
            </span>
          )}
          {canNotify && (
            <button onClick={handleNotify} disabled={busy}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              Notify tenants (48h dispute window)
            </button>
          )}
          {canCharge && (
            <button onClick={handleChargeAll} disabled={busy}
              className="px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 disabled:opacity-50">
              Charge all eligible
            </button>
          )}
          {canDelete && (
            <button onClick={handleDelete} disabled={busy}
              className="px-4 py-2 border border-red-200 text-red-700 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50">
              Delete draft
            </button>
          )}
          {bill.bill_document_url && (
            <a href={bill.bill_document_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
              View original bill <ExternalLink size={14} strokeWidth={2} />
            </a>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      </div>

      {/* Tenant cards */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Tenants on this bill <span className="text-gray-400 font-normal">({splits.length})</span>
        </h3>
        {splits.length === 0 ? (
          <p className="text-sm text-gray-400">No active leases overlapped this period.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {splits.map(s => (
              <TenantCard key={s.id} split={s} bill={bill}
                onAction={handleSplitAction} busy={busy} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page — Bills list + selected bill detail
// ─────────────────────────────────────────────────────────────────────────────
export default function UtilitiesPage() {
  const { user } = useAuth();
  const [bills,      setBills]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filter,     setFilter]     = useState('');
  const [gmail,       setGmail]       = useState({ connected: false, gmail_address: null });
  const [importing,   setImporting]   = useState(false);
  const [pruning,     setPruning]     = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [banner, setBanner] = useState(null);
  const [property,    setProperty]    = useState(null);
  /** 0 = pull Gmail, 1 = combine, 2 = calculate, 3 = workflow complete */
  const [workflowStep, setWorkflowStep] = useState(0);

  const draftCount = bills.filter((b) => b.status === 'draft').length;
  const workflowBusy = importing || pruning || calculating;
  const canConnectGmail = user?.isPrimaryOwner || user?.role === 'super_admin';

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter) params.set('status', filter);
      const { data } = await api.get(`/api/utilities/bills?${params}`);
      setBills(data.bills || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadGmail = useCallback(async () => {
    try {
      const { data } = await api.get('/api/utilities/gmail/status');
      setGmail(data);
    } catch {
      setGmail({ connected: false });
    }
  }, []);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => { loadGmail(); }, [loadGmail]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('utilities-workflow-step');
      if (saved != null) {
        const n = Number(saved);
        if (n >= 0 && n <= 3) setWorkflowStep(n);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem('utilities-workflow-step', String(workflowStep));
    } catch { /* ignore */ }
  }, [workflowStep]);
  useEffect(() => {
    api.get('/api/properties')
      .then((r) => {
        const list = r.data.properties || [];
        setProperty(list.find((p) => /743/i.test(p.name)) || list[0] || null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail') === 'connected') {
      setBanner({ type: 'text', text: `Gmail connected${params.get('email') ? `: ${params.get('email')}` : ''}.` });
      loadGmail();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('gmail') === 'error') {
      setBanner({ type: 'text', text: 'Gmail connection failed. Check Google OAuth settings in .env.local.' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [loadGmail]);

  async function connectGmail() {
    try {
      const { data } = await api.get('/api/utilities/gmail/connect');
      window.location.href = data.url;
    } catch (err) {
      setBanner({ type: 'text', text: err.response?.data?.message || 'Could not start Gmail connection' });
    }
  }

  function resetWorkflow() {
    setWorkflowStep(0);
    try {
      sessionStorage.removeItem('utilities-workflow-step');
    } catch { /* ignore */ }
  }

  async function combineByMonth() {
    if (workflowStep !== 1 || workflowBusy) return;
    setPruning(true);
    setBanner(null);
    try {
      const { data } = await api.post('/api/utilities/bills/combine-monthly');
      const parts = [];
      if (data.merged) parts.push(`merged ${data.merged} bill group${data.merged === 1 ? '' : 's'}`);
      if (data.removed) parts.push(`removed ${data.removed} duplicate row${data.removed === 1 ? '' : 's'}`);
      if (data.normalized) parts.push(`aligned ${data.normalized} to calendar months`);
      const detail = parts.length ? parts.join(', ') : 'already one bill per service per month';
      setBanner({
        type: 'text',
        text: `Step ② complete (${detail}). Next: tap ③ Calculate tenant shares.`,
      });
      setWorkflowStep(2);
      setSelectedId(null);
      await load();
    } catch (err) {
      setBanner({ type: 'text', text: err.response?.data?.message || 'Combine failed' });
    } finally {
      setPruning(false);
    }
  }

  async function calculateSplits() {
    if (workflowStep !== 2 || workflowBusy) return;
    setCalculating(true);
    setBanner(null);
    try {
      const { data } = await api.post('/api/utilities/bills/recalculate-splits');
      setBanner(buildCalculateBanner(data));
      setWorkflowStep(3);
      setSelectedId(null);
      await load();
    } catch (err) {
      setBanner({ type: 'text', text: err.response?.data?.message || 'Calculate failed' });
    } finally {
      setCalculating(false);
    }
  }

  async function importFromGmail() {
    if (workflowStep !== 0 || !gmail.connected || workflowBusy) return;
    setImporting(true);
    setBanner(null);
    try {
      const { data } = await api.post('/api/utilities/gmail/import', { max_messages: 25 });
      const created = data.created?.length || 0;
      const merged = data.merged?.length || 0;
      const monthly = data.monthly;
      const policy = data.collectible_policy;
      const parts = [];
      if (created) parts.push(`${created} new bill${created === 1 ? '' : 's'}`);
      if (merged) parts.push(`${merged} merged into this month`);
      if (monthly?.merged) parts.push(`${monthly.merged} month${monthly.merged === 1 ? '' : 's'} combined`);
      if (policy?.settled_older) parts.push(`${policy.settled_older} older bill${policy.settled_older === 1 ? '' : 's'} settled`);
      const detail = parts.length
        ? parts.join(', ')
        : `no new bills (${data.skipped?.length || 0} skipped)`;
      setBanner({
        type: 'text',
        text: `Step ① complete (${detail}). Next: tap ② Combine month-to-month.`,
      });
      setWorkflowStep(1);
      await load();
    } catch (err) {
      const msg = err.response?.data?.message || 'Gmail import failed';
      const stale = /invalid_grant/i.test(msg);
      setBanner({
        type: 'text',
        text: stale && canConnectGmail
          ? 'Gmail authorization expired. Use Reconnect Gmail in the header, then try ① again.'
          : stale
            ? 'Gmail authorization expired. Ask the owner to reconnect Gmail in Utilities, then try ① again.'
            : msg,
      });
    } finally {
      setImporting(false);
    }
  }

  const canPullGmail = gmail.connected && workflowStep === 0 && !workflowBusy;
  const canCombine = workflowStep === 1 && !workflowBusy;
  const canCalculate = workflowStep === 2 && !workflowBusy;
  const workflowComplete = workflowStep >= 3;

  const headerActions = (
    <>
      {gmail.connected && (
        <span className="hidden sm:inline text-xs text-slate-500" title={gmail.gmail_address || ''}>
          Gmail connected{gmail.gmail_address ? `: ${gmail.gmail_address}` : ''}
        </span>
      )}
      {canConnectGmail && (
        <button type="button" onClick={connectGmail}
          className="px-3 py-2 border border-slate-200 text-sm font-medium rounded-lg text-slate-700 hover:bg-slate-50">
          {gmail.connected ? 'Reconnect Gmail' : 'Connect Gmail'}
        </button>
      )}
      {!gmail.connected && !canConnectGmail && (
        <span className="text-xs text-slate-400">Gmail not connected</span>
      )}
      <button type="button" onClick={() => setShowCreate(true)}
        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
        Add bill
      </button>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        portal="manager"
        title="Utilities"
        subtitle={`Split water, electric, and other shared bills across tenants at 743 A Ave · ${bills.length} on file${draftCount ? ` · ${draftCount} draft${draftCount === 1 ? '' : 's'}` : ''}`}
        actions={headerActions}
      />

      <UtilityStatusBanner banner={banner} onDismiss={() => setBanner(null)} />

      <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 sm:p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Update utility bills</h3>
          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
            Complete each step in order. The next button unlocks only after the current step finishes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
          <span className={workflowStep > 0 ? 'text-emerald-700' : workflowStep === 0 ? 'text-indigo-700' : ''}>
            {workflowStep > 0 ? '✓' : '●'} ① Gmail
          </span>
          <span aria-hidden>→</span>
          <span className={workflowStep > 1 ? 'text-emerald-700' : workflowStep === 1 ? 'text-indigo-700' : ''}>
            {workflowStep > 1 ? '✓' : workflowStep === 1 ? '●' : '○'} ② Combine
          </span>
          <span aria-hidden>→</span>
          <span className={workflowStep > 2 ? 'text-emerald-700' : workflowStep === 2 ? 'text-indigo-700' : ''}>
            {workflowStep > 2 ? '✓' : workflowStep === 2 ? '●' : '○'} ③ Calculate
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={importFromGmail}
            disabled={!canPullGmail}
            title={
              !gmail.connected
                ? 'Connect Gmail in the header first'
                : workflowStep !== 0
                  ? workflowComplete
                    ? 'Workflow complete — start a new update'
                    : 'Finish the earlier step first'
                  : 'Pull utility e-bills from Gmail'
            }
            className={`rounded-lg border px-4 py-2.5 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-40 ${
              canPullGmail
                ? 'bg-white border-indigo-200 text-indigo-800 hover:bg-indigo-50'
                : workflowStep > 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-slate-50 border-slate-200 text-slate-400'
            }`}
          >
            {importing ? 'Pulling…' : workflowStep > 0 ? '✓ ① Gmail' : '① Pull from Gmail'}
          </button>
          <button
            type="button"
            onClick={combineByMonth}
            disabled={!canCombine}
            title={
              workflowStep < 1
                ? 'Complete step ① first'
                : workflowStep > 1
                  ? 'Step ② already done'
                  : 'Merge drafts into one bill per service per month'
            }
            className={`rounded-lg border px-4 py-2.5 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-40 ${
              canCombine
                ? 'bg-white border-indigo-200 text-indigo-800 hover:bg-indigo-50'
                : workflowStep > 1
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-slate-50 border-slate-200 text-slate-400'
            }`}
          >
            {pruning ? 'Combining…' : workflowStep > 1 ? '✓ ② Combined' : '② Combine month-to-month'}
          </button>
          <button
            type="button"
            onClick={calculateSplits}
            disabled={!canCalculate}
            title={
              workflowStep < 2
                ? 'Complete steps ① and ② first'
                : workflowComplete
                  ? 'Step ③ already done'
                  : 'Prorate by lease dates; only latest bill per service is collectible'
            }
            className={`rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-40 ${
              canCalculate
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : workflowStep > 2
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-200 text-slate-500'
            }`}
          >
            {calculating ? 'Calculating…' : workflowStep > 2 ? '✓ ③ Calculated' : '③ Calculate tenant shares'}
          </button>
          {workflowComplete && (
            <button
              type="button"
              onClick={resetWorkflow}
              disabled={workflowBusy}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Start new update
            </button>
          )}
        </div>

        {!gmail.connected && canConnectGmail && (
          <p className="text-xs text-amber-800">
            Connect Gmail first (header) before step ①.
          </p>
        )}
        {gmail.connected && workflowStep === 0 && !workflowBusy && (
          <p className="text-xs text-indigo-800">Start with ① Pull from Gmail.</p>
        )}
        {workflowStep === 1 && !workflowBusy && (
          <p className="text-xs text-indigo-800">
            Step ① done — run ② Combine{draftCount > 1 ? ` (${draftCount} drafts to merge)` : ''}.
          </p>
        )}
        {workflowStep === 2 && !workflowBusy && (
          <p className="text-xs text-indigo-800">Step ② done — run ③ Calculate tenant shares.</p>
        )}
        {workflowComplete && (
          <p className="text-xs text-emerald-800">
            All steps complete. Notify tenants on draft bills, or start a new update when more e-bills arrive.
          </p>
        )}
      </div>

      {/* Filter tabs */}
      <div className="scroll-x-touch max-w-full rounded-lg border border-gray-200">
        <div className="flex w-max min-w-full text-sm">
          {[['','All'],['draft','Draft'],['notified','Notified'],['charging','Charging'],['settled','Settled']].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setFilter(v)}
              className={`shrink-0 px-4 py-2 font-medium ${filter === v ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Bills list */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : bills.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="mb-3 flex justify-center text-slate-300"><Zap size={40} strokeWidth={1.5} /></div>
          <p className="font-medium text-gray-700">No utility bills yet</p>
          <p className="text-sm text-gray-400 mt-1">Add a bill to start splitting it across your tenants.</p>
        </div>
      ) : (
        <TableScroll className="bg-white rounded-xl border border-gray-200 portal-table">
          <table className="w-full text-sm min-w-[36rem]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Service','Billing month','Amount','Due','Status','Paid',''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bills.map(b => (
                <tr key={b.id} onClick={() => setSelectedId(b.id)}
                    className={`hover:bg-gray-50 cursor-pointer ${selectedId === b.id ? 'bg-indigo-50' : ''}`}>
                  <td className="px-4 py-3">
                    <span className="mr-2 inline-flex align-middle text-slate-500"><ServiceGlyph type={b.service_type} size={18} /></span>
                    <span className="capitalize text-gray-700 font-medium">{b.service_type}</span>
                    {b.provider_name && (
                      <span className="block text-xs text-gray-400 truncate max-w-[140px]">{b.provider_name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <span className="font-medium">{fmtBillingMonth(b.billing_month)}</span>
                    <span className="block text-xs text-gray-400">{fmt(b.period_start)} – {fmt(b.period_end)}</span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-800 tabular-nums">{fmtMoney(b.total_amount)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmt(b.due_date)}</td>
                  <td className="px-4 py-3"><Badge meta={BILL_STATUS_META[b.status]} fallback={b.status} /></td>
                  <td className="px-4 py-3 text-xs text-gray-500 tabular-nums">
                    {b.paid_count}/{b.split_count}
                    {Number(b.disputed_count) > 0 && (
                      <span className="ml-1 text-orange-600">({b.disputed_count} disputed)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {b.status === 'draft' && (
                      <button type="button"
                        className="text-xs font-medium text-red-600 hover:text-red-800"
                        onClick={async () => {
                          if (!confirm('Delete this draft?')) return;
                          try {
                            await api.delete(`/api/utilities/bills/${b.id}`);
                            if (selectedId === b.id) setSelectedId(null);
                            await load();
                          } catch (err) {
                            window.alert(err.response?.data?.message || 'Delete failed');
                          }
                        }}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {/* Selected bill detail */}
      {selectedId && (
        <BillDetail
          billId={selectedId}
          onChange={load}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateBillModal
          onClose={() => setShowCreate(false)}
          onCreated={(data) => {
            setShowCreate(false);
            setSelectedId(data.bill.id);
            load();
          }}
        />
      )}
    </div>
  );
}
