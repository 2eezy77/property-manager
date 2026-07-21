import React from 'react';
import {
  Mail, KeyRound, Banknote, ClipboardCheck, Ban, Landmark, Lightbulb, Lock, Check,
} from 'lucide-react';

export const OFFBOARDING_STEPS = [
  { key: 'forwardingConfirmed', short: 'Forward', Icon: Mail },
  { key: 'keysReturned', short: 'Keys', Icon: KeyRound },
  { key: 'finalChargesAck', short: 'Charges', Icon: Banknote },
  { key: 'moveoutConfirmed', short: 'Walkout', Icon: ClipboardCheck },
  { key: 'vivintRevoked', short: 'Vivint', Icon: Ban, staffOnly: true },
  { key: 'bankUnlinked', short: 'Bank', Icon: Landmark, staffOnly: true },
  { key: 'utilitiesSettled', short: 'Utils', Icon: Lightbulb, staffOnly: true },
  { key: 'portalDisabled', short: 'Portal', Icon: Lock, staffOnly: true },
];

export function OffboardingProgress({ offboarding, compact = false }) {
  if (!offboarding?.active) return <span className="text-xs text-gray-400">—</span>;

  const { completedCount, totalSteps, allComplete } = offboarding;
  const pct = Math.round((completedCount / totalSteps) * 100);

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
          allComplete
            ? 'bg-slate-200 text-slate-800'
            : completedCount > 0
              ? 'bg-rose-100 text-rose-800'
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
        aria-label={`${completedCount} of ${totalSteps} move-out steps`}
      >
        <svg className="h-8 w-8 -rotate-90" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="14" fill="none" stroke="#e2e8f0" strokeWidth="3" />
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke={allComplete ? '#64748b' : '#f43f5e'}
            strokeWidth="3"
            strokeDasharray={`${(pct / 100) * 88} 88`}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-700">
          {completedCount}
        </span>
      </div>
      <span className={`text-xs font-medium ${allComplete ? 'text-slate-700' : 'text-rose-700'}`}>
        {allComplete ? 'Move-out complete' : `${completedCount}/${totalSteps} steps`}
      </span>
    </div>
  );
}

export function OffboardingStepList({ offboarding, onToggleStep, busyKey }) {
  if (!offboarding?.active) return null;

  return (
    <ul className="grid grid-cols-2 gap-2">
      {OFFBOARDING_STEPS.map(({ key, short, Icon, staffOnly }) => {
        const done = offboarding[key];
        const canToggle = staffOnly && onToggleStep;
        return (
          <li
            key={key}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              done ? 'border-slate-300 bg-slate-100' : 'border-rose-100 bg-rose-50/50'
            }`}
          >
            <Icon size={16} strokeWidth={2} aria-hidden className={done ? 'text-slate-600' : 'text-rose-400'} />
            <span className={done ? 'font-medium text-slate-800' : 'text-slate-600'}>
              {short}
              {staffOnly && <span className="ml-1 text-[10px] font-normal text-violet-600">(you)</span>}
            </span>
            {canToggle ? (
              <button
                type="button"
                disabled={busyKey === key}
                onClick={() => onToggleStep(key, !done)}
                className={`ml-auto text-xs font-semibold underline-offset-2 hover:underline disabled:opacity-50 ${
                  done ? 'text-slate-600' : 'text-rose-700'
                }`}
              >
                {done ? 'Undo' : 'Mark'}
              </button>
            ) : (
              <span className={`ml-auto text-xs ${done ? 'text-slate-600' : 'text-rose-500'}`}>
                {done ? 'Done' : staffOnly ? 'Pending' : 'Tenant'}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
