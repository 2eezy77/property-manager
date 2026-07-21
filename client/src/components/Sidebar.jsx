/**
 * Sidebar — light SaaS layout inspired by Arche + Commercial RE dashboards on Dribbble.
 */
import React from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { meetsMinRole } from '@/utils/roles';

const ACCENTS = {
  admin: {
    active:   'bg-violet-50 text-violet-700 font-semibold',
    icon:     'text-violet-600',
    dot:      'bg-violet-500',
    avatar:   'bg-violet-100 text-violet-700',
    switchOn: 'bg-violet-600 text-white shadow-sm',
    switchOff:'text-slate-500 hover:bg-slate-100',
  },
  manager: {
    active:   'bg-emerald-50 text-emerald-700 font-semibold',
    icon:     'text-emerald-600',
    dot:      'bg-emerald-500',
    avatar:   'bg-emerald-100 text-emerald-700',
    switchOn: 'bg-emerald-600 text-white shadow-sm',
    switchOff:'text-slate-500 hover:bg-slate-100',
  },
  tenant: {
    active:   'bg-blue-50 text-blue-700 font-semibold',
    icon:     'text-blue-600',
    dot:      'bg-blue-500',
    avatar:   'bg-blue-100 text-blue-700',
    switchOn: '',
    switchOff:'',
  },
};

function initials(user) {
  const f = user?.firstName?.[0] ?? '';
  const l = user?.lastName?.[0] ?? '';
  return (f + l).toUpperCase() || '?';
}

export default function Sidebar({ portal, navItems, navSections, open = false, onClose, onNavigate }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const accent = ACCENTS[portal];
  const isOwner = meetsMinRole(user?.role, 'owner');

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const sections = navSections ?? [{ label: null, items: navItems }];

  const portalNavLabel =
    portal === 'admin' ? 'Owner navigation'
      : portal === 'manager' ? 'Manager navigation'
        : 'Tenant navigation';

  return (
    <aside
      id="portal-sidebar"
      aria-label={portalNavLabel}
      aria-hidden={!open}
      className={`fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[min(280px,88vw)] shrink-0 flex-col border-r border-slate-200 bg-white transition-transform duration-300 ease-out lg:w-[260px] ${
        open ? 'translate-x-0 pointer-events-auto shadow-2xl lg:shadow-none' : '-translate-x-full pointer-events-none'
      }`}
    >
      {/* Logo + collapse */}
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 sm:px-5 sm:py-5">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
            portal === 'admin' ? 'bg-violet-600 text-white' :
            portal === 'manager' ? 'bg-emerald-600 text-white' :
            'bg-blue-600 text-white'
          }`}
          aria-hidden
        >
          <Building2 size={20} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-900">Montero Rentals</p>
          <p className="truncate text-[11px] text-slate-400">
            {portal === 'tenant' ? '743 A Ave · Norfolk' : portal === 'admin' ? 'Owner Console' : 'Operations'}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
            aria-label="Hide sidebar"
            title="Hide sidebar"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Owner ↔ Manager switcher */}
      {isOwner && portal !== 'tenant' && (
        <nav
          aria-label="Switch portal"
          className="mx-4 mt-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"
        >
          <Link
            to="/admin"
            onClick={onNavigate}
            aria-current={portal === 'admin' ? 'page' : undefined}
            className={`rounded-lg py-1.5 text-center text-[11px] font-semibold transition ${
              portal === 'admin' ? accent.switchOn : accent.switchOff
            }`}
          >
            Owner
          </Link>
          <Link
            to="/manager"
            onClick={onNavigate}
            aria-current={portal === 'manager' ? 'page' : undefined}
            className={`rounded-lg py-1.5 text-center text-[11px] font-semibold transition ${
              portal === 'manager' ? accent.switchOn : accent.switchOff
            }`}
          >
            Manager
          </Link>
        </nav>
      )}

      {/* Nav sections */}
      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section, si) => {
          const headingId = section.label ? `nav-section-${si}` : undefined;
          return (
            <div key={si} className={si > 0 ? 'mt-6' : ''} role="group" aria-labelledby={headingId}>
              {section.label && (
                <h2
                  id={headingId}
                  className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400"
                >
                  {section.label}
                </h2>
              )}
              <ul className="space-y-0.5">
                {section.items.map(({ to, label, icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={to.split('/').filter(Boolean).length <= 1}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        `nav-motion flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                          isActive
                            ? accent.active
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center ${isActive ? accent.icon : 'text-slate-400'}`}
                            aria-hidden
                          >
                            {icon}
                          </span>
                          {label}
                          {isActive && (
                            <span className={`ml-auto h-1.5 w-1.5 rounded-full ${accent.dot}`} aria-hidden />
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* User */}
      <div className="border-t border-slate-100 p-4">
        <div className="hover-lift flex items-center gap-3 rounded-xl bg-slate-50 p-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${accent.avatar}`}>
            {initials(user)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="truncate text-[11px] text-slate-500">{user?.email}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="btn-motion mt-2 w-full rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
