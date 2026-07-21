/**
 * ResetPassword.jsx — set a new password from email link token.
 */
import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, AlertTriangle } from 'lucide-react';
import api from '@/api/axios';
import AuthPageShell from '@/components/AuthPageShell';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!token) {
    return (
      <AuthPageShell title="Invalid link" subtitle="This reset link is missing or incomplete.">
        <p className="text-sm text-slate-600">
          Request a new link from the sign-in page.
        </p>
        <Link
          to="/forgot-password"
          className="btn-motion mt-6 flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700"
        >
          Forgot password
        </Link>
      </AuthPageShell>
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/reset-password', {
        token,
        newPassword: password,
      });
      try {
        sessionStorage.setItem('auth_success', data.message ?? 'Password updated. Sign in with your new password.');
        if (data.email) {
          sessionStorage.setItem('auth_prefill_email', data.email);
        }
      } catch { /* ignore */ }
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message ?? 'Could not reset password. Request a new link.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPageShell title="Choose a new password" subtitle="Use at least 8 characters.">
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            New password
          </label>
          <div className="relative mt-1.5">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="block w-full rounded-xl border border-slate-200 bg-slate-50/80 py-3 pl-4 pr-11 text-sm text-slate-900 transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="At least 8 characters"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="confirm" className="block text-sm font-medium text-slate-700">
            Confirm password
          </label>
          <input
            id="confirm"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="Repeat password"
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
          {loading ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </AuthPageShell>
  );
}
