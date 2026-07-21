import React, { useState, useEffect, useCallback } from 'react';
import { Star, Wrench } from 'lucide-react';
import api from '@/api/axios';
import { notifyCheckinRefresh } from '@/hooks/useCheckin';

// ─── helpers ────────────────────────────────────────────────────────────────

function StarRating({ value = 0, size = 14 }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-yellow-400" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={n <= value ? 'fill-yellow-400 text-yellow-400' : 'fill-transparent text-slate-300'}
        />
      ))}
    </span>
  );
}

const STATUS_META = {
  submitted:      { label: 'Submitted',      color: 'bg-blue-100 text-blue-700' },
  triaged:        { label: 'Triaged',         color: 'bg-purple-100 text-purple-700' },
  assigned:       { label: 'Assigned',        color: 'bg-indigo-100 text-indigo-700' },
  in_progress:    { label: 'In Progress',     color: 'bg-yellow-100 text-yellow-700' },
  pending_tenant: { label: 'Awaiting You',    color: 'bg-orange-100 text-orange-700' },
  resolved:       { label: 'Resolved',        color: 'bg-green-100 text-green-700' },
  cancelled:      { label: 'Cancelled',       color: 'bg-gray-100 text-gray-500' },
};

const PRIORITY_META = {
  emergency: { label: 'Emergency', color: 'bg-red-100 text-red-700' },
  high:      { label: 'High',      color: 'bg-orange-100 text-orange-700' },
  medium:    { label: 'Medium',    color: 'bg-yellow-100 text-yellow-700' },
  low:       { label: 'Low',       color: 'bg-gray-100 text-gray-500' },
};

const CATEGORIES = [
  { value: '', label: 'All categories' },
  { value: 'plumbing',    label: 'Plumbing' },
  { value: 'hvac',        label: 'HVAC' },
  { value: 'electrical',  label: 'Electrical' },
  { value: 'appliance',   label: 'Appliance' },
  { value: 'structural',  label: 'Structural' },
  { value: 'pest',        label: 'Pest Control' },
  { value: 'exterior',    label: 'Exterior' },
  { value: 'other',       label: 'Other' },
];

function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function Badge({ meta }) {
  if (!meta) return null;
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>
      {meta.label}
    </span>
  );
}

// ─── New Request Modal ───────────────────────────────────────────────────────

function NewRequestModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ title: '', description: '', category: '', priority: 'medium' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        category: form.category || undefined,
        priority: form.priority,
      };
      const { data } = await api.post('/api/maintenance', payload);
      onCreate(data.request);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">New Maintenance Request</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="e.g. Leaking faucet in kitchen"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={form.category}
                onChange={e => set('category', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {CATEGORIES.slice(1).map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select
                value={form.priority}
                onChange={e => set('priority', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={4}
              placeholder="Describe the issue in detail — when it started, how severe, any photos attached…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
            />
          </div>
          {form.priority === 'emergency' && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              <strong>Emergency requests</strong> will be escalated immediately. If this is a life-safety emergency, please also call 911.
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !form.title.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Rating Modal ────────────────────────────────────────────────────────────

function RatingModal({ request, onClose, onSaved }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!rating) return;
    setSaving(true);
    setError('');
    try {
      await api.post(`/api/maintenance/${request.id}/rating`, { rating, comment });
      onSaved(rating, comment);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save rating');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Rate this repair</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-gray-600">{request.title}</p>
          <div className="flex gap-2 justify-center">
            {[1,2,3,4,5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className="transition-transform hover:scale-110"
                aria-label={`Rate ${n} stars`}
              >
                <Star size={30} className={n <= rating ? 'fill-yellow-400 text-yellow-400' : 'fill-transparent text-slate-300'} />
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={3}
            placeholder="Any comments? (optional)"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
              Skip
            </button>
            <button
              type="submit"
              disabled={saving || !rating}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Submit Rating'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Request Detail Panel ────────────────────────────────────────────────────

function DetailPanel({ request, onClose, onRated }) {
  const canRate = request.status === 'resolved' && !request.tenant_rating;

  return (
    <div className="drawer-overlay">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md shadow-2xl flex flex-col overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-gray-900 truncate pr-4">{request.title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none shrink-0">&times;</button>
        </div>
        <div className="p-6 space-y-5 flex-1">
          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            <Badge meta={STATUS_META[request.status]} />
            <Badge meta={PRIORITY_META[request.priority]} />
            {request.category && (
              <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {CATEGORIES.find(c => c.value === request.category)?.label || request.category}
              </span>
            )}
          </div>

          {/* Description */}
          {request.description && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Description</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{request.description}</p>
            </div>
          )}

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-gray-400">Submitted</p>
              <p className="text-sm font-medium text-gray-700">{fmt(request.created_at)}</p>
            </div>
            {request.scheduled_at && (
              <div>
                <p className="text-xs text-gray-400">Scheduled</p>
                <p className="text-sm font-medium text-gray-700">{fmt(request.scheduled_at)}</p>
              </div>
            )}
            {request.completed_at && (
              <div>
                <p className="text-xs text-gray-400">Completed</p>
                <p className="text-sm font-medium text-gray-700">{fmt(request.completed_at)}</p>
              </div>
            )}
            {request.assigned_to_name && (
              <div>
                <p className="text-xs text-gray-400">Assigned to</p>
                <p className="text-sm font-medium text-gray-700">{request.assigned_to_name}</p>
              </div>
            )}
            {request.estimated_cost != null && (
              <div>
                <p className="text-xs text-gray-400">Est. Cost</p>
                <p className="text-sm font-medium text-gray-700">${Number(request.estimated_cost).toFixed(2)}</p>
              </div>
            )}
          </div>

          {/* Rating */}
          {request.tenant_rating && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Your Rating</p>
              <StarRating value={request.tenant_rating} size={18} />
              {request.tenant_rating_comment && (
                <p className="text-sm text-gray-500 mt-1">{request.tenant_rating_comment}</p>
              )}
            </div>
          )}

          {canRate && (
            <button
              onClick={onRated}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-indigo-300 py-2.5 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
            >
              <Star size={15} /> Rate this repair
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function MaintenancePage() {
  const [requests, setRequests]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filterCat, setFilterCat]     = useState('');
  const [filterStatus, setFilterStatus] = useState('open');
  const [showNew, setShowNew]         = useState(false);
  const [selected, setSelected]       = useState(null);
  const [showRating, setShowRating]   = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/api/maintenance/my');
      setRequests(data.requests || []);
    } catch (err) {
      console.error('[maintenance] load', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.patch('/api/users/me/checkin', { step: 'maintenance_viewed' })
      .then(() => notifyCheckinRefresh())
      .catch(() => {});
  }, []);

  const OPEN_STATUSES = new Set(['submitted','triaged','assigned','in_progress','pending_tenant']);

  const filtered = requests.filter(r => {
    if (filterCat && r.category !== filterCat) return false;
    if (filterStatus === 'open'     && !OPEN_STATUSES.has(r.status)) return false;
    if (filterStatus === 'resolved' && r.status !== 'resolved')       return false;
    if (filterStatus === 'all')                                        return true;
    return true;
  });

  function handleCreated(req) {
    setRequests(prev => [req, ...prev]);
    setShowNew(false);
  }

  function handleRated(rating, comment) {
    const updated = { ...selected, tenant_rating: rating, tenant_rating_comment: comment };
    setRequests(prev => prev.map(r => r.id === selected.id ? updated : r));
    setSelected(updated);
    setShowRating(false);
  }

  const openCount   = requests.filter(r => OPEN_STATUSES.has(r.status)).length;
  const resolvedCount = requests.filter(r => r.status === 'resolved').length;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Maintenance</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {openCount} open &middot; {resolvedCount} resolved
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Request
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {[['open','Open'],['resolved','Resolved'],['all','All']].map(([v,l]) => (
            <button
              key={v}
              onClick={() => setFilterStatus(v)}
              className={`px-4 py-1.5 font-medium transition-colors ${
                filterStatus === v ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <select
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          {CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <Wrench size={36} strokeWidth={1.5} className="mx-auto mb-3 text-slate-300" />
          <p className="font-medium text-gray-700">
            {requests.length === 0 ? 'No maintenance requests' : 'No requests match your filter'}
          </p>
          {requests.length === 0 && (
            <p className="mt-1 text-sm text-gray-400">Submit a request when something needs fixing.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(req => (
            <button
              key={req.id}
              onClick={() => setSelected(req)}
              className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{req.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{req.property_name} · Unit {req.unit_number}</p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  <Badge meta={STATUS_META[req.status]} />
                  {req.priority !== 'medium' && <Badge meta={PRIORITY_META[req.priority]} />}
                </div>
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  {req.category && (
                    <span className="text-xs text-gray-400">
                      {CATEGORIES.find(c => c.value === req.category)?.label}
                    </span>
                  )}
                  {req.scheduled_at && (
                    <span className="text-xs text-indigo-500">
                      Scheduled {fmt(req.scheduled_at)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {req.tenant_rating && (
                    <StarRating value={req.tenant_rating} size={12} />
                  )}
                  <span className="text-xs text-gray-400">{fmt(req.created_at)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Modals */}
      {showNew && <NewRequestModal onClose={() => setShowNew(false)} onCreate={handleCreated} />}

      {selected && !showRating && (
        <DetailPanel
          request={selected}
          onClose={() => setSelected(null)}
          onRated={() => setShowRating(true)}
        />
      )}

      {selected && showRating && (
        <RatingModal
          request={selected}
          onClose={() => setShowRating(false)}
          onSaved={handleRated}
        />
      )}
    </div>
  );
}
