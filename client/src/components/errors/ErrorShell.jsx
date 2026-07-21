import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

/**
 * Shared Montero Rentals error / empty-state shell (login-mesh branding).
 */
export default function ErrorShell({
  title = 'Something went wrong',
  message = 'We hit an unexpected problem. You can try again or return to a safe page.',
  icon = <Home size={28} strokeWidth={1.5} />,
  actions = [],
  technical = null,
  compact = false,
}) {
  const [showTech, setShowTech] = useState(false);
  const isDev = import.meta.env.DEV;

  return (
    <div className={`login-mesh flex min-h-[100dvh] flex-col items-center justify-center px-4 text-white ${compact ? 'py-12' : ''}`}>
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
          {icon}
        </div>
        <h1 className="mt-5 text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/80">{message}</p>

        {actions.length > 0 && (
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            {actions.map(({ label, onClick, to, primary }) => {
              const className = `rounded-xl px-5 py-3 text-sm font-semibold transition ${
                primary
                  ? 'bg-white text-slate-900 shadow-md hover:bg-white/90'
                  : 'bg-white/10 text-white ring-1 ring-white/25 hover:bg-white/15'
              }`;
              if (to) {
                return (
                  <Link key={label} to={to} className={className}>
                    {label}
                  </Link>
                );
              }
              return (
                <button key={label} type="button" onClick={onClick} className={className}>
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {isDev && technical && (
          <div className="mt-8 text-left">
            <button
              type="button"
              onClick={() => setShowTech((v) => !v)}
              className="text-xs font-medium text-white/60 underline-offset-2 hover:text-white/90 hover:underline"
            >
              {showTech ? 'Hide' : 'Show'} technical details (dev only)
            </button>
            {showTech && (
              <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-black/30 p-4 text-left text-[11px] leading-relaxed text-white/90 ring-1 ring-white/10">
                {technical}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
