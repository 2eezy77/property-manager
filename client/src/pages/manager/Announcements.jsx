import React, { useState, useEffect, useCallback } from 'react';
import { X, Megaphone } from 'lucide-react';
import api from '@/api/axios';

function fmt(ts) { return ts ? new Date(ts).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}) : '—'; }

const CHANNEL_LABELS = { in_app:'In-App', email:'Email', sms:'SMS', push:'Push' };

function ComposeModal({ onClose, onCreate, properties }) {
  const [form, setForm] = useState({ title:'', body:'', channel:'in_app', property_id:'', send_at:'' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(k,v) { setForm(f=>({...f,[k]:v})); }

  async function handleSubmit(e) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const payload = { title: form.title.trim(), body: form.body.trim(), channel: form.channel };
      if (form.property_id) payload.property_id = form.property_id;
      if (form.send_at)     payload.send_at = form.send_at;
      const { data } = await api.post('/api/announcements', payload);
      onCreate(data.announcement);
    } catch(err) { setError(err.response?.data?.error || 'Failed to create announcement'); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">New Announcement</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title <span className="text-red-500">*</span></label>
            <input type="text" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Water Shutoff — Saturday 9am–12pm" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message <span className="text-red-500">*</span></label>
            <textarea value={form.body} onChange={e => set('body', e.target.value)} rows={4} placeholder="Write your announcement…" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
              <select value={form.channel} onChange={e => set('channel', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                {Object.entries(CHANNEL_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Property <span className="text-gray-400 font-normal">(all if blank)</span></label>
              <select value={form.property_id} onChange={e => set('property_id', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                <option value="">All properties</option>
                {(properties||[]).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Schedule <span className="text-gray-400 font-normal">(send now if blank)</span></label>
            <input type="datetime-local" value={form.send_at} onChange={e => set('send_at', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving || !form.title.trim() || !form.body.trim()} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50">{saving ? 'Sending…' : 'Send Announcement'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState([]);
  const [properties, setProperties]       = useState([]);
  const [loading, setLoading]             = useState(true);
  const [showCompose, setShowCompose]     = useState(false);

  const load = useCallback(async () => {
    const [aR, pR] = await Promise.allSettled([
      api.get('/api/announcements'),
      api.get('/api/properties'),
    ]);
    if (aR.status === 'fulfilled') setAnnouncements(aR.value.data.announcements || []);
    if (pR.status === 'fulfilled') setProperties(pR.value.data.properties || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Announcements</h1>
          <p className="text-sm text-gray-500 mt-0.5">Broadcast messages to tenants</p>
        </div>
        <button onClick={() => setShowCompose(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          New Announcement
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" /></div>
      ) : announcements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="mb-3 flex justify-center text-slate-300"><Megaphone size={40} strokeWidth={1.5} /></div>
          <p className="font-medium text-gray-700">No announcements yet</p>
          <p className="text-sm text-gray-400 mt-1">Send a message to all your tenants at once.</p>
          <button onClick={() => setShowCompose(true)} className="mt-4 px-4 py-2 text-sm font-medium text-indigo-600 border border-indigo-300 rounded-lg hover:bg-indigo-50 transition-colors">Create First Announcement</button>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map(a => (
            <div key={a.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{a.title}</p>
                  <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{a.body}</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{CHANNEL_LABELS[a.channel] || a.channel}</span>
                  {a.property_name && <p className="text-xs text-gray-400 mt-1">{a.property_name}</p>}
                </div>
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                <span>By {a.sender_name || 'Staff'}</span>
                <span>{fmt(a.created_at)}</span>
                {a.recipient_count && <span>{a.recipient_count} recipients</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCompose && (
        <ComposeModal
          properties={properties}
          onClose={() => setShowCompose(false)}
          onCreate={ann => { setAnnouncements(prev => [ann, ...prev]); setShowCompose(false); }}
        />
      )}
    </div>
  );
}
