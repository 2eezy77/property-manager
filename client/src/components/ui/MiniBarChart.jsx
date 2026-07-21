import React from 'react';

/** Simple CSS bar chart — no chart library. */
export default function MiniBarChart({ bars, colorClass = 'bg-violet-500' }) {
  const max = Math.max(...bars.map(b => b.value), 1);
  return (
    <div className="flex items-end justify-between gap-2" style={{ height: 80 }}>
      {bars.map(({ label, value }) => (
        <div key={label} className="flex flex-1 flex-col items-center gap-1.5">
          <div className="flex w-full flex-1 items-end">
            <div
              className={`w-full rounded-t-lg ${colorClass} opacity-90 transition-all duration-500`}
              style={{ height: `${Math.max(8, (value / max) * 100)}%` }}
              title={String(value)}
            />
          </div>
          <span className="text-[10px] font-medium text-slate-400">{label}</span>
        </div>
      ))}
    </div>
  );
}
