import React, { useState } from 'react';
import api from '@/api/axios';
import { apiErrorMessage } from '@/utils/apiErrorMessage';

export default function UserPasswordModal({ user, onClose, onSuccess }) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
  const [password, setPassword] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleGenerate() {
    setError('');
    try {
      const { data } = await api.get('/api/admin/users/password-generator');
      setPassword(data.password || '');
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not generate password.'));
    }
  }

  async function handleSubmit({ generate }) {
    if (!generate && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/api/admin/users/${user.id}/password`, {
        password: generate ? undefined : password,
        generate: !!generate,
        sendEmail,
      });
      if (sendEmail) {
        window.alert(`Password set and emailed to ${user.email}.`);
      } else {
        window.alert(`Password updated for ${name}.\n\nCopy now (shown once):\n${data.password}`);
      }
      onSuccess?.(data);
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, 'Failed to set password.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-bold text-slate-900">Set portal password</h3>
        <p className="mt-1 text-sm text-slate-500">{name} · {user.email}</p>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">
          New password
        </label>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 8 characters"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Generate
          </button>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
          />
          Email credentials to {user.email} (BCC you on send)
        </label>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex flex-wrap gap-2 justify-end">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => handleSubmit({ generate: false })}
            className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
          >
            Save only
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => handleSubmit({ generate: !password })}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {busy ? 'Working…' : sendEmail ? 'Save & email' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
