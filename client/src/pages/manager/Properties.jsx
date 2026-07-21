import React, { useState, useEffect, useCallback } from 'react';
import { X, Building2 } from 'lucide-react';
import api from '@/api/axios';
import OverlayPortal from '@/components/ui/OverlayPortal';
import TableScroll from '@/components/ui/TableScroll';

function fmt(ts) { return ts ? new Date(ts).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}) : '—'; }
function fmtMoney(v) { return v != null ? '$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2}) : '—'; }

const LEASE_STATUS_COLOR = { active:'bg-green-100 text-green-700', pending_signature:'bg-yellow-100 text-yellow-700', pending:'bg-yellow-100 text-yellow-700', draft:'bg-gray-100 text-gray-500', expired:'bg-red-100 text-red-600' };

function UnitRow({ unit }) {
  return (
    <tr className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3 font-medium text-gray-800">Unit {unit.unit_number}</td>
      <td className="px-4 py-3 text-gray-500 text-sm">{[unit.bedrooms && `${unit.bedrooms}bd`, unit.bathrooms && `${unit.bathrooms}ba`, unit.square_feet && `${unit.square_feet} sqft`].filter(Boolean).join(' · ') || '—'}</td>
      <td className="px-4 py-3">
        {unit.lease_id ? (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${LEASE_STATUS_COLOR[unit.lease_status] || 'bg-gray-100 text-gray-500'}`}>{unit.lease_status}</span>
        ) : (
          <span className="text-xs text-gray-400">Vacant</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">{unit.tenant_name || '—'}</td>
      <td className="px-4 py-3 text-sm text-gray-500">{unit.monthly_rent ? fmtMoney(unit.monthly_rent)+'/mo' : '—'}</td>
      <td className="px-4 py-3 text-xs text-gray-400">{unit.end_date ? `Ends ${fmt(unit.end_date)}` : '—'}</td>
    </tr>
  );
}

function AddUnitModal({ propertyId, onClose, onCreate }) {
  const [form, setForm] = useState({ unit_number:'', bedrooms:'', bathrooms:'', square_feet:'', floor_number:'' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = { unit_number: form.unit_number.trim() };
      if (form.bedrooms)    payload.bedrooms    = Number(form.bedrooms);
      if (form.bathrooms)   payload.bathrooms   = Number(form.bathrooms);
      if (form.square_feet) payload.square_feet = Number(form.square_feet);
      if (form.floor_number) payload.floor_number = Number(form.floor_number);
      const { data } = await api.post(`/api/properties/${propertyId}/units`, payload);
      onCreate(data.unit);
    } catch(err) { setError(err.response?.data?.error || 'Failed to add unit'); }
    finally { setSaving(false); }
  }

  return (
    <OverlayPortal>
      <div className="modal-overlay">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Add Unit</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Unit Number <span className="text-red-500">*</span></label>
            <input type="text" value={form.unit_number} onChange={e => setForm(f=>({...f,unit_number:e.target.value}))} placeholder="e.g. 101, A, 2B" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[['bedrooms','Bedrooms'],['bathrooms','Bathrooms'],['square_feet','Sq Ft'],['floor_number','Floor']].map(([k,l]) => (
              <div key={k}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{l}</label>
                <input type="number" value={form[k]} onChange={e => setForm(f=>({...f,[k]:e.target.value}))} min="0" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
            ))}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving || !form.unit_number.trim()} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50">{saving ? 'Adding…' : 'Add Unit'}</button>
          </div>
        </form>
      </div>
      </div>
    </OverlayPortal>
  );
}

function PropertyDetail({ property, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showAddUnit, setShowAddUnit] = useState(false);

  useEffect(() => {
    setLoading(true);
    setLoadError('');
    api.get(`/api/properties/${property.id}`)
      .then(({ data }) => setDetail(data))
      .catch((err) => {
        console.error(err);
        setLoadError(err.response?.data?.message || err.response?.data?.error || 'Could not load property details.');
      })
      .finally(() => setLoading(false));
  }, [property.id]);

  function handleUnitAdded(unit) {
    setDetail(prev => ({ ...prev, units: [...(prev.units||[]), { ...unit, lease_id: null }] }));
    setShowAddUnit(false);
  }

  return (
    <OverlayPortal>
      <div className="drawer-overlay">
        <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
        <div className="relative flex h-full max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">{property.name}</h2>
            <p className="text-xs text-gray-400">{[property.address_line1, property.city, property.state].filter(Boolean).join(', ')}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48"><div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" /></div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              {[
                ['Total Units', property.unit_count],
                ['Occupied', `${property.occupied_count}/${property.unit_count}`],
                ['Open Maint.', property.open_maintenance_count ?? 0],
              ].map(([l,v]) => (
                <div key={l} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-gray-800">{v}</p>
                  <p className="text-xs text-gray-400">{l}</p>
                </div>
              ))}
            </div>

            {/* Units table */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800">Units</h3>
                <button onClick={() => setShowAddUnit(true)} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">+ Add Unit</button>
              </div>
              {loadError ? (
                <p className="text-sm text-red-600 text-center py-6">{loadError}</p>
              ) : !detail?.units?.length ? (
                <p className="text-sm text-gray-400 text-center py-6">No units yet. Add one above.</p>
              ) : (
                <TableScroll className="rounded-xl border border-gray-200">
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>{['Unit','Details','Lease','Tenant','Rent','Lease End'].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {(detail?.units || []).map(u => <UnitRow key={u.id} unit={u} />)}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </div>

            {/* Staff */}
            {detail?.staff?.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-800 mb-3">Assigned Staff</h3>
                <div className="space-y-2">
                  {detail.staff.map(s => (
                    <div key={s.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{s.first_name} {s.last_name}</p>
                        <p className="text-xs text-gray-400">{s.email} · {s.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {showAddUnit && <AddUnitModal propertyId={property.id} onClose={() => setShowAddUnit(false)} onCreate={handleUnitAdded} />}
      </div>
    </OverlayPortal>
  );
}

export default function PropertiesPage() {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const { data } = await api.get('/api/properties');
      setProperties(data.properties || []);
    } catch (err) {
      setLoadError(err.response?.data?.message || err.response?.data?.error || 'Could not load properties.');
      setProperties([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const totalUnits    = properties.reduce((s,p) => s + Number(p.unit_count||0), 0);
  const occupiedUnits = properties.reduce((s,p) => s + Number(p.occupied_count||0), 0);
  const occupancy     = totalUnits > 0 ? Math.round((occupiedUnits/totalUnits)*100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Properties</h1>
          <p className="text-sm text-gray-500 mt-0.5">{properties.length} properties · {occupancy}% occupancy</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" /></div>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700">{loadError}</p>
          <button type="button" onClick={() => { setLoading(true); load(); }} className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-800">Try again</button>
        </div>
      ) : properties.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="mb-3 flex justify-center text-slate-300"><Building2 size={40} strokeWidth={1.5} /></div>
          <p className="font-medium text-gray-700">No properties found</p>
          <p className="text-sm text-gray-400 mt-1">Properties are created by account owners.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {properties.map(p => (
            <button key={p.id} onClick={() => setSelected(p)} className="text-left bg-white rounded-xl border border-gray-200 p-5 hover:border-indigo-300 hover:shadow-md transition-all">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{p.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{[p.address_line1, p.city, p.state].filter(Boolean).join(', ') || 'No address'}</p>
                </div>
                <Building2 size={24} strokeWidth={2} className="shrink-0 text-slate-400" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  [p.unit_count ?? 0, 'Units'],
                  [p.occupied_count ?? 0, 'Occupied'],
                  [p.open_maintenance_count ?? 0, 'Requests'],
                ].map(([v,l]) => (
                  <div key={l} className="bg-gray-50 rounded-lg p-2">
                    <p className="text-lg font-bold text-gray-800">{v}</p>
                    <p className="text-[10px] text-gray-400">{l}</p>
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && <PropertyDetail property={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
