import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Home, CalendarClock, Package, Check } from 'lucide-react';
import api from '@/api/axios';
import { useAuth } from '@/context/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import Panel from '@/components/ui/Panel';
import RentCollectionPanel from '@/components/manager/RentCollectionPanel';

/** Plain-language guide keyed by server category (overrides DB label/notes in the UI). */
const STEP_GUIDE = {
  tenant_passwords: {
    phase: 'move_in',
    title: 'Tenants set their own login passwords',
    help: 'Ask each tenant to log in at least once and change their password from the default. You can see who still needs to do this on the Tenants page.',
    where: { label: 'Open Tenants', path: '/manager/tenants' },
  },
  bank_links: {
    phase: 'move_in',
    title: 'Tenants link a bank account for rent',
    help: 'Each tenant uses “Link bank” on their Payments page so rent can be paid electronically. Confirm everyone has a bank connected before you charge rent.',
    where: { label: 'Open Tenants', path: '/manager/tenants' },
  },
  vivint_access: {
    phase: 'move_in',
    title: 'Smart home / door access is set up',
    help: 'Give each tenant Vivint (or building) access — codes, fobs, or app access. Then mark Vivint complete on their move-in checklist in Tenants.',
    where: { label: 'Open Tenants', path: '/manager/tenants' },
  },
  lease_review: {
    phase: 'move_in',
    title: 'Leases are signed and visible in the portal',
    help: 'Each tenant should open their lease in the app so they know rent amount and dates. Use Leases to track status.',
    where: { label: 'Open Leases', path: '/manager/leases' },
  },
  maintenance_intro: {
    phase: 'move_in',
    title: 'Tenants know how to request repairs',
    help: 'Show them the Maintenance section: emergencies vs normal requests. They can submit photos and notes from their phone.',
    where: { label: 'Maintenance queue', path: '/manager/maintenance' },
  },
  rent_collection: {
    phase: 'ongoing',
    title: 'Rent payments are on track this month',
    help: 'Check who has paid, who is late, and any failed bank payments. Tenants pay rent via ACH or Cash App Pay in their portal.',
    where: { label: 'Open Payments', path: '/manager/payments' },
  },
  utilities: {
    phase: 'ongoing',
    title: 'Utility bills are split and sent to tenants',
    help: 'When water or electric bills arrive, add the bill under Utilities, notify tenants, then charge their share after the dispute window.',
    where: { label: 'Open Utilities', path: '/manager/utilities' },
  },
  announcements: {
    phase: 'ongoing',
    title: 'House rules and reminders are posted',
    help: 'Send announcements for trash day, quiet hours, Wi‑Fi password, and emergency contacts so everyone sees the same info.',
    where: { label: 'Open Announcements', path: '/manager/announcements' },
  },
  inbox_sla: {
    phase: 'ongoing',
    title: 'Tenant messages are answered',
    help: 'Check the inbox at least once a day. Reply within 24 hours when you can; call the owner for true emergencies.',
    where: { label: 'Open Inbox', path: '/manager/messages' },
  },
  cashapp_imports: {
    phase: 'ongoing',
    title: 'Offline payments are recorded in the ledger',
    help: 'If someone paid via Cash App, Zelle, or check, record it under Payments so the books match what you actually received.',
    where: { label: 'Open Payments', path: '/manager/payments' },
  },
  tenant_offboarding: {
    phase: 'move_out',
    title: 'Move-out checklist is finished',
    help: 'When a tenant leaves: run the move-out steps (keys, final utilities, deposit). Track progress on their tenant profile.',
    where: { label: 'Open Tenants', path: '/manager/tenants' },
  },
};

const PHASES = [
  {
    id: 'move_in',
    Icon: Home,
    title: 'New tenant move-in',
    blurb: 'Do these once when someone new moves into 743 A Ave.',
  },
  {
    id: 'ongoing',
    Icon: CalendarClock,
    title: 'Regular operations',
    blurb: 'Repeat monthly or whenever bills and messages come in.',
  },
  {
    id: 'move_out',
    Icon: Package,
    title: 'Tenant move-out',
    blurb: 'When someone leaves the property.',
  },
];

function relTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function guideFor(item) {
  const g = STEP_GUIDE[item.category];
  if (g) return g;
  return {
    phase: 'ongoing',
    title: item.label,
    help: item.notes || 'Complete this task for 743 A Ave.',
    where: null,
  };
}

function statusLabel(item, isOwner) {
  if (item.last_verified_at && isOwner) return { text: 'Owner verified', className: 'bg-violet-100 text-violet-800' };
  if (item.last_completed_at) return { text: 'Done', className: 'bg-emerald-100 text-emerald-800' };
  return { text: 'Not started', className: 'bg-slate-100 text-slate-600' };
}

const LEVEL_STYLES = {
  ok: { border: 'border-emerald-200 bg-emerald-50/60', badge: 'bg-emerald-100 text-emerald-800', label: 'On track' },
  watch: { border: 'border-amber-200 bg-amber-50/50', badge: 'bg-amber-100 text-amber-800', label: 'Watch' },
  action: { border: 'border-orange-200 bg-orange-50/50', badge: 'bg-orange-100 text-orange-900', label: 'Needs action' },
};

const ROW_DOT = {
  ok: 'bg-emerald-500',
  info: 'bg-slate-400',
  warn: 'bg-amber-500',
  danger: 'bg-red-500',
};

function mailtoLink(email, subject) {
  if (!email) return null;
  const q = new URLSearchParams();
  if (subject) q.set('subject', subject);
  return `mailto:${email}?${q.toString()}`;
}

function StepInsightPanel({ snapshot }) {
  if (!snapshot?.headline) return null;
  const style = LEVEL_STYLES[snapshot.level] || LEVEL_STYLES.watch;
  const rows = snapshot.rows || [];

  return (
    <div className={`mt-4 rounded-lg border p-3 ${style.border}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.badge}`}>
          {style.label}
        </span>
        <p className="text-sm font-medium text-slate-800">{snapshot.headline}</p>
      </div>

      {rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((r, i) => {
            const href = mailtoLink(r.email, r.emailSubject);
            return (
              <li key={r.id || `${r.label}-${i}`} className="flex items-start gap-2 text-sm">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ROW_DOT[r.status] || ROW_DOT.info}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{r.label}</p>
                  {r.detail && <p className="text-xs text-slate-600">{r.detail}</p>}
                </div>
                {href && r.emailHint && (
                  <a
                    href={href}
                    className="shrink-0 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    {r.emailHint}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function ManagerPlaybookPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const portal = isOwner ? 'admin' : 'manager';

  const [items, setItems] = useState([]);
  const [insights, setInsights] = useState({ byCategory: {}, monthLabel: '', rentStatus: null });
  const [summary, setSummary] = useState({ total: 0, completed: 0, verified: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const { data } = await api.get('/api/manager/playbook');
      setItems(data.items || []);
      setSummary({
        total: data.total ?? (data.items || []).length,
        completed: data.completed ?? 0,
        verified: data.verified ?? 0,
      });
      setInsights(data.insights || { byCategory: {}, rentStatus: null });
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not load checklist.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function patchItem(id, body) {
    setBusyId(id);
    try {
      const { data } = await api.patch(`/api/manager/playbook/${id}`, body);
      setItems((prev) => prev.map((i) => (i.id === id ? data.item : i)));
      await load();
    } catch (e) {
      setErr(e.response?.data?.message || 'Update failed.');
    } finally {
      setBusyId(null);
    }
  }

  const pct = summary.total ? Math.round((summary.completed / summary.total) * 100) : 0;

  const grouped = PHASES.map((phase) => ({
    ...phase,
    items: items
      .map((item) => ({ item, guide: guideFor(item) }))
      .filter(({ guide }) => guide.phase === phase.id)
      .sort((a, b) => (a.item.sort_order ?? 0) - (b.item.sort_order ?? 0)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="stagger-section mx-auto max-w-3xl space-y-6">
      <PageHeader
        portal={portal}
        title="Move-in & operations checklist"
        subtitle="A simple to-do list for running 743 A Ave. Work top to bottom; tap a link to open the right screen."
      />

      <Panel className="!p-5 bg-indigo-50/80 border-indigo-100">
        <h2 className="text-sm font-semibold text-slate-900">What is this page?</h2>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          This checklist helps you remember important tasks when tenants move in, during the month, and when someone moves out.
          Live boxes under each step show who still owes rent or utilities, who has not finished move-in tasks, and inbox threads that need a reply. Mark a step complete when you have handled it.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
          <li>
            <span className="font-medium text-emerald-800">Mark complete</span>
            {' '}
            — you finished the task.
          </li>
          {isOwner && (
            <li>
              <span className="font-medium text-violet-800">Owner sign-off</span>
              {' '}
              — optional second check (owners only).
            </li>
          )}
        </ul>
      </Panel>

      {!loading && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-slate-700">Your progress</span>
            <span className="tabular-nums text-slate-600">
              {summary.completed} of {summary.total} complete ({pct}%)
            </span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {err && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 skeleton rounded-xl" />
          ))}
        </div>
      ) : (
        grouped.map((phase) => (
          <section key={phase.id} className="space-y-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <phase.Icon size={20} strokeWidth={2} className="text-slate-500" />
                {phase.title}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">{phase.blurb}</p>
            </div>

            <ul className="space-y-3">
              {phase.items.map(({ item, guide }, idx) => {
                const status = statusLabel(item, isOwner);
                const done = !!item.last_completed_at;
                const linkPath = guide.where?.path;

                return (
                  <li
                    key={item.id}
                    className={`rounded-xl border bg-white p-4 shadow-sm transition-colors ${
                      done ? 'border-emerald-200/80' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Step {idx + 1}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.className}`}>
                        {status.text}
                      </span>
                    </div>

                    <h3 className="mt-2 text-base font-semibold text-slate-900">{guide.title}</h3>
                    <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{guide.help}</p>

                    {guide.where && linkPath && (
                      <Link
                        to={linkPath}
                        className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                      >
                        {guide.where.label}
                        <span aria-hidden>→</span>
                      </Link>
                    )}

                    {item.category === 'rent_collection' && insights.rentStatus ? (
                      <div className="mt-4">
                        <RentCollectionPanel data={insights.rentStatus} loading={false} />
                      </div>
                    ) : (
                      <StepInsightPanel snapshot={insights.byCategory?.[item.category]} />
                    )}

                    {(item.last_completed_at || item.last_verified_at) && (
                      <p className="mt-2 text-xs text-slate-400">
                        {item.last_completed_at && `Marked done ${relTime(item.last_completed_at)}`}
                        {item.last_verified_at && isOwner && ` · Owner sign-off ${relTime(item.last_verified_at)}`}
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                      {!done ? (
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => patchItem(item.id, { mark_completed: true })}
                          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Mark complete
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                          <Check size={14} strokeWidth={3} /> Completed
                        </span>
                      )}

                      {isOwner && done && !item.last_verified_at && (
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => patchItem(item.id, { mark_verified: true })}
                          className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                        >
                          Owner sign-off
                        </button>
                      )}

                      {(item.last_completed_at || item.last_verified_at) && (
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => patchItem(item.id, { clear_completed: true, clear_verified: true })}
                          className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
                        >
                          Undo
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {!loading && items.length === 0 && (
        <p className="text-center text-sm text-slate-500">No checklist items yet. Refresh the page to load defaults.</p>
      )}

      <p className="text-center text-xs text-slate-400 pb-4">
        Questions about a step? Ask the property owner. This list is only for 743 A Ave, Norfolk.
      </p>
    </div>
  );
}
