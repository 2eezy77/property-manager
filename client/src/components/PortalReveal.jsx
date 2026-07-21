import React, { useEffect, useState } from 'react';
import { PORTAL_META, REVEAL_PORTALS } from '@/utils/roles';

const ACCENT = {
  violet:  { active: 'bg-violet-500/25 ring-violet-400/60 border-violet-400/40', dim: 'border-white/10 bg-white/5' },
  emerald: { active: 'bg-emerald-500/25 ring-emerald-400/60 border-emerald-400/40', dim: 'border-white/10 bg-white/5' },
  blue:    { active: 'bg-blue-500/25 ring-blue-400/60 border-blue-400/40', dim: 'border-white/10 bg-white/5' },
};

/**
 * Post-login fullscreen reveal — Dribbble-style role carousel then portal entry.
 */
export default function PortalReveal({ user, onComplete }) {
  const meta = PORTAL_META[user.role] ?? PORTAL_META.tenant;
  const activeId = meta.id;
  const name = user.firstName || 'there';

  const [phase, setPhase] = useState('cards'); // cards → focus → expand → exit

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('focus'), 700);
    const t2 = setTimeout(() => setPhase('expand'), 1500);
    const t3 = setTimeout(() => setPhase('exit'), 2400);
    const t4 = setTimeout(() => onComplete(), 2900);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [onComplete]);

  const expanding = phase === 'expand' || phase === 'exit';
  const focused = phase === 'focus';

  return (
    <div
      className={`portal-reveal fixed inset-0 z-[100] flex items-center justify-center overflow-hidden text-white transition-opacity duration-500 ${
        phase === 'exit' ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Background wash — expands on active portal */}
      <div
        className={`absolute inset-0 bg-gradient-to-br ${meta.gradient} transition-all duration-700 ease-out ${
          expanding ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
        }`}
        style={{ transformOrigin: 'center center' }}
      />

      {/* Dark base while cards show */}
      <div
        className={`absolute inset-0 login-mesh login-grid transition-opacity duration-500 ${
          expanding ? 'opacity-0' : 'opacity-100'
        }`}
      />

      {/* Content */}
      <div className="relative z-10 flex w-full max-w-lg flex-col items-center px-6">
        {!expanding && (
          <>
            <p className="portal-reveal-fade mb-8 text-center text-sm text-white/60">
              Welcome back, <span className="font-semibold text-white">{name}</span>
            </p>

            <div className="flex w-full items-center justify-center gap-3 sm:gap-4">
              {REVEAL_PORTALS.map((portal, i) => {
                const isActive = portal.id === activeId;
                const styles = ACCENT[portal.accent];

                let cardClass = `portal-reveal-card flex flex-col items-center rounded-2xl border p-4 backdrop-blur-md transition-all duration-500 ease-out sm:p-5 ${styles.dim}`;

                if (focused && isActive) {
                  cardClass += ` portal-reveal-card-active scale-110 ring-2 z-10 shadow-2xl ${styles.active} ${meta.glow}`;
                } else if (focused) {
                  cardClass += ' scale-90 opacity-25';
                } else {
                  cardClass += ' opacity-100 scale-100';
                }

                return (
                  <div
                    key={portal.id}
                    className={cardClass}
                    style={{ animationDelay: `${i * 100}ms` }}
                  >
                    <span
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-transform duration-500 sm:h-14 sm:w-14 ${
                        isActive && focused ? 'scale-110' : ''
                      }`}
                    >
                      {React.createElement(portal.icon, { size: 26, strokeWidth: 2 })}
                    </span>
                    <p className={`mt-3 text-sm font-bold ${isActive && focused ? 'text-white' : 'text-white/80'}`}>
                      {portal.label}
                    </p>
                  </div>
                );
              })}
            </div>

            <p
              className={`portal-reveal-fade mt-10 text-center text-xs font-medium uppercase tracking-widest text-white/40 transition-opacity duration-300 ${
                phase === 'focus' ? 'opacity-100' : 'opacity-0'
              }`}
            >
              Opening your portal…
            </p>
          </>
        )}

        {expanding && (
          <div className="portal-reveal-expand flex flex-col items-center text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/15 ring-1 ring-white/25 backdrop-blur-sm">
              {React.createElement(meta.icon, { size: 36, strokeWidth: 2 })}
            </span>
            <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.2em] text-white/60">
              {meta.label} portal
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              {meta.title}
            </h2>
            <p className="mt-2 max-w-xs text-sm text-white/70">{meta.subtitle}</p>
            <div className="mt-8 h-1 w-48 overflow-hidden rounded-full bg-white/20">
              <div className="portal-reveal-progress h-full rounded-full bg-white/90" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
