import React, { useState, useEffect, useCallback } from 'react';
import { FileText, X, Check } from 'lucide-react';
import api from '@/api/axios';
import TableScroll from '@/components/ui/TableScroll';
import {
  deriveSigningStep, SIGNING_STEP_META, FLOW_STEPS, flowStepIndex,
  resolveDocumentId, ENV_STATUS_STYLE, envelopeStatusLabel, rlErrorMessage,
} from '@/utils/rlLeaseHelpers';

function fmt(ts) { return ts ? new Date(ts).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}) : '—'; }
function fmtMoney(v) { return v != null ? '$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2}) : '—'; }
function daysUntil(ts) { if (!ts) return null; return Math.ceil((new Date(ts)-new Date())/86400000); }

const STATUS_META = {
  draft:              { label:'Draft',              color:'bg-gray-100 text-gray-500'   },
  pending:            { label:'Pending',            color:'bg-yellow-100 text-yellow-700' },
  pending_signature:  { label:'Pending Signature',  color:'bg-yellow-100 text-yellow-700' },
  active:             { label:'Active',             color:'bg-green-100 text-green-700'  },
  expired:            { label:'Expired',            color:'bg-red-100 text-red-600'      },
  terminated:         { label:'Terminated',         color:'bg-gray-100 text-gray-500'    },
};

function SigningFlowSteps({ stepKey, rlPending }) {
  const activeIdx = flowStepIndex(stepKey);
  const allDone = stepKey === 'active';

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Signing flow</p>
      {rlPending && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Rocket Lawyer APIs are pending approval. Interview and signing stay blocked until RocketDocument v2 and RocketSign are enabled.
        </p>
      )}
      <ol className="space-y-2">
        {FLOW_STEPS.map((step, i) => {
          const done = allDone || i < activeIdx;
          const current = !allDone && i === activeIdx;
          return (
            <li key={step.key} className="flex items-start gap-3">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                done ? 'bg-green-100 text-green-700' : current ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'
              }`}>
                {done ? <Check size={12} strokeWidth={3} /> : i + 1}
              </span>
              <div className={current ? 'text-indigo-800' : done ? 'text-gray-700' : 'text-gray-400'}>
                <p className={`text-sm ${current ? 'font-semibold' : 'font-medium'}`}>{step.label}</p>
                <p className="text-xs">{step.desc}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Badge({ meta }) {
  return meta ? <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span> : null;
}

// ── Create Lease Modal ────────────────────────────────────────────────────────
function CreateLeaseModal({ onClose, onCreated }) {
  const [properties, setProperties] = useState([]);
  const [units,      setUnits]      = useState([]);
  const [tenants,    setTenants]    = useState([]);
  const [form, setForm] = useState({
    property_id: '', unit_id: '', tenant_id: '',
    start_date: '', end_date: '',
    monthly_rent: '', security_deposit: '',
    grace_period_days: '5',
    late_fee_type: 'flat', late_fee_amount: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/properties').then(r => setProperties(r.data.properties || [])).catch(() => {});
    api.get('/api/tenants').then(r => setTenants(r.data.tenants || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.property_id) { setUnits([]); return; }
    api.get(`/api/properties/${form.property_id}`)
      .then(r => setUnits((r.data.units || []).filter(u => !u.is_occupied)))
      .catch(() => {});
  }, [form.property_id]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      const payload = {
        unit_id:           form.unit_id,
        tenant_id:         form.tenant_id,
        start_date:        form.start_date,
        end_date:          form.end_date,
        monthly_rent:      parseFloat(form.monthly_rent),
        security_deposit:  form.security_deposit ? parseFloat(form.security_deposit) : null,
        grace_period_days: parseInt(form.grace_period_days, 10),
        late_fee_type:     form.late_fee_type,
        late_fee_amount:   form.late_fee_amount ? parseFloat(form.late_fee_amount) : null,
      };
      const { data } = await api.post('/api/leases', payload);
      onCreated(data.lease);
    } catch(err) {
      setError(err.response?.data?.error || 'Failed to create lease');
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400";
  const labelCls = "block text-xs font-medium text-gray-500 mb-1";

  return (
    <div className="modal-overlay overflow-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">New Lease</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 leading-none" aria-label="Close"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {/* Property → Unit cascade */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Property *</label>
              <select className={inputCls} value={form.property_id} onChange={e => { set('property_id', e.target.value); set('unit_id', ''); }} required>
                <option value="">Select property…</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Unit *</label>
              <select className={inputCls} value={form.unit_id} onChange={e => set('unit_id', e.target.value)} required disabled={!form.property_id}>
                <option value="">Select unit…</option>
                {units.map(u => <option key={u.id} value={u.id}>Unit {u.unit_number}{u.bedrooms ? ` · ${u.bedrooms}BR` : ''}</option>)}
              </select>
            </div>
          </div>

          {/* Tenant */}
          <div>
            <label className={labelCls}>Tenant *</label>
            <select className={inputCls} value={form.tenant_id} onChange={e => set('tenant_id', e.target.value)} required>
              <option value="">Select tenant…</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.first_name} {t.last_name} — {t.email}</option>)}
            </select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Date *</label>
              <input type="date" className={inputCls} value={form.start_date} onChange={e => set('start_date', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>End Date *</label>
              <input type="date" className={inputCls} value={form.end_date} onChange={e => set('end_date', e.target.value)} required />
            </div>
          </div>

          {/* Financials */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Monthly Rent ($) *</label>
              <input type="number" min="0" step="0.01" className={inputCls} value={form.monthly_rent} onChange={e => set('monthly_rent', e.target.value)} required placeholder="1500.00" />
            </div>
            <div>
              <label className={labelCls}>Security Deposit ($)</label>
              <input type="number" min="0" step="0.01" className={inputCls} value={form.security_deposit} onChange={e => set('security_deposit', e.target.value)} placeholder="1500.00" />
            </div>
          </div>

          {/* Late Fee */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Grace Period (days)</label>
              <input type="number" min="0" className={inputCls} value={form.grace_period_days} onChange={e => set('grace_period_days', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Late Fee Type</label>
              <select className={inputCls} value={form.late_fee_type} onChange={e => set('late_fee_type', e.target.value)}>
                <option value="flat">Flat ($)</option>
                <option value="percent">Percent (%)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Late Fee Amount</label>
              <input type="number" min="0" step="0.01" className={inputCls} value={form.late_fee_amount} onChange={e => set('late_fee_amount', e.target.value)} placeholder="50.00" />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
            <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {submitting ? 'Creating…' : 'Create Lease'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Send Envelope Modal ───────────────────────────────────────────────────────
function SendEnvelopeModal({ lease, onClose, onSent }) {
  const [subject,  setSubject]  = useState(`Lease Agreement — ${lease.property_name} Unit ${lease.unit_number}`);
  const [message,  setMessage]  = useState(`Please review and sign your lease for ${lease.property_name}, Unit ${lease.unit_number}.`);
  const [sending,  setSending]  = useState(false);
  const [error,    setError]    = useState('');
  const [interviewUrl, setInterviewUrl] = useState(lease.rl_interview_url ?? null);

  const documentId = resolveDocumentId(lease);

  async function handleSubmit(e) {
    e.preventDefault(); setSending(true); setError('');
    try {
      const { data } = await api.post(`/api/leases/${lease.id}/envelopes`, { subject, message, documentId });
      onSent(data);
    } catch(err) {
      const msg = rlErrorMessage(err, 'Failed to send for signature');
      setError(msg);
      if (err.response?.data?.interviewUrl) setInterviewUrl(err.response.data.interviewUrl);
    }
    finally { setSending(false); }
  }

  return (
    <div className="modal-overlay">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Send for Signature</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 leading-none" aria-label="Close"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {!documentId && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              Create the lease in Rocket Lawyer before sending for signature.
            </p>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
            <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" value={subject} onChange={e => setSubject(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Message</label>
            <textarea className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" rows={3} value={message} onChange={e => setMessage(e.target.value)} />
          </div>
          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 space-y-1">
              <p>{error}</p>
              {interviewUrl && (
                <a href={interviewUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline text-xs">
                  Continue Rocket Lawyer interview
                </a>
              )}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
            <button type="submit" disabled={sending || !documentId} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {sending ? 'Sending…' : 'Send via Rocket Lawyer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Lease Detail Panel ────────────────────────────────────────────────────────
function LeaseDetailPanel({ lease: initialLease, onClose, rlReady }) {
  const [lease,         setLease]         = useState(initialLease);
  const [envelopes,     setEnvelopes]     = useState([]);
  const [showSend,      setShowSend]      = useState(false);
  const [creatingDoc,   setCreatingDoc]   = useState(false);
  const [refreshingDoc, setRefreshingDoc] = useState(false);
  const [docError,      setDocError]      = useState('');
  const [docStatus,     setDocStatus]     = useState(null);
  const [loading,       setLoading]       = useState(true);

  const documentId = resolveDocumentId(lease);
  const pdfUrl = lease.document_url?.startsWith('http') ? lease.document_url : null;
  const latestEnvelope = envelopes[0] ?? null;
  const signingStep = deriveSigningStep({
    lease,
    docStatus,
    latestEnvelope,
    rlReady,
  });
  const stepMeta = SIGNING_STEP_META[signingStep] ?? SIGNING_STEP_META.needs_interview;

  useEffect(() => {
    async function load() {
      try {
        const [leaseRes, envRes] = await Promise.all([
          api.get(`/api/leases/${initialLease.id}`),
          api.get(`/api/leases/${initialLease.id}/envelopes`),
        ]);
        const loaded = leaseRes.data.lease || initialLease;
        setLease(loaded);
        setEnvelopes(envRes.data.envelopes || []);
        if (loaded.rl_document_id || loaded.document_url?.startsWith('rl-doc-')) {
          await refreshDocumentStatus(loaded);
        }
      } catch(e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, [initialLease.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshDocumentStatus(current = lease) {
    const id = resolveDocumentId(current);
    if (!id) return;
    setRefreshingDoc(true); setDocError('');
    try {
      const { data } = await api.get(`/api/leases/${current.id}/documents/${id}`);
      setDocStatus(data.document?.status ?? null);
      if (data.document?.pdfUrl) {
        setLease(l => ({ ...l, document_url: data.document.pdfUrl }));
      }
    } catch(err) {
      setDocError(rlErrorMessage(err, 'Could not refresh Rocket Lawyer document'));
    } finally {
      setRefreshingDoc(false);
    }
  }

  async function handleCreateRlDocument() {
    setCreatingDoc(true); setDocError('');
    try {
      const { data } = await api.post(`/api/leases/${lease.id}/documents`);
      setLease(l => ({
        ...l,
        rl_document_id: data.documentId,
        rl_interview_url: data.interviewUrl,
        document_url: `rl-doc-${data.documentId}`,
      }));
      setDocStatus(data.status ?? 'draft');
      if (data.interviewUrl) window.open(data.interviewUrl, '_blank', 'noopener,noreferrer');
    } catch(err) {
      setDocError(rlErrorMessage(err, 'Rocket Lawyer document creation failed'));
    } finally {
      setCreatingDoc(false);
    }
  }

  const canSign    = !['active','expired','terminated'].includes(lease.status);
  const canCreateDoc = ['draft','pending','pending_signature'].includes(lease.status);

  return (
    <div className="drawer-overlay flex">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-full max-w-lg bg-white shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{lease.property_name}</h2>
            <p className="text-sm text-gray-400">Unit {lease.unit_number} · {lease.tenant_name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 leading-none" aria-label="Close"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48"><div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" /></div>
        ) : (
          <div className="px-6 py-4 space-y-6">
            {/* Status + badges */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge meta={STATUS_META[lease.status]} />
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${stepMeta.color}`}>
                {stepMeta.label}
              </span>
              {(() => { const d=daysUntil(lease.end_date); return d!=null&&d>0&&d<=60 ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{d}d to expiry</span> : null; })()}
            </div>

            <SigningFlowSteps stepKey={signingStep} rlPending={!rlReady} />

            {/* Lease details */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                ['Tenant',        `${lease.tenant_name || '—'}`],
                ['Email',         lease.tenant_email || '—'],
                ['Start Date',    fmt(lease.start_date)],
                ['End Date',      fmt(lease.end_date)],
                ['Monthly Rent',  fmtMoney(lease.monthly_rent)],
                ['Security Dep.', fmtMoney(lease.security_deposit)],
                ['Grace Period',  lease.grace_period_days ? `${lease.grace_period_days} days` : '—'],
                ['Late Fee',      lease.late_fee_amount ? (lease.late_fee_type==='percent' ? `${lease.late_fee_amount}%` : fmtMoney(lease.late_fee_amount)) : '—'],
              ].map(([l,v]) => (
                <div key={l}><p className="text-xs text-gray-400">{l}</p><p className="font-medium text-gray-700 truncate">{v}</p></div>
              ))}
            </div>

            {/* Rocket Lawyer document */}
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-800 text-sm">Rocket Lawyer Document</h3>
              {documentId ? (
                <p className="text-xs text-gray-500">Document ID: {documentId}</p>
              ) : (
                <p className="text-sm text-gray-400">No Rocket Lawyer document yet.</p>
              )}
              {docStatus && (
                <p className="text-xs text-gray-500">Status: <span className="font-medium capitalize">{docStatus}</span></p>
              )}
              {pdfUrl && (
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:underline">
                  View lease PDF (Rocket Lawyer)
                </a>
              )}
              {lease.rl_interview_url && !pdfUrl && (
                <a href={lease.rl_interview_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:underline">
                  Continue Rocket Lawyer interview
                </a>
              )}
              {canCreateDoc && (
                <div className="flex flex-wrap gap-2">
                  <button onClick={handleCreateRlDocument} disabled={creatingDoc || !rlReady}
                    className="inline-flex items-center gap-2 text-sm px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors font-medium">
                    {creatingDoc ? 'Creating…' : documentId ? 'Recreate in Rocket Lawyer' : 'Start Rocket Lawyer interview'}
                  </button>
                  {documentId && (
                    <button onClick={() => refreshDocumentStatus()} disabled={refreshingDoc}
                      className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                      {refreshingDoc ? 'Refreshing…' : 'Refresh status'}
                    </button>
                  )}
                </div>
              )}
              {docError && <p className="text-xs text-red-600">{docError}</p>}
            </div>

            {/* Signature envelopes */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800 text-sm">Signatures</h3>
                {canSign && signingStep === 'ready_to_send' && (
                  <button onClick={() => setShowSend(true)}
                    className="text-xs px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                    Send for Signature
                  </button>
                )}
                {canSign && signingStep === 'interview_in_progress' && (
                  <span className="text-xs text-amber-700">Complete interview first</span>
                )}
              </div>
              {envelopes.length === 0 ? (
                <p className="text-sm text-gray-400">No signature requests sent yet.</p>
              ) : envelopes.map(env => (
                <div key={env.id} className="rounded-lg border border-gray-100 p-3 space-y-2 mb-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500 capitalize">
                      Rocket Lawyer · Sent {fmt(env.sent_at)}
                    </p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ENV_STATUS_STYLE[env.status] || 'bg-gray-100 text-gray-500'}`}>
                      {envelopeStatusLabel(env.status)}
                    </span>
                  </div>
                  {(env.signers || []).map(s => (
                    <div key={s.id} className="flex items-center justify-between text-xs">
                      <span className="text-gray-600">{s.name} <span className="text-gray-400">({s.email})</span></span>
                      <span className={`px-1.5 py-0.5 rounded font-medium ${s.status==='signed' ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
                        {s.status}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {showSend && (
        <SendEnvelopeModal
          lease={lease}
          onClose={() => setShowSend(false)}
          onSent={env => { setEnvelopes(prev => [env, ...prev]); setShowSend(false); }}
        />
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function LeasesPage() {
  const [leases,       setLeases]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [selected,     setSelected]     = useState(null);
  const [filterStatus, setFilterStatus] = useState('active');
  const [showCreate,   setShowCreate]   = useState(false);
  const [rlStatus,     setRlStatus]     = useState(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      const { data } = await api.get(`/api/leases?${params}`);
      setLeases(data.leases || []);
    } catch(e) { console.error(e); } finally { setLoading(false); }
  }, [filterStatus]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    api.get('/api/leases/rocket-lawyer/status')
      .then(({ data }) => setRlStatus(data))
      .catch(() => setRlStatus(null));
  }, []);

  const expiring = leases.filter(l => { const d=daysUntil(l.end_date); return d!=null&&d>0&&d<=60; }).length;

  const rlReady = !rlStatus || (
    rlStatus.auth === 'ok'
    && rlStatus.rocketDocument === 'ok'
    && rlStatus.rocketSign === 'ok'
    && rlStatus.templateConfigured
  );
  const rlSetupBlocked = rlStatus && !rlReady;

  return (
    <div className="space-y-6">
      {rlSetupBlocked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">
            {rlStatus.auth === 'app_pending' ? 'Rocket Lawyer pending approval' : 'Rocket Lawyer setup in progress'}
          </p>
          <p className="mt-1 text-amber-800">
            {rlStatus.auth === 'app_pending'
              ? 'Your developer app is not fully provisioned yet. Email api@rocketlawyer.com with your app name.'
              : (rlStatus.authMessage || 'Checking connection…')}
          </p>
          <ul className="mt-2 list-disc list-inside text-xs text-amber-800 space-y-0.5">
            <li>Authentication API: {rlStatus.auth === 'ok' ? 'connected' : rlStatus.auth.replace(/_/g, ' ')}</li>
            <li>RocketDocument v2 (interview): {rlStatus.rocketDocument.replace(/_/g, ' ')}</li>
            <li>RocketSign & Binders (sign): {rlStatus.rocketSign.replace(/_/g, ' ')}</li>
            {rlStatus.webhookConfigured && (
              <li>Events API: {String(rlStatus.events || 'unknown').replace(/_/g, ' ')}</li>
            )}
            {rlStatus.apiProducts?.length > 0 && (
              <li>Token products: {rlStatus.apiProducts.join(', ')}</li>
            )}
            {!rlStatus.templateConfigured && (
              <li>Lease template ID missing — set RL_LEASE_TEMPLATE_ID after RocketDocument is approved</li>
            )}
          </ul>
          {rlStatus.nextSteps?.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              Next: {rlStatus.nextSteps[0]}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leases</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {leases.length} leases{expiring > 0 ? ` · ${expiring} expiring soon` : ''}
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
          + New Lease
        </button>
      </div>

      {/* Status filter tabs */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm w-fit">
        {[['active','Active'],['pending_signature','Pending Sign'],['draft','Draft'],['expired','Expired'],['','All']].map(([v,l]) => (
          <button key={v} onClick={() => setFilterStatus(v)}
            className={`px-4 py-1.5 font-medium transition-colors ${filterStatus===v ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            {l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : leases.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="mb-3 flex justify-center text-slate-300"><FileText size={40} strokeWidth={1.5} /></div>
          <p className="font-medium text-gray-700">No leases found</p>
          <p className="text-sm text-gray-400 mt-1">Create a new lease to get started.</p>
        </div>
      ) : (
        <TableScroll className="bg-white rounded-xl border border-gray-200">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Property / Unit','Tenant','Status','Rent','Start','End','Signing'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {leases.map(l => {
                const d = daysUntil(l.end_date);
                const soon = d != null && d > 0 && d <= 60;
                const rowStep = deriveSigningStep({
                  lease: l,
                  docStatus: null,
                  latestEnvelope: l.envelope_status ? { status: l.envelope_status } : null,
                  rlReady: !rlSetupBlocked,
                });
                const rowMeta = SIGNING_STEP_META[rowStep] ?? SIGNING_STEP_META.needs_interview;
                return (
                  <tr key={l.id} onClick={() => setSelected(l)} className="hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{l.property_name}</p>
                      <p className="text-xs text-gray-400">Unit {l.unit_number}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {l.tenant_name}
                      <br/><span className="text-xs text-gray-400">{l.tenant_email}</span>
                    </td>
                    <td className="px-4 py-3"><Badge meta={STATUS_META[l.status]} /></td>
                    <td className="px-4 py-3 text-gray-600">{fmtMoney(l.monthly_rent)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{fmt(l.start_date)}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={soon ? 'text-amber-600 font-medium' : 'text-gray-400'}>
                        {fmt(l.end_date)}{soon ? ` (${d}d)` : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${rowMeta.color}`}>
                        {rowMeta.short}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}

      {selected    && <LeaseDetailPanel lease={selected} rlReady={!rlSetupBlocked} onClose={() => setSelected(null)} />}
      {showCreate  && (
        <CreateLeaseModal
          onClose={() => setShowCreate(false)}
          onCreated={newLease => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}
