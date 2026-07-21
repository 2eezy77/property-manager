import React from 'react';
import { Link } from 'react-router-dom';
import { Hand, Lock, Landmark, FileText, Wrench } from 'lucide-react';

const STEPS = [
  { key: 'passwordChanged', label: 'Change your password', hint: 'Account Settings', to: '/tenant/account', icon: <Lock size={18} strokeWidth={2} /> },
  { key: 'bankLinked', label: 'Link your bank account', hint: 'Payments', to: '/tenant/payments', icon: <Landmark size={18} strokeWidth={2} /> },
  { key: 'leaseViewed', label: 'Review your lease', hint: 'Lease', to: '/tenant/lease', icon: <FileText size={18} strokeWidth={2} /> },
  { key: 'maintenanceViewed', label: 'Check maintenance', hint: 'Maintenance', to: '/tenant/maintenance', icon: <Wrench size={18} strokeWidth={2} /> },
];

function StepIndicator({ done }) {
  if (done) {
    return (
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm"
        aria-hidden
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6.2 4.8 8.5 9.5 3.5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-slate-200 bg-white"
      aria-hidden
    />
  );
}

export default function CheckInBanner({ checkin }) {
  if (!checkin) return null;

  const completed = STEPS.filter((s) => checkin[s.key]).length;
  const total = STEPS.length;
  if (completed >= total) return null;

  const pct = Math.round((completed / total) * 100);

  return (
    <section
      className="checkin-popup relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.08)] ring-1 ring-slate-900/[0.04] sm:rounded-3xl"
      aria-label="Move-in checklist"
      role="region"
    >
      <div className="relative h-1 bg-slate-100" aria-hidden>
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="p-4 sm:p-6">
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-orange-50 text-amber-600 sm:h-12 sm:w-12">
            <Hand size={22} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600">
              Welcome
            </p>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
              Complete your check-in
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {completed} of {total} done — finish setup to pay rent and submit requests.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <span className="text-2xl font-bold tabular-nums text-slate-900 sm:text-3xl">
              {completed}
              <span className="text-base font-medium text-slate-400">/{total}</span>
            </span>
          </div>
        </div>

        <ul className="mt-5 space-y-2 sm:mt-6">
          {STEPS.map(({ key, label, hint, to, icon }, index) => {
            const done = checkin[key];
            const rowInner = (
              <>
                <StepIndicator done={done} />
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center ${done ? 'text-slate-300' : 'text-slate-500'}`} aria-hidden>
                  {icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium sm:text-[15px] ${
                      done ? 'text-slate-400 line-through' : 'text-slate-900'
                    }`}
                  >
                    {label}
                  </p>
                  {!done && (
                    <p className="text-xs text-slate-500">{hint}</p>
                  )}
                </div>
                {!done && (
                  <span className="shrink-0 text-slate-300" aria-hidden>
                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                )}
              </>
            );

            return (
              <li
                key={key}
                className="checkin-step"
                style={{ animationDelay: `${80 + index * 50}ms` }}
              >
                {done ? (
                  <div className="flex min-h-[48px] items-center gap-3 rounded-xl bg-slate-50/80 px-3 py-2.5 sm:min-h-[52px] sm:px-4">
                    {rowInner}
                  </div>
                ) : (
                  <Link
                    to={to}
                    className="flex min-h-[48px] items-center gap-3 rounded-xl border border-transparent bg-slate-50/50 px-3 py-2.5 transition hover:border-amber-200/80 hover:bg-amber-50/60 active:scale-[0.99] sm:min-h-[52px] sm:px-4"
                  >
                    {rowInner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>

        <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600 sm:text-sm">
          Rent is due on the <span className="font-medium text-slate-800">1st</span>.
          Late fees apply after your grace period.
        </p>
      </div>
    </section>
  );
}
