import React, { useState, useEffect, useCallback } from 'react';
import { X, CheckCircle2 } from 'lucide-react';
import api from '@/api/axios';
import OverlayPortal from '@/components/ui/OverlayPortal';
import { useAuth } from '@/context/AuthContext';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import TableScroll from '@/components/ui/TableScroll';

const STATUS_META = { submitted:{label:'Submitted',color:'bg-blue-100 text-blue-700'}, triaged:{label:'Triaged',color:'bg-purple-100 text-purple-700'}, assigned:{label:'Assigned',color:'bg-indigo-100 text-indigo-700'}, in_progress:{label:'In Progress',color:'bg-yellow-100 text-yellow-700'}, pending_tenant:{label:'Awaiting Tenant',color:'bg-orange-100 text-orange-700'}, resolved:{label:'Resolved',color:'bg-green-100 text-green-700'}, cancelled:{label:'Cancelled',color:'bg-gray-100 text-gray-500'} };
const PRIORITY_META = { emergency:{label:'Emergency',color:'bg-red-100 text-red-700'}, high:{label:'High',color:'bg-orange-100 text-orange-700'}, medium:{label:'Medium',color:'bg-yellow-100 text-yellow-700'}, low:{label:'Low',color:'bg-gray-100 text-gray-500'} };

function fmt(ts) { return ts ? new Date(ts).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}) : '—'; }
function Badge({ meta }) { return meta ? <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span> : null; }

function DetailPanel({ req, onClose, onUpdated }) {
  const { user } = useAuth();
  const [status, setStatus] = useState(req.status);
  const [priority, setPriority] = useState(req.priority);
  const [assignedTo, setAssignedTo] = useState(req.assigned_to || '');
  const [scheduled, setScheduled] = useState(req.scheduled_at ? req.scheduled_at.slice(0,10) : '');
  const [estimatedCost, setEstimatedCost] = useState(req.estimated_cost ?? '');
  const [actualCost, setActualCost] = useState(req.actual_cost ?? '');
  const [note, setNote] = useState('');
  const [billAmount, setBillAmount] = useState(req.actual_cost ?? '');
  const [saving, setSaving] = useState(false);
  const [billing, setBilling] = useState(false);
  const [billMsg, setBillMsg] = useState('');
  const [saveError, setSaveError] = useState('');

  async function save() {
    setSaving(true);
    setSaveError('');
    try {
      const payload = { status, priority, note: note || undefined };
      if (assignedTo) payload.assigned_to = assignedTo;
      if (scheduled) payload.scheduled_at = scheduled;
      if (estimatedCost !== '') payload.estimated_cost = Number(estimatedCost);
      if (actualCost !== '') payload.actual_cost = Number(actualCost);
      const { data } = await api.patch(`/api/maintenance/${req.id}`, payload);
      onUpdated(data.request);
      setNote('');
    } catch (e) {
      setSaveError(apiErrorMessage(e, 'Could not save changes.'));
    } finally { setSaving(false); }
  }

  async function billTenant() {
    const amt = parseFloat(billAmount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    setBilling(true);
    setBillMsg('');
    try {
      const { data } = await api.post(`/api/maintenance/${req.id}/bill-tenant`, {
        amount: amt,
        notes: `Damage/maintenance charge for: ${req.title}`,
      });
      setBillMsg(data.message || 'Charge recorded.');
      onUpdated({ ...req, actual_cost: amt });
    } catch (e) {
      setBillMsg(e.response?.data?.error || e.response?.data?.message || 'Billing failed');
    } finally {
      setBilling(false);
    }
  }

  return (
    <OverlayPortal>
      <div className="drawer-overlay">
        <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
        <div className="relative flex h-full max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden bg-white shadow-2xl">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
            <h2 className="font-semibold text-gray-900 truncate pr-4">{req.title}</h2>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 leading-none shrink-0" aria-label="Close"><X size={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge meta={STATUS_META[req.status]} />
              <Badge meta={PRIORITY_META[req.priority]} />
              {req.is_ai_triaged && <span className="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">AI Triaged</span>}
            </div>

            {req.description && (
              <div><p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Description</p><p className="text-sm text-gray-700 whitespace-pre-wrap">{req.description}</p></div>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-gray-400">Tenant</p><p className="font-medium text-gray-700">{req.tenant_name}</p><p className="text-xs text-gray-400">{req.tenant_email}</p></div>
              <div><p className="text-xs text-gray-400">Unit</p><p className="font-medium text-gray-700">{req.unit_number} · {req.property_name}</p></div>
              <div><p className="text-xs text-gray-400">Submitted</p><p className="font-medium text-gray-700">{fmt(req.created_at)}</p></div>
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Update</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Status</label>
                  <select value={status} onChange={e => setStatus(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                    {Object.entries(STATUS_META).map(([v,m]) => <option key={v} value={v}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Priority</label>
                  <select value={priority} onChange={e => setPriority(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                    {Object.entries(PRIORITY_META).map(([v,m]) => <option key={v} value={v}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Assigned to</label>
                <div className="flex gap-2 items-center">
                  <p className="text-sm text-gray-700 flex-1">{req.assigned_to_name || 'Unassigned'}</p>
                  <button
                    type="button"
                    onClick={() => setAssignedTo(user?.id || '')}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    Assign to me
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Schedule Date</label>
                <input type="date" value={scheduled} onChange={e => setScheduled(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Est. cost ($)</label>
                  <input type="number" min="0" step="0.01" value={estimatedCost} onChange={e => setEstimatedCost(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Actual cost ($)</label>
                  <input type="number" min="0" step="0.01" value={actualCost} onChange={e => setActualCost(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Note to tenant (on status change)</label>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm resize-none" placeholder="Optional message included in email" />
              </div>
              {saveError && <p className="text-sm text-red-600">{saveError}</p>}
              <button type="button" onClick={save} disabled={saving} className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
              <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">Bill tenant (damages / mishap)</p>
              <p className="text-xs text-amber-800">Records a charge and emails the tenant at their login email. Documented in payment history.</p>
              <div className="flex gap-2">
                <input type="number" min="0" step="0.01" value={billAmount} onChange={e => setBillAmount(e.target.value)} className="flex-1 border border-amber-200 rounded-lg px-2 py-1.5 text-sm" placeholder="Amount" />
                <button type="button" onClick={billTenant} disabled={billing} className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-semibold hover:bg-amber-800 disabled:opacity-50">
                  {billing ? '…' : 'Bill'}
                </button>
              </div>
              {billMsg && <p className="text-xs text-amber-900">{billMsg}</p>}
            </div>
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}

export default function MaintenanceQueue() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(null);
  const [filterStatus, setFilterStatus]   = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (filterStatus)   params.set('status', filterStatus);
      if (filterPriority) params.set('priority', filterPriority);
      const { data } = await api.get(`/api/maintenance?${params}`);
      setRequests(data.requests || []);
    } catch (e) {
      setLoadError(apiErrorMessage(e, 'Could not load maintenance requests.'));
      setRequests([]);
    } finally { setLoading(false); }
  }, [filterStatus, filterPriority]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  function handleUpdated(updated) {
    setRequests(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
    setSelected(prev => prev ? { ...prev, ...updated } : prev);
  }

  const OPEN = new Set(['submitted','triaged','assigned','in_progress','pending_tenant']);
  const emergency = requests.filter(r => r.priority === 'emergency' && OPEN.has(r.status)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Maintenance Queue</h1>
          <p className="text-sm text-gray-500 mt-0.5">{requests.length} requests{emergency > 0 ? ` · ${emergency} emergency` : ''}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700">
          <option value="">All statuses</option>
          {Object.entries(STATUS_META).map(([v,m]) => <option key={v} value={v}>{m.label}</option>)}
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700">
          <option value="">All priorities</option>
          {Object.entries(PRIORITY_META).map(([v,m]) => <option key={v} value={v}>{m.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" /></div>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700">{loadError}</p>
          <button type="button" onClick={() => { setLoading(true); load(); }} className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800">Try again</button>
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="mb-3 flex justify-center text-emerald-400"><CheckCircle2 size={40} strokeWidth={1.5} /></div>
          <p className="font-medium text-gray-700">No maintenance requests</p>
        </div>
      ) : (
        <TableScroll className="bg-white rounded-xl border border-gray-200">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Title','Property/Unit','Tenant','Priority','Status','Scheduled','Submitted'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {requests.map(r => (
                <tr key={r.id} onClick={() => setSelected(r)} className="hover:bg-gray-50 cursor-pointer transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-800 max-w-[200px] truncate">{r.title}</td>
                  <td className="px-4 py-3 text-gray-500">{r.property_name}<br/><span className="text-xs">Unit {r.unit_number}</span></td>
                  <td className="px-4 py-3 text-gray-500">{r.tenant_name}</td>
                  <td className="px-4 py-3"><Badge meta={PRIORITY_META[r.priority]} /></td>
                  <td className="px-4 py-3"><Badge meta={STATUS_META[r.status]} /></td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{fmt(r.scheduled_at)}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{fmt(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {selected && <DetailPanel req={selected} onClose={() => setSelected(null)} onUpdated={handleUpdated} />}
    </div>
  );
}
