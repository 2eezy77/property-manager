/**
 * Utilities.jsx — Manager / Owner utility bill splitter.
 *
 * Balances board: one card per tenant (service shares nested inside).
 * Bill detail: TenantCard per split on that bill.
 *
 * Use cases: src/use-cases/utilities/catalog.js (Sommerville model)
 *   UC1  Create bill                 → CreateBillModal
 *   UC2  Preview equal split          (server returns splits in create response)
 *   UC3  Notify tenants              → BillDetail notify action
 *   UC4  Tenant disputes share       (tenant portal)
 *   UC5  Resolve dispute             → TenantCard waive / reject
 *   UC6  Charge ACH                  → legacy/emergency API only (not shown in UI)
 *   UC7  Settle via webhook          (automatic — bill status badge)
 *   UC8  Connect org Gmail           → header Connect Gmail (owner only)
 *   UC9  Import from Gmail           → header Import from Gmail
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Zap, Droplet, Flame, Globe, Trash2, Waves, Receipt,
  X, AlertTriangle, ExternalLink,
} from 'lucide-react';
import api from '@/api/axios';
import PageHeader from '@/components/ui/PageHeader';
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
  charging:  { label: 'Processing', color: 'bg-amber-100 text-amber-700' },
  settled:   { label: 'Settled',   color: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-500'   },
};

const SPLIT_STATUS_META = {
  pending:   { label: 'Pending',   color: 'bg-gray-100 text-gray-600'   },
  notified:  { label: 'Notified',  color: 'bg-blue-100 text-blue-700'   },
  disputed:  { label: 'Disputed',  color: 'bg-orange-100 text-orange-700' },
  charging:  { label: 'Processing', color: 'bg-amber-100 text-amber-700' },
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

/** Roll-up status for a tenant's open shares (worst actionable first). */
function rollupSplitStatus(splits) {
  const statuses = splits.map((s) => s.split_status);
  if (statuses.some((s) => s === 'disputed')) return 'disputed';
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.some((s) => s === 'charging')) return 'charging';
  if (statuses.every((s) => s === 'paid' || s === 'waived')) {
    return statuses.some((s) => s === 'paid') ? 'paid' : 'waived';
  }
  if (statuses.some((s) => s === 'notified')) return 'notified';
  if (statuses.some((s) => s === 'pending')) return 'pending';
  return statuses[0] || 'pending';
}

/** One card per tenant — nest service/period lines instead of ledger rows. */
function groupBalancesByTenant(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const key = r.tenant_id || r.email || r.split_id;
    if (!map.has(key)) {
      map.set(key, {
        tenant_id: r.tenant_id,
        first_name: r.first_name,
        last_name: r.last_name,
        email: r.email,
        unit_number: r.unit_number,
        splits: [],
      });
    }
    const t = map.get(key);
    if (!t.unit_number && r.unit_number) t.unit_number = r.unit_number;
    t.splits.push(r);
  }

  return [...map.values()].map((t) => {
    const openSplits = t.splits.filter((s) => !['paid', 'waived'].includes(s.split_status));
    const amountFocus = openSplits.length ? openSplits : t.splits;
    const total = amountFocus.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const maxDays = t.splits.reduce((m, s) => Math.max(m, Number(s.days_open) || 0), 0);
    return {
      ...t,
      total,
      openCount: openSplits.length,
      maxDaysOpen: maxDays || null,
      rollupStatus: rollupSplitStatus(t.splits),
    };
  }).sort((a, b) => {
    const an = `${a.last_name || ''} ${a.first_name || ''}`.trim();
    const bn = `${b.last_name || ''} ${b.first_name || ''}`.trim();
    return an.localeCompare(bn);
  });
}

function TenantBalanceCard({ tenant, selectedBillId, onOpenBill }) {
  const name = `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() || tenant.email;
  const meta = SPLIT_STATUS_META[tenant.rollupStatus];
  const hasSelected = tenant.splits.some((s) => s.bill_id === selectedBillId);

  return (
    <article
      className={`rounded-xl border bg-white p-4 shadow-sm transition ${
        hasSelected ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 truncate">{name}</p>
          <p className="text-xs text-slate-500 truncate">
            {tenant.unit_number ? `Unit ${tenant.unit_number}` : '—'}
            {tenant.email ? ` · ${tenant.email}` : ''}
          </p>
        </div>
        <Badge meta={meta} fallback={tenant.rollupStatus} />
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {tenant.openCount ? 'Open total' : 'Total'}
          </p>
          <p className="text-2xl font-bold tabular-nums text-slate-900">{fmtMoney(tenant.total)}</p>
        </div>
        <p className="text-xs text-slate-500 tabular-nums">
          {tenant.splits.length} share{tenant.splits.length === 1 ? '' : 's'}
          {tenant.maxDaysOpen != null ? ` · ${tenant.maxDaysOpen}d open` : ''}
        </p>
      </div>

      <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100 bg-slate-50/60">
        {tenant.splits.map((s) => (
          <li key={s.split_id}>
            <button
              type="button"
              onClick={() => onOpenBill(s.bill_id)}
              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white ${
                selectedBillId === s.bill_id ? 'bg-indigo-50' : ''
              }`}
            >
              <span className="inline-flex shrink-0 text-slate-500">
                <ServiceGlyph type={s.service_type} size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium capitalize text-slate-800">
                  {SERVICE_LABEL[s.service_type] || s.service_type}
                </span>
                <span className="block text-[11px] text-slate-500">
                  {fmtPeriodRange(s.period_start, s.period_end)}
                  {' · '}
                  {SPLIT_STATUS_META[s.split_status]?.label || s.split_status}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                {fmtMoney(s.amount)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </article>
  );
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
        <p className="text-xs text-blue-600 mb-3">Payment processing — usually settles in a few business days</p>
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

      {/* Actions — dispute resolve */}
      <div className="mt-auto flex flex-wrap gap-2 pt-2">
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
    if (!confirm('Notify tenants of their shares? They will get email + in-app notice and a 48-hour dispute window. Tenants pay themselves — this does not ACH them.')) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/api/utilities/bills/${billId}/notify`);
      setData(data);
      onChange?.();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to notify');
    } finally { setBusy(false); }
  }

  async function handleSplitAction(action, split) {
    setBusy(true); setError('');
    try {
      if (action === 'waive') {
        if (!confirm(`Waive ${split.first_name}'s share of ${fmtMoney(split.amount)}?`)) { setBusy(false); return; }
        const { data: result } = await api.post(`/api/utilities/splits/${split.id}/waive`);
        setData(result);
      } else if (action === 'reject') {
        if (!confirm('Reject this dispute? Remind the tenant to pay their share in the portal.')) { setBusy(false); return; }
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
              Notify tenants
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
          Who owes what <span className="text-gray-400 font-normal">({splits.length})</span>
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
// Main page — Balances board + tools + bill detail
// ─────────────────────────────────────────────────────────────────────────────
export default function UtilitiesPage() {
  const { user } = useAuth();
  const [balances, setBalances] = useState({ rows: [], totals: {} });
  const [balanceFilter, setBalanceFilter] = useState('owes');
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [gmail, setGmail] = useState({ connected: false, gmail_address: null });
  const [importing, setImporting] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [banner, setBanner] = useState(null);

  const canConnectGmail = user?.isPrimaryOwner || user?.role === 'super_admin';
  const totals = balances.totals || {};

  const loadBalances = useCallback(async ({ soft = false } = {}) => {
    try {
      if (!soft) setLoading(true);
      const { data } = await api.get(`/api/utilities/balances?filter=${encodeURIComponent(balanceFilter)}`);
      setBalances(data);
    } catch (e) {
      console.error(e);
    } finally {
      if (!soft) setLoading(false);
    }
  }, [balanceFilter]);

  const loadBills = useCallback(async () => {
    try {
      const { data } = await api.get('/api/utilities/bills');
      setBills(data.bills || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadGmail = useCallback(async () => {
    try {
      const { data } = await api.get('/api/utilities/gmail/status');
      setGmail(data);
    } catch {
      setGmail({ connected: false });
    }
  }, []);

  const refreshAll = useCallback(async ({ soft = false } = {}) => {
    await Promise.all([loadBalances({ soft }), loadBills()]);
  }, [loadBalances, loadBills]);

  useEffect(() => { loadBalances(); }, [loadBalances]);
  useEffect(() => { loadBills(); loadGmail(); }, [loadBills, loadGmail]);

  // Soft-refresh balances while tab focused (~20s)
  useEffect(() => {
    let timer = null;
    const tick = () => {
      if (document.visibilityState === 'visible') {
        loadBalances({ soft: true });
      }
    };
    timer = setInterval(tick, 20_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') loadBalances({ soft: true });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [loadBalances]);

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

  async function importFromGmail() {
    if (!gmail.connected || importing) return;
    setImporting(true);
    setBanner(null);
    try {
      const { data } = await api.post('/api/utilities/gmail/import', { max_messages: 25 });
      const created = data.created?.length || 0;
      setBanner({
        type: 'text',
        text: created
          ? `Imported ${created} bill${created === 1 ? '' : 's'}. Workers also notify automatically when ready.`
          : `No new bills (${data.skipped?.length || 0} skipped).`,
      });
      await refreshAll();
    } catch (err) {
      const msg = err.response?.data?.message || 'Gmail import failed';
      setBanner({ type: 'text', text: msg });
    } finally {
      setImporting(false);
    }
  }

  async function calculateSplits() {
    if (calculating) return;
    setCalculating(true);
    setBanner(null);
    try {
      const { data } = await api.post('/api/utilities/bills/recalculate-splits');
      setBanner(buildCalculateBanner(data));
      await refreshAll();
    } catch (err) {
      setBanner({ type: 'text', text: err.response?.data?.message || 'Calculate failed' });
    } finally {
      setCalculating(false);
    }
  }

  const draftCount = bills.filter((b) => b.status === 'draft').length;
  const tenantCards = useMemo(
    () => groupBalancesByTenant(balances.rows),
    [balances.rows],
  );
  const headerActions = (
    <>
      {gmail.connected && (
        <span className="hidden sm:inline text-xs text-slate-500" title={gmail.gmail_address || ''}>
          Gmail{gmail.gmail_address ? `: ${gmail.gmail_address}` : ' connected'}
        </span>
      )}
      {canConnectGmail && (
        <button type="button" onClick={connectGmail}
          className="px-3 py-2 border border-slate-200 text-sm font-medium rounded-lg text-slate-700 hover:bg-slate-50">
          {gmail.connected ? 'Reconnect Gmail' : 'Connect Gmail'}
        </button>
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
        subtitle="Bill and remind — tenants pay in the portal. Workers never ACH."
        actions={headerActions}
      />

      <UtilityStatusBanner banner={banner} onDismiss={() => setBanner(null)} />

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Open</p>
          <p className="text-xl font-semibold tabular-nums text-slate-900">{fmtMoney(totals.open_amount)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Disputed</p>
          <p className="text-xl font-semibold tabular-nums text-orange-700">{fmtMoney(totals.disputed_amount)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 col-span-2 md:col-span-1">
          <p className="text-xs uppercase tracking-wide text-slate-400">Overdue (7d+)</p>
          <p className="text-xl font-semibold tabular-nums text-slate-900">{totals.overdue_count ?? 0}</p>
        </div>
      </div>

      {/* Balances — one card per tenant */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Balances</h2>
            <p className="text-xs text-slate-500">
              One card per tenant — shares nested inside. Auto-refreshes while this tab is open.
            </p>
          </div>
          <div className="scroll-x-touch max-w-full rounded-lg border border-gray-200">
            <div className="flex w-max min-w-full text-sm">
              {[
                ['owes', 'Owes'],
                ['disputed', 'Disputed'],
                ['failed', 'Failed'],
                ['charging', 'Processing'],
                ['paid', 'Paid'],
                ['all', 'All'],
              ].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setBalanceFilter(v)}
                  className={`shrink-0 px-3 py-1.5 font-medium ${balanceFilter === v ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        ) : !tenantCards.length ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
            <p className="font-medium text-gray-700">No tenants for this filter</p>
            <p className="text-sm text-gray-400 mt-1">Import bills or switch filters. Draft bills appear after notify.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tenantCards.map((t) => (
              <TenantBalanceCard
                key={t.tenant_id || t.email}
                tenant={t}
                selectedBillId={selectedId}
                onOpenBill={setSelectedId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Tools (secondary) */}
      <details
        className="rounded-xl border border-slate-200 bg-white px-4 py-3"
        open={showTools}
        onToggle={(e) => setShowTools(e.target.open)}
      >
        <summary className="cursor-pointer text-sm font-semibold text-slate-800 select-none">
          Tools — Gmail import &amp; recalculate
          {draftCount ? <span className="ml-2 font-normal text-slate-500">({draftCount} draft{draftCount === 1 ? '' : 's'})</span> : null}
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={importFromGmail}
            disabled={!gmail.connected || importing}
            className="rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-40"
          >
            {importing ? 'Importing…' : 'Import from Gmail'}
          </button>
          <button
            type="button"
            onClick={calculateSplits}
            disabled={calculating}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {calculating ? 'Recalculating…' : 'Recalculate splits'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Auto-import runs about every 20 minutes. Use these if you need a manual pull.
        </p>

        {bills.filter((b) => b.status === 'draft').length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Draft bills</p>
            <ul className="space-y-1">
              {bills.filter((b) => b.status === 'draft').slice(0, 8).map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(b.id)}
                    className="text-sm text-indigo-700 hover:underline"
                  >
                    {SERVICE_LABEL[b.service_type] || b.service_type} · {fmtBillingMonth(b.billing_month)} · {fmtMoney(b.total_amount)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>

      {selectedId && (
        <BillDetail
          billId={selectedId}
          onChange={() => refreshAll({ soft: true })}
          onClose={() => setSelectedId(null)}
        />
      )}

      {showCreate && (
        <CreateBillModal
          onClose={() => setShowCreate(false)}
          onCreated={(data) => {
            setShowCreate(false);
            setSelectedId(data.bill.id);
            refreshAll();
          }}
        />
      )}
    </div>
  );
}
