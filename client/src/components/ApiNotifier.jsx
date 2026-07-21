import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, X } from 'lucide-react';

/**
 * Listens for global API events dispatched from axios interceptors.
 */
export default function ApiNotifier() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let toastTimer;
    function onToast(e) {
      const { message, variant = 'error' } = e.detail ?? {};
      if (!message) return;
      setToast({ message, variant });
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => setToast(null), 6000);
    }

    function onForbidden(e) {
      const msg = e.detail?.message;
      const q = msg ? `?msg=${encodeURIComponent(msg)}` : '';
      navigate(`/forbidden${q}`, { replace: true });
    }

    function onSessionExpired(e) {
      const msg = e.detail?.message ?? 'Your session expired. Please sign in again.';
      try { sessionStorage.setItem('auth_flash', msg); } catch { /* ignore */ }
      navigate('/login', { replace: true });
    }

    const toastHandler = (e) => {
      onToast(e);
    };

    window.addEventListener('api:toast', toastHandler);
    window.addEventListener('api:forbidden', onForbidden);
    window.addEventListener('api:session-expired', onSessionExpired);
    return () => {
      clearTimeout(toastTimer);
      window.removeEventListener('api:toast', toastHandler);
      window.removeEventListener('api:forbidden', onForbidden);
      window.removeEventListener('api:session-expired', onSessionExpired);
    };
  }, [navigate]);

  if (!toast) return null;

  const styles =
    toast.variant === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-red-200 bg-red-50 text-red-800';

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center px-4 pt-4 safe-top"
      role="status"
      aria-live="polite"
    >
      <div className={`pointer-events-auto flex max-w-lg items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${styles}`}>
        <span className="mt-0.5 shrink-0" aria-hidden>
          {toast.variant === 'success'
            ? <CheckCircle2 size={18} strokeWidth={2} />
            : <XCircle size={18} strokeWidth={2} />}
        </span>
        <p className="flex-1 font-medium">{toast.message}</p>
        <button
          type="button"
          onClick={() => setToast(null)}
          className="shrink-0 rounded-lg px-1.5 py-0.5 opacity-70 hover:opacity-100"
          aria-label="Dismiss"
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
