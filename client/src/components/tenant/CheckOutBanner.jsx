import React from 'react';
import { Link } from 'react-router-dom';
import { Mailbox, KeyRound, Banknote, ClipboardList } from 'lucide-react';

const STEPS = [
  { key: 'forwardingConfirmed', label: 'Confirm forwarding address', to: '/tenant/account', icon: <Mailbox size={16} strokeWidth={2} /> },
  { key: 'keysReturned', label: 'Confirm keys returned', to: '/tenant/account', icon: <KeyRound size={16} strokeWidth={2} /> },
  { key: 'finalChargesAck', label: 'Acknowledge final charges', to: '/tenant/payments', icon: <Banknote size={16} strokeWidth={2} /> },
  { key: 'moveoutConfirmed', label: 'Complete move-out checklist', to: '/tenant/maintenance', icon: <ClipboardList size={16} strokeWidth={2} /> },
];

function StepIndicator({ done }) {
  if (done) {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-600 text-white shadow-sm" aria-hidden>
        <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6.2 4.8 8.5 9.5 3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-rose-200 bg-white" aria-hidden />
  );
}

export default function CheckOutBanner({ offboarding, onMarkStep, busyKey }) {
  if (!offboarding?.active) return null;

  const completed = STEPS.filter((s) => offboarding[s.key]).length;
  const total = STEPS.length;
  if (completed >= total) return null;

  const pct = Math.round((completed / total) * 100);

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-rose-200/90 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.06)] ring-1 ring-rose-900/[0.04] sm:rounded-3xl"
      aria-label="Move-out checklist"
    >
      <div className="bg-gradient-to-r from-rose-50 to-slate-50 px-5 py-4 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-wider text-rose-700">Move-out</p>
        <h2 className="mt-1 text-lg font-bold text-slate-900">Complete your move-out steps</h2>
        <p className="mt-1 text-sm text-slate-600">
          {completed} of {total} done ({pct}%)
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-rose-100">
          <div className="h-full rounded-full bg-rose-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="divide-y divide-slate-100 px-5 py-2 sm:px-6">
        {STEPS.map(({ key, label, to, icon }) => {
          const done = offboarding[key];
          return (
            <li key={key} className="flex items-center gap-3 py-3">
              <StepIndicator done={done} />
              <div className="min-w-0 flex-1">
                <p className={`flex items-center gap-1.5 text-sm font-medium ${done ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center ${done ? 'text-slate-300' : 'text-rose-500'}`} aria-hidden>{icon}</span>
                  {label}
                </p>
              </div>
              {done ? (
                <span className="text-xs font-medium text-slate-500">Done</span>
              ) : onMarkStep ? (
                <button
                  type="button"
                  disabled={busyKey === key}
                  onClick={() => onMarkStep(key)}
                  className="shrink-0 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  Mark done
                </button>
              ) : (
                <Link to={to} className="shrink-0 text-xs font-semibold text-rose-700 hover:underline">
                  Open
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
