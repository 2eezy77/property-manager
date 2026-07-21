import React from 'react';
import { Link } from 'react-router-dom';

function fmt(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysUntil(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso) - new Date()) / (1000 * 60 * 60 * 24));
}

/**
 * Featured rent card — ePayRent / Oshadhi hero pattern.
 */
export default function RentHero({ balance, propertyLabel, onPay, payHref = '/tenant/payments', hidePayAction = false }) {
  if (!balance) {
    return <div className="skeleton h-44 rounded-2xl" />;
  }
  if (!balance.lease) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
        No active lease found.
      </div>
    );
  }

  const { lease, currentPayment, lateFeeBalance } = balance;
  const isPaid    = currentPayment?.status === 'succeeded';
  const isProc    = currentPayment?.status === 'processing';
  const totalDue  = (lease.monthlyRent ?? 0) + (lateFeeBalance ?? 0);
  const dueDate   = currentPayment?.due_date ?? lease.nextDueDate;
  const days      = daysUntil(dueDate);
  const overdue   = !isPaid && !isProc && days !== null && days < 0;
  const address   = propertyLabel ?? lease.unit ?? lease.address ?? '743 A Ave, Norfolk VA';

  const statusPill = isPaid
    ? 'bg-white/20 text-white'
    : isProc
      ? 'bg-blue-400/30 text-white'
      : overdue
        ? 'bg-red-500/40 text-white'
        : 'bg-white/15 text-white/90';

  const statusText = isPaid ? 'Paid this month' : isProc ? 'Processing' : overdue ? 'Overdue' : 'Due soon';

  return (
    <section
      aria-labelledby="rent-hero-heading"
      className={`rent-shine relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-6 text-white shadow-lg sm:p-8 ${
        overdue ? 'ring-2 ring-red-400/50' : ''
      }`}
    >
      <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/10" aria-hidden />
      <div className="pointer-events-none absolute -bottom-10 right-16 h-28 w-28 rounded-full bg-white/5" aria-hidden />

      <div className="relative z-10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="rent-hero-heading" className="text-[10px] font-bold uppercase tracking-widest text-white/60">
              Your rent
            </h2>
            <p className="mt-1 text-sm font-medium text-white/85">{address}</p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${statusPill}`}
            aria-live="polite"
          >
            {statusText}
          </span>
        </div>

        <p className="mt-6 text-4xl font-bold tracking-tight tabular-nums sm:text-5xl" aria-label={`Amount due ${fmt(totalDue)}`}>
          {fmt(totalDue)}
        </p>
        <p className="mt-2 text-sm text-white/75">
          Due {fmtDate(dueDate)}
          {days !== null && !isPaid && !isProc && (
            <span className="ml-2 font-semibold">
              {overdue ? `${Math.abs(days)} days overdue` : `in ${days} days`}
            </span>
          )}
        </p>
        {lateFeeBalance > 0 && (
          <p className="mt-1 text-xs text-red-200">Includes {fmt(lateFeeBalance)} in late fees</p>
        )}

        {!isPaid && !isProc && !hidePayAction && (
          onPay ? (
            <button
              type="button"
              onClick={onPay}
              className="btn-motion mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-blue-700 shadow-md transition hover:bg-blue-50 hover:scale-[1.02]"
            >
              Pay rent now →
            </button>
          ) : (
            <Link
              to={payHref}
              className="btn-motion mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-blue-700 shadow-md transition hover:bg-blue-50 hover:scale-[1.02]"
            >
              Pay rent now →
            </Link>
          )
        )}
      </div>
    </section>
  );
}
