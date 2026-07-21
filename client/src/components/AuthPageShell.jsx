/**
 * Shared left brand + right panel shell for login / forgot / reset pages.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';

export default function AuthPageShell({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-[100dvh] flex-col lg:flex-row">
      <a href="#auth-main" className="skip-link">
        Skip to sign-in form
      </a>

      <aside
        aria-label="Montero Rentals"
        className="login-mesh login-grid relative flex min-h-[220px] flex-col justify-between overflow-hidden p-8 text-white lg:min-h-[100dvh] lg:w-[52%] lg:p-12 xl:p-16"
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="login-float absolute right-8 top-28 hidden h-36 w-36 rounded-full bg-indigo-500/20 blur-3xl lg:block" />
          <div className="login-float-delay absolute bottom-24 left-12 hidden h-44 w-44 rounded-full bg-violet-500/15 blur-3xl lg:block" />
        </div>

        <div className="relative z-10">
          <Link to="/login" className="flex items-center gap-3 text-white no-underline">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur-sm"
              aria-hidden
            >
              <Building2 size={24} strokeWidth={2} />
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight">Montero Rentals</p>
              <p className="text-xs text-white/55">743 A Ave · Norfolk, VA</p>
            </div>
          </Link>
        </div>

        <div className="relative z-10 mt-8 lg:mt-0">
          <p className="max-w-lg text-3xl font-bold leading-tight tracking-tight xl:text-4xl">
            Your property,<br />one secure login.
          </p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/65">
            Pay rent, submit maintenance requests, view your lease, and message your property manager — all in one place.
          </p>
        </div>

        <p className="relative z-10 mt-8 hidden text-xs text-white/35 lg:mt-0 lg:block">
          © {new Date().getFullYear()} Montero Rentals
        </p>
      </aside>

      <main
        id="auth-main"
        tabIndex={-1}
        className="login-panel relative flex flex-1 flex-col justify-center px-6 py-10 outline-none sm:px-10 lg:px-16 xl:px-20"
      >
        <div className="mx-auto w-full max-w-[420px]">
          <div className="login-form-enter rounded-2xl border border-slate-200/80 bg-white p-8 shadow-lg shadow-slate-200/50 sm:p-10">
            <header className="mb-8">
              <h1 id="auth-title" className="text-2xl font-bold tracking-tight text-slate-900">
                {title}
              </h1>
              {subtitle && (
                <p id="auth-subtitle" className="mt-1.5 text-sm text-slate-500">
                  {subtitle}
                </p>
              )}
            </header>
            {children}
          </div>
          {footer ?? (
            <p className="mt-6 text-center text-xs text-slate-400">
              <Link to="/login" className="text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline">
                Back to sign in
              </Link>
              {' · '}
              <Link to="/privacy" className="text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline">
                Privacy Policy
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
