/**
 * Login.jsx — Montero Rentals sign-in (roles revealed after login).
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Check, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ROLE_HOME } from '@/utils/roles';
import PortalReveal from '@/components/PortalReveal';
import AuthPageShell from '@/components/AuthPageShell';
import { DEV_AUTO_LOGIN, DEV_LOGIN_EMAIL, DEV_LOGIN_PASSWORD } from '@/utils/devAuth';
const REMEMBER_EMAIL_KEY = 'mr_last_login_email';

function FieldIcon({ children }) {
  return (
    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
      {children}
    </span>
  );
}

export default function Login() {
  const { login, status, user } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const [searchParams] = useSearchParams();

  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState('');
  const [loading,      setLoading]      = useState(false);
  const [revealedUser, setRevealedUser] = useState(null);
  const [destination,  setDestination]  = useState(null);
  // Set before await login() so the auth redirect effect cannot race PortalReveal
  const revealPendingRef = useRef(false);

  useEffect(() => {
    try {
      const flash = sessionStorage.getItem('auth_flash');
      if (flash) {
        setError(flash);
        sessionStorage.removeItem('auth_flash');
      }
      const ok = sessionStorage.getItem('auth_success');
      if (ok) {
        setSuccess(ok);
        sessionStorage.removeItem('auth_success');
      }
      const prefill = sessionStorage.getItem('auth_prefill_email');
      if (prefill) {
        setEmail(prefill);
        sessionStorage.removeItem('auth_prefill_email');
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (email) return;
    const fromUrl = searchParams.get('email');
    if (fromUrl) {
      setEmail(fromUrl);
      return;
    }
    try {
      const saved = localStorage.getItem(REMEMBER_EMAIL_KEY);
      if (saved) setEmail(saved);
    } catch { /* ignore */ }
  }, [searchParams, email]);

  const finishReveal = useCallback(() => {
    revealPendingRef.current = false;
    if (destination) navigate(destination, { replace: true });
  }, [destination, navigate]);

  // Bounce already-authenticated visitors (session restore / dev auto-login).
  // Skip while a form login is mid-reveal so PortalReveal can finish.
  useEffect(() => {
    if (status !== 'authenticated' || !user) return;
    if (revealPendingRef.current || revealedUser) return;
    const dest = location.state?.from?.pathname ?? ROLE_HOME[user.role] ?? '/';
    navigate(dest, { replace: true });
  }, [status, user, revealedUser, location.state, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    const trimmed = email.trim().toLowerCase();
    try {
      localStorage.setItem(REMEMBER_EMAIL_KEY, trimmed);
    } catch { /* ignore */ }
    revealPendingRef.current = true;
    try {
      const user = await login(trimmed, password);
      const dest = location.state?.from?.pathname ?? ROLE_HOME[user.role];
      setDestination(dest);
      setRevealedUser(user);
    } catch (err) {
      revealPendingRef.current = false;
      const status = err.response?.status;
      const msg = err.response?.data?.message;
      if (status === 429) {
        setError(msg ?? 'Too many sign-in attempts. Try again in 15 minutes.');
      } else {
        setError(msg ?? 'Login failed. Please check your credentials.');
      }
      setLoading(false);
    }
  }

  if (revealedUser) {
    return <PortalReveal user={revealedUser} onComplete={finishReveal} />;
  }

  const subtitle = (
    <>
      Sign in with your email and password.
      {DEV_AUTO_LOGIN && (
        <>
          {' '}
          <button
            type="button"
            onClick={() => {
              setEmail(DEV_LOGIN_EMAIL);
              setPassword(DEV_LOGIN_PASSWORD);
              setError('');
              setSuccess('');
            }}
            className="font-medium text-blue-600 hover:text-blue-800"
          >
            Fill dev login
          </button>
        </>
      )}
    </>
  );

  const footer = (
    <p className="mt-6 text-center text-xs text-slate-400">
      Need an account? Contact your property manager.
      {' · '}
            <Link to="/privacy" className="text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline">
              Privacy Policy
            </Link>
            {' · '}
            <Link to="/terms" className="text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline">
              Terms of Service
            </Link>
    </p>
  );

  const statusDescribedBy = [
    error ? 'login-error' : null,
    success ? 'login-success' : null,
  ].filter(Boolean).join(' ') || undefined;

  return (
    <AuthPageShell title="Welcome back" subtitle={subtitle} footer={footer}>
      <form
        onSubmit={handleSubmit}
        className="space-y-5"
        noValidate
        aria-labelledby="auth-title"
        aria-describedby={subtitle ? 'auth-subtitle' : undefined}
      >
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email address
          </label>
          <div className="relative mt-1.5">
            <FieldIcon>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </FieldIcon>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={statusDescribedBy}
              className="block w-full rounded-xl border border-slate-200 bg-slate-50/80 py-3 pl-10 pr-4 text-sm text-slate-900 transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="you@example.com"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <Link
              to={email ? `/forgot-password?email=${encodeURIComponent(email.trim())}` : '/forgot-password'}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative mt-1.5">
            <FieldIcon>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </FieldIcon>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={statusDescribedBy}
              className="block w-full rounded-xl border border-slate-200 bg-slate-50/80 py-3 pl-10 pr-11 text-sm text-slate-900 transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Your password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
            </button>
          </div>
        </div>

        {success && (
          <div
            id="login-success"
            role="status"
            aria-live="polite"
            className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3"
          >
            <Check size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
            <p className="text-sm text-emerald-800">{success}</p>
          </div>
        )}

        {error && (
          <div
            id="login-error"
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3"
          >
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-500" aria-hidden />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className="btn-motion flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 disabled:opacity-60"
        >
          {loading && (
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
              aria-hidden
            />
          )}
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthPageShell>
  );
}
