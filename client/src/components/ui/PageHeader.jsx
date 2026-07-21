import React from 'react';

/**
 * @param {{
 *   portal?: 'admin' | 'manager' | 'tenant',
 *   title: string,
 *   subtitle?: string,
 *   badge?: string,
 *   actions?: React.ReactNode,
 * }} props
 */
export default function PageHeader({ portal, title, subtitle, badge, actions }) {
  const badgeClass = {
    admin:   'bg-admin/10 text-admin',
    manager: 'bg-manager/10 text-manager-dark',
    tenant:  'bg-brand-light text-brand-dark',
  }[portal] ?? 'bg-slate-100 text-slate-600';

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        {(portal || badge) && (
          <span className={`portal-pill mb-2 ${badgeClass}`}>
            {badge ?? (portal === 'admin' ? 'Owner Console' : portal === 'manager' ? 'Operations' : 'My Home')}
          </span>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
