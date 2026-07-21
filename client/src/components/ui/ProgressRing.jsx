import React from 'react';

/**
 * SVG progress ring — Arche / Azmir dashboard pattern.
 */
export default function ProgressRing({
  percent = 0,
  size = 96,
  stroke = 7,
  colorClass = 'stroke-violet-500',
  label,
  sublabel,
}) {
  const pct = Math.min(100, Math.max(0, percent));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            className="stroke-slate-100"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            className={`${colorClass} transition-all duration-700`}
            strokeDasharray={c}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold tabular-nums text-slate-900">{pct}%</span>
        </div>
      </div>
      {label && <p className="text-sm font-semibold text-slate-900">{label}</p>}
      {sublabel && <p className="text-xs text-slate-500">{sublabel}</p>}
    </div>
  );
}
