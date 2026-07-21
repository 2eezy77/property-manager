import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare } from 'lucide-react';
import api from '@/api/axios';

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const URGENCY_BADGE = {
  emergency: 'bg-red-100 text-red-700',
  high:      'bg-orange-100 text-orange-700',
  medium:    'bg-yellow-100 text-yellow-700',
  low:       'bg-gray-100 text-gray-500',
};

const CATEGORY_LABEL = {
  maintenance:   'Maintenance',
  billing:       'Billing',
  lease:         'Lease',
  noise:         'Noise',
  package:       'Package',
  general:       'General',
};

// ─── sub-components ──────────────────────────────────────────────────────────

function ThreadRow({ thread, active, onClick }) {
  const unread = Number(thread.unread_count) > 0;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${active ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`text-sm truncate flex-1 ${unread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
          {thread.subject || '(no subject)'}
        </span>
        <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">{fmt(thread.updated_at)}</span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-xs text-gray-500 truncate flex-1">
          {thread.last_message || 'No messages yet'}
        </span>
        {unread && (
          <span className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-500 text-white text-[10px] font-bold">
            {thread.unread_count}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        {thread.category && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
            {CATEGORY_LABEL[thread.category] || thread.category}
          </span>
        )}
        {thread.urgency && thread.urgency !== 'low' && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${URGENCY_BADGE[thread.urgency]}`}>
            {thread.urgency}
          </span>
        )}
        {!thread.is_open && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-500">closed</span>
        )}
      </div>
    </button>
  );
}

function MessageBubble({ msg }) {
  const isOutbound = msg.direction === 'outbound';
  return (
    <div className={`flex ${isOutbound ? 'justify-start' : 'justify-end'} mb-3`}>
      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
        isOutbound
          ? 'bg-white border border-gray-200 text-gray-800'
          : 'bg-indigo-600 text-white'
      }`}>
        {isOutbound && (
          <p className="text-[10px] font-semibold text-indigo-500 mb-1 uppercase tracking-wide">
            {msg.is_ai_generated ? 'Auto-Reply' : 'Property Manager'}
          </p>
        )}
        <p className="whitespace-pre-wrap">{msg.body}</p>
        <p className={`text-[10px] mt-1 text-right ${isOutbound ? 'text-gray-400' : 'text-indigo-200'}`}>
          {fmt(msg.created_at)}
          {msg.read_at && !isOutbound && (
            <span className="ml-1 text-indigo-200">· Read</span>
          )}
        </p>
      </div>
    </div>
  );
}

function NewThreadModal({ onClose, onCreate }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const { data } = await api.post('/api/messages/threads', { subject: subject.trim(), body: body.trim() });
      onCreate(data.thread);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send message');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">New Message</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Maintenance request – leaking faucet"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message <span className="text-red-500">*</span></label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={5}
              placeholder="Describe your issue or question…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !body.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Send Message'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const [threads, setThreads]         = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [messages, setMessages]       = useState([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyBody, setReplyBody]     = useState('');
  const [sending, setSending]         = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [threadError, setThreadError] = useState('');
  const bottomRef = useRef(null);

  // Load thread list
  const loadThreads = useCallback(async () => {
    try {
      const { data } = await api.get('/api/messages/threads');
      setThreads(data.threads || []);
    } catch (err) {
      console.error('[messages] load threads', err);
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  // Load a thread's messages
  async function openThread(thread) {
    setActiveThread(thread);
    setMessages([]);
    setLoadingMessages(true);
    setThreadError('');
    try {
      const { data } = await api.get(`/api/messages/threads/${thread.id}`);
      setMessages(data.messages || []);
      // Update unread count locally
      setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, unread_count: 0 } : t));
    } catch (err) {
      setThreadError('Could not load messages.');
    } finally {
      setLoadingMessages(false);
    }
  }

  // Scroll to bottom when messages load
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Send a reply
  async function handleReply(e) {
    e.preventDefault();
    if (!replyBody.trim() || !activeThread) return;
    setSending(true);
    try {
      await api.post(`/api/messages/threads/${activeThread.id}`, { body: replyBody.trim() });
      setReplyBody('');
      // Reload messages
      const { data } = await api.get(`/api/messages/threads/${activeThread.id}`);
      setMessages(data.messages || []);
      // Update thread list
      setThreads(prev => prev.map(t =>
        t.id === activeThread.id
          ? { ...t, last_message: replyBody.trim(), updated_at: new Date().toISOString() }
          : t
      ));
    } catch (err) {
      console.error('[messages] reply', err);
    } finally {
      setSending(false);
    }
  }

  function handleNewThread(thread) {
    setShowCompose(false);
    setThreads(prev => [thread, ...prev]);
    openThread(thread);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">

      {/* Page header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Messages</h1>
          <p className="text-sm text-gray-500">Communicate with your property manager</p>
        </div>
        <button
          onClick={() => setShowCompose(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Message
        </button>
      </div>

      {/* Body: 2-column layout */}
      <div className="flex flex-1 min-h-0">

        {/* Thread list */}
        <div className="w-80 shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {threads.length} conversation{threads.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingThreads ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent" />
              </div>
            ) : threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center px-6">
                <MessageSquare size={28} strokeWidth={1.5} className="mb-2 text-slate-300" />
                <p className="text-sm font-medium text-gray-600">No messages yet</p>
                <p className="text-xs text-gray-400 mt-1">Start a conversation with your manager</p>
              </div>
            ) : (
              threads.map(t => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  active={activeThread?.id === t.id}
                  onClick={() => openThread(t)}
                />
              ))
            )}
          </div>
        </div>

        {/* Message pane */}
        <div className="flex-1 flex flex-col bg-gray-50 min-w-0">
          {!activeThread ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-700">Select a conversation</h3>
              <p className="text-sm text-gray-500 mt-1">Choose a thread on the left, or start a new message.</p>
              <button
                onClick={() => setShowCompose(true)}
                className="mt-4 px-4 py-2 text-sm font-medium text-indigo-600 border border-indigo-300 rounded-lg hover:bg-indigo-50 transition-colors"
              >
                + New Message
              </button>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="px-6 py-3 bg-white border-b border-gray-200 shrink-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-gray-900 truncate">{activeThread.subject || '(no subject)'}</h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      {activeThread.category && (
                        <span className="text-xs text-gray-400">{CATEGORY_LABEL[activeThread.category] || activeThread.category}</span>
                      )}
                      {activeThread.urgency && activeThread.urgency !== 'low' && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${URGENCY_BADGE[activeThread.urgency]}`}>
                          {activeThread.urgency}
                        </span>
                      )}
                      {!activeThread.is_open && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-500">closed</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {loadingMessages ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="animate-spin w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent" />
                  </div>
                ) : threadError ? (
                  <div className="text-center py-10 text-sm text-red-500">{threadError}</div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-10 text-sm text-gray-400">No messages in this thread yet.</div>
                ) : (
                  messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)
                )}
                <div ref={bottomRef} />
              </div>

              {/* Reply box */}
              {activeThread.is_open !== false ? (
                <div className="shrink-0 bg-white border-t border-gray-200 px-4 py-3">
                  <form onSubmit={handleReply} className="flex items-end gap-3">
                    <textarea
                      value={replyBody}
                      onChange={e => setReplyBody(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleReply(e);
                      }}
                      rows={2}
                      placeholder="Type a reply… (Cmd+Enter to send)"
                      className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                    />
                    <button
                      type="submit"
                      disabled={sending || !replyBody.trim()}
                      className="shrink-0 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                    >
                      {sending ? '…' : 'Send'}
                    </button>
                  </form>
                </div>
              ) : (
                <div className="shrink-0 bg-gray-50 border-t border-gray-200 px-4 py-3 text-center text-sm text-gray-400">
                  This conversation is closed.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Compose modal */}
      {showCompose && (
        <NewThreadModal onClose={() => setShowCompose(false)} onCreate={handleNewThread} />
      )}
    </div>
  );
}
