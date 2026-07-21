import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Circular quick-action dock — inspired by Dribbble tenant apps (Oshadhi / ePayRent).
 */
export default function ActionDock({ actions, portal = 'tenant' }) {
  const ring = {
    tenant:  'hover:border-blue-200 hover:bg-blue-50',
    manager: 'hover:border-emerald-200 hover:bg-emerald-50',
    admin:   'hover:border-violet-200 hover:bg-violet-50',
  }[portal];

  const iconBg = {
    tenant:  'bg-blue-100 text-blue-700',
    manager: 'bg-emerald-100 text-emerald-700',
    admin:   'bg-violet-100 text-violet-700',
  }[portal];

  return (
    <div className="stagger-grid grid grid-cols-2 gap-3 sm:grid-cols-4">
      {actions.map(({ to, label, icon, badge }) => (
        <Link
          key={to}
          to={to}
          className={`hover-scale btn-motion flex flex-col items-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-4 text-center transition ${ring}`}
        >
          <div className={`relative flex h-12 w-12 items-center justify-center rounded-2xl text-xl ${iconBg}`}>
            {icon}
            {badge != null && badge > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {badge}
              </span>
            )}
          </div>
          <span className="text-xs font-semibold text-slate-700">{label}</span>
        </Link>
      ))}
    </div>
  );
}
