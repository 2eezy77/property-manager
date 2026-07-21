/**
 * Dashboard.jsx — Tenant "My Home" overview
 *
 * Cards:
 *  1. Rent balance / due date (pulls from /api/payments/balance)
 *  2. Active lease summary
 *  3. Open maintenance requests count
 *  4. Recent messages / unread count
 */

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Wrench, MessageSquare, FileText, CreditCard,
  Zap, Droplet, Flame, Globe, Trash2, Receipt, Waves,
  X, ChevronRight, CalendarClock,
} from 'lucide-react';
import api from '@/api/axios';
import ActionDock from '@/components/ui/ActionDock';
import Panel from '@/components/ui/Panel';
import RentHero from '@/components/ui/RentHero';
import CheckInBanner from '@/components/tenant/CheckInBanner';
import CheckOutBanner from '@/components/tenant/CheckOutBanner';
import { useCheckin } from '@/hooks/useCheckin';
import { useOffboarding, notifyOffboardingRefresh } from '@/hooks/useOffboarding';
import { isManagerImpersonation } from '@/utils/impersonation';

function fmt(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function daysUntil(iso) {
  if (!iso) return null;
  const diff = new Date(iso) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function LeaseCard({ lease }) {
  if (!lease) return null;
  const daysLeft = daysUntil(lease.end_date);
  const expiringSoon = daysLeft !== null && daysLeft < 60;

  return (
    <Link
      to="/tenant/lease"
      className={`portal-card hover-lift flex items-center gap-4 p-4 ${expiringSoon ? 'ring-1 ring-amber-200' : ''}`}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
        <FileText size={20} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Lease term</p>
        <p className="truncate font-semibold text-slate-900">{fmtDate(lease.start_date)} – {fmtDate(lease.end_date)}</p>
        {expiringSoon && (
          <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <CalendarClock size={13} /> Expires in {daysLeft} days
          </p>
        )}
      </div>
      {lease.status === 'active' && (
        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Active</span>
      )}
      {lease.status === 'pending_signature' && (
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Needs signature</span>
      )}
      <ChevronRight size={18} className="shrink-0 text-slate-300" />
    </Link>
  );
}

const SERVICE_ICON = {
  electric: Zap,
  water: Droplet,
  gas: Flame,
  internet: Globe,
  trash: Trash2,
  sewer: Waves,
  other: Receipt,
};

function ServiceGlyph({ type, className = '' }) {
  const Icon = SERVICE_ICON[type] || Receipt;
  return <Icon size={18} strokeWidth={2} className={className} />;
}

function hoursLeft(ts) {
  if (!ts) return null;
  const ms = new Date(ts) - new Date();
  return ms > 0 ? Math.ceil(ms / 3_600_000) : 0;
}

function UtilitySharesCard({ splits, onDispute }) {
  const open = splits.filter(s => ['notified', 'disputed', 'charging'].includes(s.status));
  if (open.length === 0) return null;

  return (
    <div className="portal-card hover-lift overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Zap size={16} strokeWidth={2} />
          </div>
          <h2 className="text-sm font-semibold text-slate-900">Utility shares</h2>
        </div>
        <span className="portal-pill bg-slate-100 text-slate-500">{open.length} open</span>
      </div>
      <ul className="divide-y divide-slate-50">
        {open.map(s => {
          const hrs = hoursLeft(s.dispute_deadline_at);
          const canDispute = s.status === 'notified' && hrs > 0;
          return (
            <li key={s.id} className="flex items-center gap-4 px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                <ServiceGlyph type={s.service_type} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium capitalize text-slate-900">
                  {s.service_type}
                  {s.provider_name ? <span className="font-normal text-slate-400"> · {s.provider_name}</span> : null}
                </p>
                <p className="text-xs text-slate-500">
                  {fmtDate(s.period_start)} – {fmtDate(s.period_end)} · Due {fmtDate(s.due_date)}
                </p>
                {s.status === 'notified' && hrs > 0 && (
                  <p className="mt-0.5 text-xs text-slate-400">Dispute window: {hrs}h left</p>
                )}
                {s.status === 'disputed' && (
                  <p className="mt-0.5 text-xs font-medium text-amber-600">Disputed — awaiting manager review</p>
                )}
                {s.status === 'charging' && (
                  <p className="mt-0.5 text-xs font-medium text-blue-600">ACH initiated — clears in 4–5 business days</p>
                )}
              </div>
              <div className="flex-none text-right">
                <p className="font-semibold tabular-nums text-slate-900">{fmt(s.amount)}</p>
                {canDispute && (
                  <button
                    onClick={() => onDispute(s)}
                    className="mt-1 text-xs font-medium text-amber-600 hover:underline"
                  >
                    Dispute
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DisputeModal({ split, onClose, onSubmitted }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true); setError('');
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
      <div className="w-full max-w-md bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Dispute utility share</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-600 shadow-sm">
              <ServiceGlyph type={split.service_type} />
            </div>
            <div className="text-sm">
              <p className="font-medium capitalize text-slate-900">{split.service_type} · {fmt(split.amount)}</p>
              <p className="text-xs text-slate-400">{fmtDate(split.period_start)} – {fmtDate(split.period_end)}</p>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reason for dispute *</label>
            <textarea
              required
              rows={4}
              className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Explain why this amount doesn't seem right…"
            />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="btn-motion flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !reason.trim()}
              className="btn-motion flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-600 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit dispute'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const MSG_ICON = {
  maintenance: Wrench,
  payment: CreditCard,
  default: MessageSquare,
};

export default function TenantDashboard() {
  const managerPreview = isManagerImpersonation();
  const { checkin, loading: checkinLoading } = useCheckin({ enabled: !managerPreview });
  const { offboarding, loading: offboardLoading, refetch: refetchOffboard } = useOffboarding({
    enabled: !managerPreview,
  });
  const [offboardBusy, setOffboardBusy] = useState(null);

  async function markOffboardStep(step) {
    setOffboardBusy(step);
    try {
      await api.patch('/api/users/me/offboarding', { step });
      notifyOffboardingRefresh();
      await refetchOffboard();
    } catch {
      /* tolerated */
    } finally {
      setOffboardBusy(null);
    }
  }
  const [balance, setBalance]     = useState(null);
  const [lease, setLease]         = useState(null);
  const [maintenance, setMaint]   = useState(null);
  const [threads, setThreads]     = useState(null);
  const [utilities, setUtilities] = useState([]);
  const [disputing, setDisputing] = useState(null);
  const [loading, setLoading]     = useState(true);

  const loadUtilities = React.useCallback(async () => {
    try {
      const { data } = await api.get('/api/utilities/my-splits');
      setUtilities(data.splits ?? []);
    } catch { /* tolerated */ }
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const [balRes, leaseRes, maintRes, msgRes, utilRes] = await Promise.allSettled([
          api.get('/api/payments/balance'),
          api.get('/api/leases/my'),
          api.get('/api/maintenance/my'),
          api.get('/api/messages/threads'),
          api.get('/api/utilities/my-splits'),
        ]);

        if (balRes.status === 'fulfilled')   setBalance(balRes.value.data);
        if (leaseRes.status === 'fulfilled') setLease(leaseRes.value.data.leases?.[0] ?? null);
        if (maintRes.status === 'fulfilled') setMaint(maintRes.value.data);
        if (msgRes.status === 'fulfilled')   setThreads(msgRes.value.data.threads ?? []);
        if (utilRes.status === 'fulfilled')  setUtilities(utilRes.value.data.splits ?? []);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const openMaint   = maintenance?.requests?.filter(r => !['resolved', 'cancelled'].includes(r.status)).length ?? 0;
  const unreadMsgs  = threads?.reduce((n, t) => n + Number(t.unread_count ?? 0), 0) ?? 0;

  return (
    <div className="stagger-section space-y-6">
      {!managerPreview && !offboardLoading && offboarding?.active && (
        <div className="-mx-1 sm:mx-0">
          <CheckOutBanner
            offboarding={offboarding}
            onMarkStep={markOffboardStep}
            busyKey={offboardBusy}
          />
        </div>
      )}

      {!managerPreview && !checkinLoading && !offboarding?.active && (
        <div className="-mx-1 sm:mx-0">
          <CheckInBanner checkin={checkin} />
        </div>
      )}

      <ActionDock
        portal="tenant"
        actions={[
          ...(managerPreview ? [] : [{ to: '/tenant/payments', label: 'Pay Rent', icon: <CreditCard size={22} strokeWidth={2} /> }]),
          { to: '/tenant/maintenance', label: 'Report',   icon: <Wrench size={22} strokeWidth={2} />,        badge: openMaint },
          { to: '/tenant/messages',    label: 'Messages', icon: <MessageSquare size={22} strokeWidth={2} />, badge: unreadMsgs },
          { to: '/tenant/lease',       label: 'My Lease', icon: <FileText size={22} strokeWidth={2} /> },
        ]}
      />

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-44 rounded-2xl" />
          <div className="skeleton h-28 rounded-2xl" />
        </div>
      ) : (
        <>
          {/* Rent first — ePayRent / Oshadhi pattern */}
          <RentHero balance={balance} hidePayAction={managerPreview} />

          <Link
            to="/tenant/payments"
            className="portal-card hover-lift block border border-blue-100 bg-blue-50/60 px-4 py-3"
          >
            <p className="text-sm font-semibold text-blue-950">Pay rent in the portal</p>
            <p className="mt-1 text-xs leading-relaxed text-blue-900/80">
              Autopay waives late fees. Cash App Pay on Payments posts to your balance immediately.
              Outside cashtag sends can lag — use Payments when you can.
              {balance?.securityDepositPayment
                ? ` Security deposit still due (${fmt(balance.securityDepositPayment.amount)}).`
                : ''}
            </p>
            <p className="mt-2 text-xs font-semibold text-blue-700">Open Payments →</p>
          </Link>

          <LeaseCard lease={lease} />

          {/* Utility shares */}
          <UtilitySharesCard splits={utilities} onDispute={setDisputing} />

          {/* Recent messages */}
          {threads && threads.length > 0 && (
            <Panel title="Recent Messages" actionTo="/tenant/messages" className="!p-0">
              <div className="-mx-5 -mb-5">
                <ul className="stagger-list divide-y divide-slate-100">
                  {threads.slice(0, 4).map(t => {
                    const Icon = MSG_ICON[t.category] || MSG_ICON.default;
                    return (
                      <li key={t.id}>
                        <Link to="/tenant/messages" className="flex items-start gap-4 px-5 py-4 transition hover:bg-slate-50">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                            <Icon size={18} strokeWidth={2} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium text-slate-900">{t.subject || 'Message thread'}</p>
                              {Number(t.unread_count) > 0 && (
                                <span className="flex-none rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">{t.unread_count}</span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-slate-500">{t.last_message || 'No messages yet'}</p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Panel>
          )}
        </>
      )}

      {disputing && (
        <DisputeModal
          split={disputing}
          onClose={() => setDisputing(null)}
          onSubmitted={() => { setDisputing(null); loadUtilities(); }}
        />
      )}
    </div>
  );
}
