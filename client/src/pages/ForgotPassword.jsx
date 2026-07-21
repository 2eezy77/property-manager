/**
 * ForgotPassword.jsx — request a password reset email.
 */
import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import api from '@/api/axios';
import AuthPageShell from '@/components/AuthPageShell';

const REMEMBER_EMAIL_KEY = 'mr_last_login_email';

export default function ForgotPassword() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const fromUrl = searchParams.get('email');
    if (fromUrl) {
      setEmail(fromUrl);
      return;
    }
    try {
      const saved = localStorage.getItem(REMEMBER_EMAIL_KEY);
      if (saved) setEmail(saved);
    } catch { /* ignore */ }
  }, [searchParams]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      try {
        localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim().toLowerCase());
      } catch { /* ignore */ }
      setSent(true);
    } catch (err) {
      const msg = err.response?.data?.message;
      setError(msg ?? 'Something went wrong. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthPageShell
        title="Check your email"
        subtitle="If that address is on file, we sent a reset link (expires in 1 hour)."
      >
        <p className="text-sm text-slate-600">
          Look for a message from Montero Rentals at <strong>{email}</strong>.
          Check spam if you do not see it within a few minutes.
        </p>
        <Link
          to={`/login?email=${encodeURIComponent(email)}`}
          className="btn-motion mt-6 flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700"
        >
          Back to sign in
        </Link>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell
      title="Forgot password?"
      subtitle="Enter your email and we will send a link to choose a new password."
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="you@example.com"
          />
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-500" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-motion flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 disabled:opacity-60"
        >
          {loading && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          )}
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </AuthPageShell>
  );
}
