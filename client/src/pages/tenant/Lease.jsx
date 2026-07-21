import React, { useState, useEffect, useCallback } from 'react';
import { Clock, CheckCircle2, XCircle, FileText, AlertTriangle, MailOpen, PenLine } from 'lucide-react';
import api from '@/api/axios';
import { notifyCheckinRefresh } from '@/hooks/useCheckin';
import {
  deriveSigningStep, SIGNING_STEP_META, flowStepIndex, FLOW_STEPS,
  rlErrorMessage,
} from '@/utils/rlLeaseHelpers';

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

function fmtMoney(v) {
  if (v == null) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 });
}

function daysUntil(ts) {
  if (!ts) return null;
  const diff = new Date(ts) - new Date();
  return Math.ceil(diff / 86400000);
}

const LEASE_STATUS = {
  draft:              { label: 'Draft',         color: 'bg-gray-100 text-gray-500' },
  pending:            { label: 'Pending Sign',  color: 'bg-yellow-100 text-yellow-700' },
  pending_signature:  { label: 'Sign Required', color: 'bg-yellow-100 text-yellow-700' },
  active:             { label: 'Active',        color: 'bg-green-100 text-green-700' },
  expired:            { label: 'Expired',       color: 'bg-red-100 text-red-600' },
  terminated:         { label: 'Terminated',    color: 'bg-gray-100 text-gray-500' },
};

const SIGNER_STATUS = {
  pending:   { label: 'Awaiting signature', icon: <Clock size={18} className="text-slate-400" />,        },
  signed:    { label: 'Signed',             icon: <CheckCircle2 size={18} className="text-emerald-500" /> },
  declined:  { label: 'Declined',           icon: <XCircle size={18} className="text-red-500" />          },
};

// ─── InfoRow ─────────────────────────────────────────────────────────────────

function InfoRow({ label, value, highlight }) {
  return (
    <div className={`py-3 flex items-center justify-between border-b border-gray-100 last:border-b-0 ${highlight ? 'bg-amber-50 -mx-4 px-4 rounded' : ''}`}>
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-medium ${highlight ? 'text-amber-700' : 'text-gray-800'}`}>{value}</span>
    </div>
  );
}

// ─── SigningStatus ────────────────────────────────────────────────────────────

function SigningStatus({ envelope, leaseId, onSigned }) {
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [urlError, setUrlError]     = useState('');

  async function openSigning() {
    setLoadingUrl(true);
    setUrlError('');
    try {
      const { data } = await api.get(`/api/leases/${leaseId}/sign`);
      window.open(data.url, '_blank', 'noopener');
    } catch (err) {
      setUrlError(rlErrorMessage(err, 'Could not load signing URL. Please try again.'));
    } finally {
      setLoadingUrl(false);
    }
  }

  if (!envelope) return null;

  const mySigners = (envelope.signers || []).filter(s => s.signer_role === 'Tenant');
  const mySigner  = mySigners[0];
  const allSigned = (envelope.signers || []).every(s => s.status === 'signed');

  return (
    <div className={`rounded-xl border p-5 ${
      allSigned ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            {allSigned
              ? <><CheckCircle2 size={16} className="text-emerald-600" /> Lease fully executed</>
              : <><PenLine size={16} className="text-amber-600" /> Signature required</>}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Sent {fmt(envelope.sent_at)}
            {envelope.completed_at && ` · Completed ${fmt(envelope.completed_at)}`}
          </p>
        </div>
        {mySigner?.status !== 'signed' && !allSigned && (
          <button
            onClick={openSigning}
            disabled={loadingUrl}
            className="shrink-0 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loadingUrl ? 'Loading…' : 'Sign Now'}
          </button>
        )}
      </div>

      {urlError && <p className="mt-2 text-xs text-red-600">{urlError}</p>}

      {/* Signer list */}
      <div className="mt-4 space-y-2">
        {(envelope.signers || []).sort((a, b) => a.routing_order - b.routing_order).map(s => {
          const meta = SIGNER_STATUS[s.status] || SIGNER_STATUS.pending;
          return (
            <div key={s.id} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex items-center">{meta.icon}</span>
                <div>
                  <p className="text-sm font-medium text-gray-800">{s.name}</p>
                  <p className="text-xs text-gray-400">{s.signer_role}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-gray-600">{meta.label}</p>
                {s.signed_at && <p className="text-xs text-gray-400">{fmt(s.signed_at)}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TenantSigningProgress ───────────────────────────────────────────────────

function TenantSigningProgress({ stepKey }) {
  const activeIdx = flowStepIndex(stepKey);
  const allDone = stepKey === 'active';

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Your signing progress</p>
      <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {FLOW_STEPS.map((step, i) => {
          const done = allDone || i < activeIdx;
          const current = !allDone && i === activeIdx;
          return (
            <li key={step.key} className={`rounded-lg px-2 py-2 text-center text-xs ${
              done ? 'bg-green-50 text-green-800' : current ? 'bg-indigo-50 text-indigo-800 font-semibold' : 'bg-gray-50 text-gray-400'
            }`}>
              <span className="block font-medium">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── EmptyState ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
      <FileText size={44} strokeWidth={1.5} className="mx-auto mb-4 text-slate-300" />
      <h2 className="text-lg font-semibold text-gray-700">No active lease found</h2>
      <p className="mt-2 text-sm text-gray-400 max-w-xs mx-auto">
        Your lease agreement will appear here once your property manager sets it up.
      </p>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function LeasePage() {
  const [lease, setLease]         = useState(null);
  const [envelopes, setEnvelopes] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [showAll, setShowAll]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Get most recent lease
      const { data: listData } = await api.get('/api/leases/my');
      const leases = listData.leases || [];
      if (!leases.length) { setLoading(false); return; }

      // Prefer active, then most recent
      const active = leases.find(l => l.status === 'active') || leases[0];
      setLease(active);

      // Load full detail + envelopes
      const { data: detail } = await api.get(`/api/leases/${active.id}`);
      setLease(detail.lease);
      setEnvelopes(detail.envelopes || []);
    } catch (err) {
      setError('Could not load lease information.');
      console.error('[lease]', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.patch('/api/users/me/checkin', { step: 'lease_viewed' })
      .then(() => notifyCheckinRefresh())
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center text-sm text-red-700">
        {error}
        <button onClick={load} className="ml-2 underline">Retry</button>
      </div>
    );
  }

  if (!lease) return <EmptyState />;

  const statusMeta   = LEASE_STATUS[lease.status] || LEASE_STATUS.draft;
  const daysToEnd    = daysUntil(lease.end_date);
  const daysToStart  = daysUntil(lease.start_date);
  const expiringSoon = daysToEnd != null && daysToEnd > 0 && daysToEnd <= 60;
  const latestEnv    = envelopes[0] ?? null;
  const signingStep  = deriveSigningStep({ lease, docStatus: null, latestEnvelope: latestEnv });
  const stepMeta     = SIGNING_STEP_META[signingStep] ?? SIGNING_STEP_META.needs_interview;
  const needsSign    = ['pending_signature', 'pending'].includes(lease.status)
    || signingStep === 'awaiting_tenant_sign';

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your Lease</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {lease.property_name} · Unit {lease.unit_number}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${statusMeta.color}`}>
            {statusMeta.label}
          </span>
          {lease.status !== 'active' && (
            <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${stepMeta.color}`}>
              {stepMeta.label}
            </span>
          )}
        </div>
      </div>

      {/* Expiry warning */}
      {expiringSoon && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Lease expiring in {daysToEnd} days</p>
            <p className="text-xs text-amber-600 mt-0.5">
              Your lease ends on {fmt(lease.end_date)}. Contact your property manager about renewal.
            </p>
          </div>
        </div>
      )}

      {/* Signing progress */}
      {lease.status !== 'active' && (
        <TenantSigningProgress stepKey={signingStep} />
      )}

      {/* Pending signature notice */}
      {needsSign && !latestEnv && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 flex items-start gap-3">
          <MailOpen size={20} className="shrink-0 text-blue-500" />
          <div>
            <p className="text-sm font-semibold text-blue-800">Awaiting signature request</p>
            <p className="text-xs text-blue-600 mt-0.5">
              Your property manager is preparing the lease in Rocket Lawyer. You will receive a sign link here once the document is sent.
            </p>
          </div>
        </div>
      )}

      {needsSign && latestEnv && signingStep === 'awaiting_tenant_sign' && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
          <PenLine size={20} className="shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Your signature is required</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Review the lease in Rocket Lawyer and sign to activate your tenancy.
            </p>
          </div>
        </div>
      )}

      {/* E-signature status */}
      {latestEnv && (
        <SigningStatus envelope={latestEnv} leaseId={lease.id} />
      )}

      {/* Lease details card */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Lease Details</h2>
        <InfoRow label="Start date"       value={fmt(lease.start_date)} />
        <InfoRow label="End date"         value={fmt(lease.end_date)} highlight={expiringSoon} />
        {daysToStart != null && daysToStart > 0 && (
          <InfoRow label="Starts in" value={`${daysToStart} days`} />
        )}
        <InfoRow label="Monthly rent"     value={fmtMoney(lease.monthly_rent)} />
        <InfoRow label="Security deposit" value={fmtMoney(lease.security_deposit)} />
        {lease.grace_period_days != null && (
          <InfoRow label="Grace period" value={`${lease.grace_period_days} days`} />
        )}
        {lease.late_fee_amount != null && (
          <InfoRow
            label="Late fee"
            value={
              lease.late_fee_type === 'percent'
                ? `${lease.late_fee_amount}%`
                : fmtMoney(lease.late_fee_amount)
            }
          />
        )}
      </div>

      {/* Document download */}
      {lease.document_url?.startsWith('http') && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800">Lease Agreement</p>
              <p className="text-xs text-gray-400">Rocket Lawyer PDF</p>
            </div>
          </div>
          <a
            href={lease.document_url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700 transition-colors"
          >
            View PDF
          </a>
        </div>
      )}

      {/* All envelopes history */}
      {envelopes.length > 1 && (
        <div>
          <button
            onClick={() => setShowAll(v => !v)}
            className="text-sm text-indigo-600 hover:underline"
          >
            {showAll ? 'Hide' : 'Show'} signature history ({envelopes.length} envelopes)
          </button>
          {showAll && (
            <div className="mt-3 space-y-3">
              {envelopes.slice(1).map(env => (
                <div key={env.id} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-700">
                      {env.provider === 'rocket_lawyer' ? 'Rocket Lawyer' : (env.provider || 'E-sign')}
                    </p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      env.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {env.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Sent {fmt(env.sent_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
