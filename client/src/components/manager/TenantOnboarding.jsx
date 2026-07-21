import React from 'react';
import { Lock, Landmark, FileText, Wrench, KeyRound, Check } from 'lucide-react';

export const ONBOARDING_STEPS = [
  { key: 'passwordChanged', short: 'Pwd', Icon: Lock },
  { key: 'bankLinked', short: 'Bank', Icon: Landmark },
  { key: 'leaseViewed', short: 'Lease', Icon: FileText },
  { key: 'maintenanceViewed', short: 'Maint', Icon: Wrench },
  { key: 'vivintAccessConfigured', short: 'Vivint', Icon: KeyRound, staffOnly: true },
];

export function OnboardingProgress({ checkin, compact = false }) {
  if (!checkin) return <span className="text-xs text-gray-400">—</span>;

  const { completedCount, totalSteps, allComplete } = checkin;
  const pct = Math.round((completedCount / totalSteps) * 100);

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
          allComplete
            ? 'bg-emerald-100 text-emerald-800'
            : completedCount > 0
              ? 'bg-amber-100 text-amber-800'
              : 'bg-slate-100 text-slate-600'
        }`}
      >
        {allComplete ? <Check size={12} strokeWidth={3} /> : `${completedCount}/${totalSteps}`}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-8 w-8 shrink-0"
        role="img"
        aria-label={`${completedCount} of ${totalSteps} onboarding steps`}
      >
        <svg className="h-8 w-8 -rotate-90" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="14" fill="none" stroke="#e2e8f0" strokeWidth="3" />
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke={allComplete ? '#10b981' : '#6366f1'}
            strokeWidth="3"
            strokeDasharray={`${(pct / 100) * 88} 88`}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-700">
          {completedCount}
        </span>
      </div>
      <span className={`text-xs font-medium ${allComplete ? 'text-emerald-700' : 'text-slate-600'}`}>
        {allComplete ? 'Complete' : `${completedCount}/${totalSteps} steps`}
      </span>
    </div>
  );
}

export function OnboardingStepList({ checkin }) {
  if (!checkin) return null;

  return (
    <ul className="grid grid-cols-2 gap-2">
      {ONBOARDING_STEPS.map(({ key, short, Icon, staffOnly }) => {
        const done = checkin[key];
        return (
          <li
            key={key}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              done ? 'border-emerald-200 bg-emerald-50/80' : 'border-slate-200 bg-slate-50'
            }`}
          >
            <Icon size={16} strokeWidth={2} aria-hidden className={done ? 'text-emerald-600' : 'text-slate-400'} />
            <span className={done ? 'font-medium text-emerald-800' : 'text-slate-600'}>
              {short}
              {staffOnly && <span className="ml-1 text-[10px] font-normal text-violet-600">(you)</span>}
            </span>
            <span className={`ml-auto text-xs ${done ? 'text-emerald-600' : 'text-slate-400'}`}>
              {done ? 'Done' : staffOnly ? 'Set up' : 'Pending'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
