import React from 'react';
import { Link } from 'react-router-dom';

const ICON_BG = {
  default: 'bg-slate-100 text-slate-600',
  success: 'bg-emerald-50 text-emerald-600',
  warning: 'bg-amber-50 text-amber-600',
  danger:  'bg-red-50 text-red-600',
  brand:   'bg-blue-50 text-blue-600',
  admin:   'bg-violet-50 text-violet-600',
  manager: 'bg-emerald-50 text-emerald-600',
  tenant:  'bg-blue-50 text-blue-600',
};

const VALUE_TONE = {
  default: 'text-slate-900',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger:  'text-red-600',
  brand:   'text-blue-600',
  admin:   'text-violet-600',
  manager: 'text-emerald-600',
  tenant:  'text-blue-600',
};

/**
 * Dribbble-style KPI card — icon circle + metric (Arche / Azmir pattern).
 */
export default function StatCard({ label, value, sub, to, icon, tone = 'default', loading }) {
  const inner = (
    <div className="portal-card hover-lift flex h-full flex-col p-5 transition-shadow">
      <div className="flex items-start justify-between gap-3">
        {icon && (
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg ${ICON_BG[tone]}`}>
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1 text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          {loading ? (
            <div className="ml-auto mt-2 h-8 w-20 skeleton" />
          ) : (
            <p className={`mt-1 text-2xl font-bold tabular-nums tracking-tight ${VALUE_TONE[tone]}`}>
              {value ?? '—'}
            </p>
          )}
        </div>
      </div>
      {sub && !loading && (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">{sub}</p>
      )}
    </div>
  );

  return to ? <Link to={to} className="block h-full">{inner}</Link> : inner;
}
