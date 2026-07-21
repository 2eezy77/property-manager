import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle2, MessageSquare } from 'lucide-react';
import api from '@/api/axios';

const URGENCY_COLOR = { emergency:'bg-red-100 text-red-700', high:'bg-orange-100 text-orange-700', medium:'bg-yellow-100 text-yellow-700', low:'bg-gray-100 text-gray-500' };
const TRIAGE_COLOR  = { pending:'bg-blue-100 text-blue-700', triaged:'bg-purple-100 text-purple-700', auto_responded:'bg-teal-100 text-teal-700', resolved:'bg-green-100 text-green-700' };

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7)  return d.toLocaleDateString([], { weekday:'short' });
  return d.toLocaleDateString([], { month:'short', day:'numeric' });
}

function ThreadRow({ t, active, onClick }) {
  return (
    <button onClick={onClick} className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${active ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-gray-800 truncate flex-1">{t.subject || '(no subject)'}</span>
        <span className="text-xs text-gray-400 shrink-0">{fmt(t.updated_at)}</span>
      </div>
      <p className="text-xs text-gray-500 truncate mt-0.5">{t.tenant_name} · {t.property_name} U{t.unit_number}</p>
      <div className="flex gap-1.5 mt-1 flex-wrap">
        {t.urgency && t.urgency !== 'low' && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${URGENCY_COLOR[t.urgency]}`}>{t.urgency}</span>}
        {t.triage_status && <span className={`text-[10px] px-1.5 py-0.5 rounded ${TRIAGE_COLOR[t.triage_status] || 'bg-gray-100 text-gray-500'}`}>{t.triage_status.replace('_',' ')}</span>}
      </div>
    </button>
  );
}

function MsgBubble({ msg }) {
  const out = msg.direction === 'outbound';
  return (
    <div className={`flex ${out ? 'justify-start' : 'justify-end'} mb-3`}>
      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${out ? 'bg-white border border-gray-200 text-gray-800' : 'bg-indigo-600 text-white'}`}>
        {out && <p className="text-[10px] font-semibold text-indigo-500 mb-1 uppercase tracking-wide">{msg.is_ai_generated ? 'AI Auto-Reply' : 'Tenant'}</p>}
        {!out && msg.is_internal && <p className="text-[10px] font-semibold text-indigo-200 mb-1 uppercase tracking-wide">Internal Note</p>}
        <p className="whitespace-pre-wrap">{msg.body}</p>
        <p className={`text-[10px] mt-1 text-right ${out ? 'text-gray-400' : 'text-indigo-200'}`}>{fmt(msg.created_at)}</p>
      </div>
    </div>
  );
}

export default function ManagerInbox() {
  const [threads, setThreads]   = useState([]);
  const [active, setActive]     = useState(null);
  const [messages, setMessages] = useState([]);
  const [summary, setSummary]   = useState('');
  const [loadingT, setLoadingT] = useState(true);
  const [loadingM, setLoadingM] = useState(false);
  const [reply, setReply]       = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending]   = useState(false);
  const [urgency, setUrgency]   = useState('');
  const [filterTriage, setFilterTriage] = useState('pending');
  const [filterUrgency, setFilterUrgency] = useState('');
  const bottomRef = useRef(null);

  const loadThreads = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterTriage)  params.set('triage_status', filterTriage);
      if (filterUrgency) params.set('urgency', filterUrgency);
      const { data } = await api.get(`/api/messages/inbox?${params}`);
      setThreads(data.threads || []);
    } catch (err) { console.error(err); }
    finally { setLoadingT(false); }
  }, [filterTriage, filterUrgency]);

  useEffect(() => { setLoadingT(true); loadThreads(); }, [loadThreads]);

  async function openThread(t) {
    setActive(t); setMessages([]); setSummary(''); setLoadingM(true);
    try {
      const { data } = await api.get(`/api/messages/threads/${t.id}`);
      setMessages(data.messages || []);
      setUrgency(t.urgency || 'low');
    } catch(e) { console.error(e); } finally { setLoadingM(false); }
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:'smooth' }); }, [messages]);

  async function handleReply(e) {
    e.preventDefault();
    if (!reply.trim() || !active) return;
    setSending(true);
    try {
      await api.post(`/api/messages/threads/${active.id}/reply`, { body: reply.trim(), is_internal: internal });
      setReply('');
      const { data } = await api.get(`/api/messages/threads/${active.id}`);
      setMessages(data.messages || []);
      if (!internal) {
        setThreads(prev => prev.map(t => t.id === active.id ? { ...t, triage_status:'triaged', last_message: reply.trim() } : t));
      }
    } catch(e) { console.error(e); } finally { setSending(false); }
  }

  async function handleClose() {
    if (!active) return;
    await api.patch(`/api/messages/threads/${active.id}/close`);
    setThreads(prev => prev.filter(t => t.id !== active.id));
    setActive(null); setMessages([]);
  }

  async function handleUrgencyChange(val) {
    setUrgency(val);
    await api.patch(`/api/messages/threads/${active.id}/urgency`, { urgency: val });
    setActive(prev => ({ ...prev, urgency: val }));
    setThreads(prev => prev.map(t => t.id === active.id ? { ...t, urgency: val } : t));
  }

  async function loadSummary() {
    if (summary) return;
    try {
      const { data } = await api.get(`/api/messages/threads/${active.id}/summary`);
      setSummary(data.summary || '');
    } catch(e) { console.error(e); }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
        <h1 className="text-xl font-bold text-gray-900">Inbox</h1>
        <div className="flex gap-2 mt-2 flex-wrap">
          {[['pending','Pending'],['triaged','Triaged'],['','All Open']].map(([v,l]) => (
            <button key={v} onClick={() => setFilterTriage(v)} className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filterTriage === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}>{l}</button>
          ))}
          <select value={filterUrgency} onChange={e => setFilterUrgency(e.target.value)} className="border border-gray-200 rounded-full px-3 py-1 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-400">
            <option value="">All urgency</option>
            <option value="emergency">Emergency</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Thread list */}
        <div className="w-80 shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
          {loadingT ? (
            <div className="flex items-center justify-center h-32"><div className="animate-spin w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent" /></div>
          ) : threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center px-6">
              <div className="mb-2 text-emerald-400"><CheckCircle2 size={28} strokeWidth={1.5} /></div>
              <p className="text-sm font-medium text-gray-600">Inbox clear</p>
            </div>
          ) : threads.map(t => (
            <ThreadRow key={t.id} t={t} active={active?.id === t.id} onClick={() => openThread(t)} />
          ))}
        </div>

        {/* Message pane */}
        <div className="flex-1 flex flex-col bg-gray-50 min-w-0">
          {!active ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="mb-3 text-slate-300"><MessageSquare size={36} strokeWidth={1.5} /></div>
              <p className="text-base font-semibold text-gray-700">Select a conversation</p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="px-6 py-3 bg-white border-b border-gray-200 shrink-0">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-gray-900 truncate">{active.subject || '(no subject)'}</h2>
                    <p className="text-xs text-gray-400">{active.tenant_name} · {active.property_name} Unit {active.unit_number}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select value={urgency} onChange={e => handleUrgencyChange(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="emergency">Emergency</option>
                    </select>
                    <button onClick={loadSummary} className="text-xs px-3 py-1 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">AI Summary</button>
                    <button onClick={handleClose} className="text-xs px-3 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors">Close</button>
                  </div>
                </div>
                {summary && (
                  <div className="mt-2 p-2 bg-blue-50 rounded-lg text-xs text-blue-800">
                    <strong>AI Summary:</strong> {summary}
                  </div>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {loadingM ? (
                  <div className="flex items-center justify-center h-32"><div className="animate-spin w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent" /></div>
                ) : messages.map(m => <MsgBubble key={m.id} msg={m} />)}
                <div ref={bottomRef} />
              </div>

              {/* Reply */}
              <div className="shrink-0 bg-white border-t border-gray-200 px-4 py-3">
                <div className="flex items-center gap-3 mb-2">
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                    <input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} className="rounded" />
                    Internal note
                  </label>
                </div>
                <form onSubmit={handleReply} className="flex items-end gap-3">
                  <textarea value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => { if (e.key==='Enter' && (e.metaKey||e.ctrlKey)) handleReply(e); }} rows={2} placeholder={internal ? 'Add an internal note…' : 'Reply to tenant… (Cmd+Enter to send)'} className={`flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 resize-none ${internal ? 'border-yellow-300 bg-yellow-50 focus:ring-yellow-400' : 'border-gray-300 focus:ring-indigo-400'}`} />
                  <button type="submit" disabled={sending || !reply.trim()} className="shrink-0 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors">{sending ? '…' : 'Send'}</button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
