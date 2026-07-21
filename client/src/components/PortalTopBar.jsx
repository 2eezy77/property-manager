import React from 'react';
import { useLocation } from 'react-router-dom';

const PORTAL_META = {
  admin:   { label: 'Owner Console', accent: 'text-violet-600' },
  manager: { label: 'Operations',    accent: 'text-emerald-600' },
  tenant:  { label: 'My Home',       accent: 'text-blue-600' },
};

function pageTitle(pathname) {
  const map = {
    '/admin': 'Overview',
    '/admin/organizations': 'Organizations',
    '/admin/users': 'Users',
    '/admin/activity': 'Activity log',
    '/admin/site-visits': 'Boots on site',
    '/manager/site-visits': 'Boots on site',
    '/manager': 'Dashboard',
    '/manager/properties': 'Properties',
    '/manager/tenants': 'Tenants',
    '/manager/leases': 'Leases',
    '/manager/maintenance': 'Maintenance',
    '/manager/messages': 'Inbox',
    '/manager/payments': 'Payments',
    '/manager/utilities': 'Utilities',
    '/manager/announcements': 'Announcements',
    '/manager/account': 'Account',
    '/tenant': 'My Home',
    '/tenant/lease': 'My Lease',
    '/tenant/payments': 'Payments',
    '/tenant/maintenance': 'Maintenance',
    '/tenant/messages': 'Messages',
    '/tenant/announcements': 'Announcements',
    '/tenant/account': 'Account',
  };
  return map[pathname] ?? 'Montero Rentals';
}

export default function PortalTopBar({ portal, sidebarOpen, onToggleSidebar }) {
  const { pathname } = useLocation();
  const meta = PORTAL_META[portal];
  const title = pageTitle(pathname);
  const showEyebrow = meta.label.toLowerCase() !== title.toLowerCase();
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });

  return (
    <header className="motion-topbar sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="px-4 py-3 sm:px-6 sm:py-4 lg:px-10">
        <div className="flex items-start gap-3 sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {onToggleSidebar && (
              <button
                type="button"
                onClick={onToggleSidebar}
                className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
                aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
                aria-expanded={sidebarOpen}
                aria-controls="portal-sidebar"
                title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              >
                {sidebarOpen ? (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            )}
            <div className="min-w-0">
              {showEyebrow && (
                <p className={`text-[10px] font-bold uppercase tracking-wider sm:text-[11px] ${meta.accent}`}>
                  {meta.label}
                </p>
              )}
              <h1 className="truncate text-base font-bold text-slate-900 sm:text-xl">
                {title}
              </h1>
            </div>
          </div>
          <div className="hidden shrink-0 items-center gap-3 sm:flex">
            <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
              {today}
            </span>
          </div>
        </div>
      </div>
      <div className={`h-0.5 w-full ${
        portal === 'admin' ? 'bg-gradient-to-r from-violet-500 to-indigo-500' :
        portal === 'manager' ? 'bg-gradient-to-r from-emerald-500 to-teal-500' :
        'bg-gradient-to-r from-blue-500 to-blue-600'
      }`} />
    </header>
  );
}
