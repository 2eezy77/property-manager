import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, X } from 'lucide-react';
import api from '@/api/axios';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { useAuth } from '@/context/AuthContext';
import { canPreviewTenantPortal } from '@/utils/roles';
import { OnboardingProgress, OnboardingStepList } from '@/components/manager/TenantOnboarding';
import { OffboardingProgress, OffboardingStepList } from '@/components/manager/TenantOffboarding';
import TableScroll from '@/components/ui/TableScroll';

function fmt(ts) { return ts ? new Date(ts).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}) : '—'; }
function fmtMoney(v) { return v != null ? '$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2}) : '—'; }

const LEASE_COLOR = { active:'bg-green-100 text-green-700', pending:'bg-yellow-100 text-yellow-700', expired:'bg-red-100 text-red-600', draft:'bg-gray-100 text-gray-500' };
const PAY_COLOR   = { succeeded:'bg-green-100 text-green-700', failed:'bg-red-100 text-red-600', pending:'bg-yellow-100 text-yellow-700', processing:'bg-blue-100 text-blue-700' };

function TenantDetailPanel({ tenantId, onClose, onViewAs, canImpersonate, onTenantUpdated }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewLoading, setViewLoading] = useState(false);
  const [vivintBusy, setVivintBusy] = useState(false);
  const [offboardBusy, setOffboardBusy] = useState(null);
  const [offboardStartBusy, setOffboardStartBusy] = useState(false);
  const [resetOnboardBusy, setResetOnboardBusy] = useState(false);

  const loadDetail = useCallback(() => {
    return api.get(`/api/tenants/${tenantId}`).then(({ data }) => setDetail(data));
  }, [tenantId]);

  useEffect(() => {
    loadDetail().catch(console.error).finally(() => setLoading(false));
  }, [loadDetail]);

  async function resetOnboarding() {
    if (!window.confirm('Reset move-in onboarding for this tenant? Password, lease, maintenance, and Vivint steps will be cleared. Bank link stays if already connected.')) {
      return;
    }
    setResetOnboardBusy(true);
    try {
      const { data } = await api.post(`/api/tenants/${tenantId}/reset-onboarding`);
      await loadDetail();
      onTenantUpdated?.();
      if (data?.checkin) {
        setDetail((prev) => (prev ? { ...prev, checkin: data.checkin } : prev));
      }
    } catch (e) {
      console.error(e);
      window.alert(e.response?.data?.message || 'Could not reset onboarding.');
    } finally {
      setResetOnboardBusy(false);
    }
  }

  async function setVivintAccess(configured) {
    setVivintBusy(true);
    try {
      await api.patch(`/api/tenants/${tenantId}/vivint-access`, { configured });
      await loadDetail();
    } catch (e) {
      console.error(e);
    } finally {
      setVivintBusy(false);
    }
  }

  if (loading) return (
    <div className="drawer-overlay">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-lg shadow-2xl flex items-center justify-center">
        <div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    </div>
  );

  const { tenant, checkin, offboarding, offboardLeaseId, leases=[], payments=[], maintenance=[], threads=[] } = detail || {};

  async function startOffboarding() {
    setOffboardStartBusy(true);
    try {
      await api.post(`/api/tenants/${tenantId}/offboarding/start`, {
        lease_id: offboardLeaseId || leases[0]?.id,
      });
      await loadDetail();
    } catch (e) {
      console.error(e);
    } finally {
      setOffboardStartBusy(false);
    }
  }

  async function patchOffboardStep(step, done) {
    setOffboardBusy(step);
    try {
      await api.patch(`/api/tenants/${tenantId}/offboarding`, {
        step,
        done,
        lease_id: offboardLeaseId || offboarding?.leaseId,
      });
      await loadDetail();
    } catch (e) {
      console.error(e);
    } finally {
      setOffboardBusy(null);
    }
  }

  return (
    <div className="drawer-overlay">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="shrink-0 border-b border-gray-100 px-6 py-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900">{tenant?.first_name} {tenant?.last_name}</h2>
              <p className="text-xs text-gray-400 truncate">{tenant?.email}</p>
            </div>
            <button type="button" onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-600 leading-none" aria-label="Close"><X size={18} /></button>
          </div>
          {canImpersonate && (
            <button
              type="button"
              disabled={viewLoading || !tenant?.is_active}
              title={tenant?.is_active ? 'Open tenant portal preview' : 'Tenant account is inactive'}
              onClick={async () => {
                setViewLoading(true);
                try { await onViewAs(tenantId); } finally { setViewLoading(false); }
              }}
              className="mt-3 w-full rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {viewLoading ? 'Opening tenant view…' : 'View as tenant'}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Tenant info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {tenant?.phone && <div><p className="text-xs text-gray-400">Phone</p><p className="font-medium text-gray-700">{tenant.phone}</p></div>}
            <div><p className="text-xs text-gray-400">Since</p><p className="font-medium text-gray-700">{fmt(tenant?.created_at)}</p></div>
            {tenant?.last_login_at && <div><p className="text-xs text-gray-400">Last Login</p><p className="font-medium text-gray-700">{fmt(tenant.last_login_at)}</p></div>}
            <div><p className="text-xs text-gray-400">Status</p><p className={`font-medium ${tenant?.is_active ? 'text-green-600' : 'text-red-500'}`}>{tenant?.is_active ? 'Active' : 'Inactive'}</p></div>
          </div>

          {checkin && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-800">Move-in checklist</h3>
                <OnboardingProgress checkin={checkin} />
              </div>
              <OnboardingStepList checkin={checkin} />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={resetOnboardBusy}
                  onClick={resetOnboarding}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  {resetOnboardBusy ? 'Resetting…' : 'Reset onboarding'}
                </button>
                {!checkin.vivintAccessConfigured ? (
                  <button
                    type="button"
                    disabled={vivintBusy}
                    onClick={() => setVivintAccess(true)}
                    className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                  >
                    Mark Vivint access configured
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={vivintBusy}
                    onClick={() => setVivintAccess(false)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Clear Vivint flag
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-rose-100 bg-rose-50/30 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-800">Move-out checklist</h3>
              {offboarding?.active ? (
                <OffboardingProgress offboarding={offboarding} />
              ) : (
                <span className="text-xs text-slate-500">Not started</span>
              )}
            </div>
            {offboarding?.active ? (
              <>
                <OffboardingStepList
                  offboarding={offboarding}
                  onToggleStep={patchOffboardStep}
                  busyKey={offboardBusy}
                />
                <p className="mt-2 text-xs text-slate-500">
                  Tenant steps update when they mark items on their dashboard.
                </p>
              </>
            ) : (
              <button
                type="button"
                disabled={offboardStartBusy || !leases.length}
                onClick={startOffboarding}
                className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-50"
              >
                {offboardStartBusy ? 'Starting…' : 'Start move-out offboarding'}
              </button>
            )}
          </div>

          {/* Leases */}
          <div>
            <h3 className="font-semibold text-gray-800 mb-2">Leases</h3>
            {leases.length === 0 ? <p className="text-sm text-gray-400">No leases</p> : (
              <div className="space-y-2">
                {leases.map(l => (
                  <div key={l.id} className="rounded-lg border border-gray-100 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-800">{l.property_name} · Unit {l.unit_number}</p>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${LEASE_COLOR[l.status] || 'bg-gray-100 text-gray-500'}`}>{l.status}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{fmt(l.start_date)} – {fmt(l.end_date)} · {fmtMoney(l.monthly_rent)}/mo</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent payments */}
          <div>
            <h3 className="font-semibold text-gray-800 mb-2">Recent Payments</h3>
            {payments.length === 0 ? <p className="text-sm text-gray-400">No payments</p> : (
              <div className="space-y-1.5">
                {payments.slice(0,6).map(p => (
                  <div key={p.id} className="flex items-center justify-between">
                    <div><p className="text-sm text-gray-700">{fmtMoney(p.amount)} — {p.payment_type}{p.payment_method ? ` (${p.payment_method.replace('_', ' ')})` : ''}</p><p className="text-xs text-gray-400">{fmt(p.paid_at || p.created_at)}</p></div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PAY_COLOR[p.status] || 'bg-gray-100 text-gray-500'}`}>{p.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Maintenance */}
          {maintenance.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-800 mb-2">Maintenance Requests</h3>
              <div className="space-y-1.5">
                {maintenance.map(m => (
                  <div key={m.id} className="flex items-center justify-between">
                    <p className="text-sm text-gray-700 truncate flex-1">{m.title}</p>
                    <span className="text-xs text-gray-400 ml-2">{fmt(m.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent threads */}
          {threads.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-800 mb-2">Recent Messages</h3>
              <div className="space-y-1.5">
                {threads.map(t => (
                  <div key={t.id} className="flex items-center justify-between">
                    <p className="text-sm text-gray-700 truncate flex-1">{t.subject || '(no subject)'}</p>
                    <span className={`text-xs ml-2 ${t.is_open ? 'text-blue-500' : 'text-gray-400'}`}>{t.is_open ? 'Open' : 'Closed'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InviteModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ email:'', first_name:'', last_name:'', phone:'' });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError]   = useState('');

  async function handleSubmit(e) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const { data } = await api.post('/api/tenants/invite', form);
      setResult(data);
      onCreate(data.tenant);
    } catch(err) { setError(err.response?.data?.error || 'Failed to create account'); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Invite Tenant</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X size={18} /></button>
        </div>
        {result ? (
          <div className="p-6 space-y-4">
            <div className="rounded-lg bg-green-50 border border-green-200 p-4">
              <p className="text-sm font-semibold text-green-800">Account created!</p>
              <p className="text-sm text-green-700 mt-1">Share these credentials with the tenant:</p>
              <div className="mt-2 bg-white rounded p-3 font-mono text-xs space-y-1">
                <p><strong>Email:</strong> {result.tenant.email}</p>
                <p><strong>Temp password:</strong> {result.tempPassword}</p>
              </div>
              <p className="text-xs text-green-600 mt-2">They should change their password on first login.</p>
            </div>
            <button onClick={onClose} className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {[['email','Email','email',true],['first_name','First Name','text',true],['last_name','Last Name','text',false],['phone','Phone','tel',false]].map(([k,l,t,req]) => (
              <div key={k}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{l}{req && <span className="text-red-500 ml-1">*</span>}</label>
                <input type={t} value={form[k]} onChange={e => setForm(f=>({...f,[k]:e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" required={req} />
              </div>
            ))}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50">{saving ? 'Creating…' : 'Create Account'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function TenantsPage() {
  const { user, startImpersonation } = useAuth();
  const navigate = useNavigate();
  const canImpersonate = canPreviewTenantPortal(user?.role);
  const [tenants, setTenants]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [search, setSearch]     = useState('');
  const [filterStatus, setFilterStatus] = useState('active');
  const [filterOnboarding, setFilterOnboarding] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      const { data } = await api.get(`/api/tenants?${params}`);
      setTenants(data.tenants || []);
    } catch (e) {
      setLoadError(apiErrorMessage(e, 'Could not load tenants.'));
      setTenants([]);
    } finally { setLoading(false); }
  }, [filterStatus]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const filtered = tenants.filter(t => {
    const q = search.toLowerCase();
    if (q && !`${t.first_name} ${t.last_name} ${t.email}`.toLowerCase().includes(q)) return false;
    if (filterOnboarding === 'complete' && !t.checkin?.allComplete) return false;
    if (filterOnboarding === 'incomplete' && t.checkin?.allComplete) return false;
    return true;
  });

  const incompleteCount = tenants.filter((t) => t.checkin && !t.checkin.allComplete).length;

  async function handleViewAs(tenantId) {
    try {
      await startImpersonation(tenantId, '/manager/tenants');
      navigate('/tenant', { replace: true });
    } catch (err) {
      window.dispatchEvent(new CustomEvent('api:toast', {
        detail: {
          message: apiErrorMessage(err, 'Could not open tenant preview.'),
          variant: 'error',
        },
      }));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {tenants.length} tenants
            {incompleteCount > 0 && (
              <span className="text-amber-600"> · {incompleteCount} onboarding incomplete</span>
            )}
          </p>
        </div>
        <button onClick={() => setShowInvite(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Invite Tenant
        </button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email…" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 sm:w-56" />
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {[['active','Active'],['','All']].map(([v,l]) => (
            <button key={v} onClick={() => setFilterStatus(v)} className={`px-4 py-1.5 font-medium transition-colors ${filterStatus === v ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{l}</button>
          ))}
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {[['','Onboarding: All'],['incomplete','Incomplete'],['complete','Complete']].map(([v,l]) => (
            <button key={v || 'all'} onClick={() => setFilterOnboarding(v)} className={`px-3 py-1.5 font-medium transition-colors whitespace-nowrap ${filterOnboarding === v ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{l}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" /></div>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700">{loadError}</p>
          <button type="button" onClick={() => { setLoading(true); load(); }} className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800">Try again</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="mb-3 flex justify-center text-slate-300"><Users size={40} strokeWidth={1.5} /></div>
          <p className="font-medium text-gray-700">{tenants.length === 0 ? 'No tenants yet' : 'No tenants match your search'}</p>
        </div>
      ) : (
        <TableScroll className="bg-white rounded-xl border border-gray-200 portal-table">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>{['Tenant','Onboarding','Property / Unit','Lease','Rent','Balance','Joined', ...(canImpersonate ? [''] : [])].map(h => <th key={h || 'actions'} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h || 'Actions'}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(t => (
                <tr key={t.id} onClick={() => setSelected(t.id)} className="hover:bg-gray-50 cursor-pointer transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800">{t.first_name} {t.last_name}</p>
                    <p className="text-xs text-gray-400">{t.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <OnboardingProgress checkin={t.checkin} />
                  </td>
                  <td className="px-4 py-3 text-gray-500">{t.property_name || '—'}<br/><span className="text-xs">{t.unit_number ? `Unit ${t.unit_number}` : ''}</span></td>
                  <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${LEASE_COLOR[t.lease_status] || 'bg-gray-100 text-gray-500'}`}>{t.lease_status || '—'}</span></td>
                  <td className="px-4 py-3 text-gray-600">{fmtMoney(t.monthly_rent)}</td>
                  <td className="px-4 py-3"><span className={t.outstanding_balance > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>{t.outstanding_balance > 0 ? fmtMoney(t.outstanding_balance) : '$0.00'}</span></td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{fmt(t.created_at)}</td>
                  {canImpersonate && (
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={!t.is_active}
                        title={t.is_active ? 'View tenant portal' : 'Account inactive'}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (t.is_active) handleViewAs(t.id);
                        }}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-40"
                      >
                        View as
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {selected    && (
        <TenantDetailPanel
          tenantId={selected}
          onClose={() => setSelected(null)}
          onViewAs={handleViewAs}
          canImpersonate={canImpersonate}
          onTenantUpdated={load}
        />
      )}
      {showInvite  && <InviteModal onClose={() => setShowInvite(false)} onCreate={() => { setShowInvite(false); load(); }} />}
    </div>
  );
}
