import React, { useCallback, useEffect, useState } from 'react';
import api from '@/api/axios';
import Panel from '@/components/ui/Panel';
import PageHeader from '@/components/ui/PageHeader';

export default function PortalLaunchCampaignPage() {
  const [messages, setMessages] = useState([]);
  const [bcc, setBcc] = useState('');
  const [electric, setElectric] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [previewHtml, setPreviewHtml] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/owner/portal-launch');
      setMessages(data.messages || []);
      setBcc(data.bcc || '');
      setElectric(data.electric);
      setActiveId((prev) => prev || data.messages?.[0]?.id);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!activeId) {
      setPreviewHtml('');
      return;
    }
    let cancelled = false;
    api
      .get(`/api/owner/portal-launch/preview/${activeId}`, { responseType: 'text' })
      .then((res) => {
        if (!cancelled) setPreviewHtml(res.data);
      })
      .catch(() => {
        if (!cancelled) setPreviewHtml('<p>Failed to load preview.</p>');
      });
    return () => { cancelled = true; };
  }, [activeId]);

  const active = messages.find((m) => m.id === activeId);

  async function handleSend(dryRun) {
    const verb = dryRun ? 'Dry run' : 'Send';
    const n = messages.length;
    if (!dryRun && !confirm(
      `Send ${n} portal launch emails?\n\n` +
      '• Manager + each tenant get a new unique password in their email only\n' +
      '• Owner emails (you + co-owners) have no password\n' +
      `• BCC: ${bcc || 'Gmail sender'}`
    )) {
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const { data } = await api.post('/api/owner/portal-launch/send', { dryRun });
      setResult(data);
    } catch (e) {
      setError(e.response?.data?.message || `${verb} failed`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16">
      <PageHeader
        title="Portal launch emails"
        subtitle="Preview launch emails for owner, manager, and tenants. Send all sets a unique password for each recipient (except you) and includes it only in their personal email. You are BCC on every send."
      />

      {bcc && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">
          BCC on every send: <strong>{bcc}</strong> (connected Gmail)
        </p>
      )}

      <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <strong>Previews</strong> show a placeholder where the password will go. Real passwords are created only when you click{' '}
        <strong>Send all</strong> (not Dry run). Check each person&apos;s inbox or your Gmail BCC — not the owner preview.
      </p>

      {electric && (
        <p className="text-xs text-gray-500">
          Electric draft in emails: ${Number(electric.currentCharges).toFixed(2)} · period{' '}
          {electric.periodStart} → {electric.periodEnd} · notify after {electric.chargeableAfter}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || loading || !messages.length}
          onClick={() => handleSend(false)}
          className="px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Working…' : `Send all ${messages.length} emails`}
        </button>
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => handleSend(true)}
          className="px-5 py-2.5 rounded-lg border border-gray-200 text-gray-700 font-medium text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Dry run
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && (
        <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-4 overflow-auto max-h-48">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading previews…</p>
      ) : (
        <div className="grid lg:grid-cols-[240px_1fr] gap-4">
          <Panel className="p-2">
            <ul className="space-y-1">
              {messages.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(m.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                      activeId === m.id ? 'bg-indigo-50 text-indigo-800 font-semibold' : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <span className="block font-medium">{m.label}</span>
                    <span className="block text-xs text-gray-500 truncate">{m.to}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel className="overflow-hidden p-0">
            {active && (
              <div className="border-b border-gray-100 px-4 py-3 bg-gray-50">
                <p className="text-xs uppercase tracking-wide text-gray-400">{active.label}</p>
                <p className="font-semibold text-gray-900 text-sm mt-0.5">{active.subject}</p>
                <p className="text-xs text-gray-500 mt-1">To: {active.to}</p>
              </div>
            )}
            {previewHtml && (
              <iframe
                title="Email preview"
                srcDoc={previewHtml}
                className="w-full border-0 bg-slate-100"
                style={{ minHeight: 580 }}
                sandbox="allow-same-origin"
              />
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
