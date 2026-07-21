/**
 * axios.js
 * Configured Axios instance for all API calls.
 *
 * Features:
 *  1. Automatically attaches the in-memory access token as a Bearer header.
 *  2. On a 401 response, silently attempts one token refresh via POST /auth/refresh.
 *  3. Queues concurrent requests that arrive during an active refresh and replays
 *     them all once the new access token is available — no request is dropped.
 *  4. If the refresh itself fails (session expired), broadcasts an 'auth:logout'
 *     window event so AuthContext can clear state and redirect to login.
 *
 * Token storage:
 *  - Access token: module-level variable (in-memory, never localStorage).
 *  - Refresh token: HttpOnly cookie managed entirely by the browser/server.
 */

import axios from 'axios';
import { isImpersonating } from '@/utils/impersonation';
import { apiErrorMessage } from '@/utils/apiErrorMessage';

// ── In-memory access token store ─────────────────────────────────────────────
// Not exported directly — use setAccessToken() / getAccessToken().
let _accessToken = null;

export function setAccessToken(token) { _accessToken = token; }
export function getAccessToken()      { return _accessToken;  }
export function clearAccessToken()    { _accessToken = null;  }

// ── Axios instance ────────────────────────────────────────────────────────────
// NOTE: baseURL is intentionally empty. Every caller writes the full path
// (e.g. '/api/leases/my' or '/auth/me') because the Vite dev server proxies
// both '/api' and '/auth' to the Express server. Combined with a non-empty
// baseURL this leads to '/api/api/...' double-prefixing — leave this empty.
const api = axios.create({
  baseURL:         '',
  withCredentials: true,   // send the HttpOnly refresh-token cookie on every request
  headers:         { 'Content-Type': 'application/json' },
});

// ── Request interceptor — attach Bearer token ─────────────────────────────────
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Response interceptor — silent refresh on 401 ─────────────────────────────
let isRefreshing    = false;
let refreshQueue    = [];   // { resolve, reject }[] — requests waiting for new token

function processQueue(error, token = null) {
  refreshQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token)
  );
  refreshQueue = [];
}

function shouldSkipGlobalError(config) {
  return config?.skipGlobalError === true;
}

function emitToast(message, variant = 'error') {
  window.dispatchEvent(new CustomEvent('api:toast', { detail: { message, variant } }));
}

function handleGlobalApiError(error) {
  const config = error.config;
  if (!config || shouldSkipGlobalError(config)) return;

  const status = error.response?.status;
  const url = config.url ?? '';

  if (status === 403) {
    const msg = apiErrorMessage(error, 'You do not have permission to perform this action.');
    const method = (config.method ?? 'get').toLowerCase();
    if (method === 'get') {
      window.dispatchEvent(new CustomEvent('api:forbidden', { detail: { message: msg } }));
    } else {
      emitToast(msg);
    }
    return;
  }

  if (status === 429) {
    emitToast(apiErrorMessage(error));
    return;
  }

  if (!error.response) {
    emitToast(apiErrorMessage(error));
    return;
  }

  if (status >= 500) {
    emitToast(apiErrorMessage(error));
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    // Only attempt refresh once per request (_retry flag prevents loops)
    if (error.response?.status !== 401 || original._retry) {
      handleGlobalApiError(error);
      return Promise.reject(error);
    }

    // Don't try to refresh if the failing request IS the refresh endpoint
    if (original.url?.includes('/auth/refresh')) {
      window.dispatchEvent(new CustomEvent('api:session-expired', {
        detail: { message: 'Your session expired. Please sign in again.' },
      }));
      window.dispatchEvent(new Event('auth:logout'));
      return Promise.reject(error);
    }

    // During impersonation the refresh cookie is still the owner's — don't swap mid-preview
    if (isImpersonating()) {
      window.dispatchEvent(new Event('auth:exit-impersonation'));
      return Promise.reject(error);
    }

    original._retry = true;

    if (isRefreshing) {
      // Another refresh is in flight — queue this request until it resolves
      return new Promise((resolve, reject) => {
        refreshQueue.push({ resolve, reject });
      }).then((newToken) => {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      });
    }

    isRefreshing = true;

    try {
      // Call the refresh endpoint (refresh token sent automatically via cookie)
      const { data } = await axios.post(
        '/auth/refresh',
        {},
        { withCredentials: true }
      );

      const newToken = data.accessToken;
      setAccessToken(newToken);
      processQueue(null, newToken);

      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    } catch (refreshError) {
      processQueue(refreshError, null);
      clearAccessToken();
      window.dispatchEvent(new CustomEvent('api:session-expired', {
        detail: { message: 'Your session expired. Please sign in again.' },
      }));
      window.dispatchEvent(new Event('auth:logout'));
      handleGlobalApiError(refreshError);
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export default api;
