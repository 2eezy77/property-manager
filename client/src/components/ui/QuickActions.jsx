import React from 'react';
import { Link } from 'react-router-dom';

/**
 * @param {{
 *   actions: { to: string, label: string, icon: string, desc?: string, variant?: 'primary' | 'default' }[],
 *   portal?: 'admin' | 'manager' | 'tenant',
 * }} props
 */
export default function QuickActions({ actions, portal = 'manager' }) {
  const primaryClass = {
    admin:   'bg-admin text-white hover:bg-admin-dark shadow-sm',
    manager: 'bg-manager text-white hover:bg-manager-dark shadow-sm',
    tenant:  'bg-brand text-white hover:bg-brand-dark shadow-sm',
  }[portal];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {actions.map(({ to, label, icon, desc, variant = 'default' }) => (
        <Link
          key={to + label}
          to={to}
          className={`group flex items-center gap-3 rounded-2xl border p-4 transition-all duration-200 ${
            variant === 'primary'
              ? primaryClass
              : 'border-slate-200/80 bg-white hover:border-slate-300 hover:shadow-md'
          }`}
        >
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${
            variant === 'primary' ? 'bg-white/20' : 'bg-slate-50 group-hover:bg-slate-100'
          }`}>
            {icon}
          </span>
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${variant === 'primary' ? 'text-white' : 'text-slate-900'}`}>
              {label}
            </p>
            {desc && (
              <p className={`truncate text-xs ${variant === 'primary' ? 'text-white/80' : 'text-slate-500'}`}>
                {desc}
              </p>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
