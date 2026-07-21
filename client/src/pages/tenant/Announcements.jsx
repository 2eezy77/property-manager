import React, { useCallback, useEffect, useState } from 'react';
import api from '@/api/axios';
import PageHeader from '@/components/ui/PageHeader';
import Panel from '@/components/ui/Panel';

function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function TenantAnnouncements() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/announcements');
      setItems(data.announcements || []);
    } catch (e) {
      setError(e.response?.data?.message || e.response?.data?.error || 'Could not load announcements.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        subtitle="Property-wide notices — common area walkthroughs and other broadcasts."
      />

      {loading && (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      )}

      {!loading && error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {!loading && !error && items.length === 0 && (
        <Panel>
          <p className="text-sm text-slate-600">No announcements yet.</p>
          <p className="text-xs text-slate-500 mt-1">
            Common area visit notices appear here after the owner approves a site visit.
            Room-specific notices go to Messages instead.
          </p>
        </Panel>
      )}

      {!loading && !error && items.length > 0 && (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id} className="portal-card p-5">
              <p className="font-semibold text-slate-900">{a.title}</p>
              <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{a.body}</p>
              <p className="text-xs text-slate-400 mt-3">
                {fmt(a.created_at)}
                {a.property_name ? ` · ${a.property_name}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
