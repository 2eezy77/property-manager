import React from 'react';

/**
 * Subtitle + actions row below the portal top bar (avoids duplicate h1).
 */
export default function PageIntro({ subtitle, actions }) {
  if (!subtitle && !actions) return null;
  return (
    <div className="-mt-2 mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between motion-intro">
      {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
