import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Section panel — white card with header row (common in Dribbble SaaS dashboards).
 */
export default function Panel({ title, actionLabel, actionTo, children, className = '', id }) {
  return (
    <div id={id} className={`portal-card hover-lift overflow-hidden ${className}`}>
      {(title || actionTo) && (
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
          {actionTo && (
            <Link to={actionTo} className="btn-motion text-xs font-medium text-slate-500 transition hover:text-slate-800">
              {actionLabel ?? 'View all'} →
            </Link>
          )}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}
