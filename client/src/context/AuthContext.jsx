/**
 * AuthContext.jsx
 * Global authentication state for the entire app.
 *
 * Provides:
 *   user        — { id, email, role, firstName, lastName } | null
 *   status      — 'loading' | 'authenticated' | 'unauthenticated'
 *   login()     — POST /auth/login, stores access token, sets user
 *   logout()    — POST /auth/logout, clears everything
 *   startImpersonation(tenantUserId) — staff tenant portal preview
 *   exitImpersonation() — restore owner session
 *
 * On mount, AuthProvider performs a silent refresh to restore a session
 * from the HttpOnly cookie without requiring the user to re-enter credentials.
 */

import React, {
  createContext, useContext, useEffect, useReducer, useCallback, useState,
} from 'react';
import axios from 'axios';
import { setAccessToken, clearAccessToken, getAccessToken } from '@/api/axios';
import api from '@/api/axios';
import {
  readImpersonation, writeImpersonation, clearImpersonation,
} from '@/utils/impersonation';
import { DEV_AUTO_LOGIN, DEV_LOGIN_EMAIL, DEV_LOGIN_PASSWORD } from '@/utils/devAuth';

// ── State shape & reducer ─────────────────────────────────────────────────────
function toAuthUser(raw) {
  if (!raw) return null;
  return {
    id:        raw.id,
    email:     raw.email,
    role:      raw.role,
    firstName: raw.first_name ?? raw.firstName ?? '',
    lastName:  raw.last_name ?? raw.lastName ?? '',
    isPrimaryOwner: raw.is_primary_owner ?? raw.isPrimaryOwner ?? false,
  };
}

const initialState = { user: null, status: 'loading' };

function authReducer(state, action) {
  switch (action.type) {
    case 'AUTHENTICATED':
      return { user: action.payload, status: 'authenticated' };
    case 'UNAUTHENTICATED':
      return { user: null, status: 'unauthenticated' };
    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const [impersonation, setImpersonation] = useState(() => readImpersonation());

  const applyImpersonationSession = useCallback((saved) => {
    setAccessToken(saved.tenantToken);
    setImpersonation(saved);
    dispatch({ type: 'AUTHENTICATED', payload: saved.tenantUser });
  }, []);

  // ── Silent restore on first load ────────────────────────────────────────────
  useEffect(() => {
    async function restoreSession() {
      const saved = readImpersonation();
      if (saved?.tenantToken) {
        try {
          setAccessToken(saved.tenantToken);
          const { data: meData } = await api.get('/auth/me');
          applyImpersonationSession({
            ...saved,
            tenantUser: toAuthUser(meData.user),
          });
          return;
        } catch {
          clearImpersonation();
          setImpersonation(null);
        }
      }

      try {
        const { data } = await axios.post(
          '/auth/refresh',
          {},
          { withCredentials: true }
        );
        setAccessToken(data.accessToken);

        const { data: meData } = await api.get('/auth/me');
        dispatch({ type: 'AUTHENTICATED', payload: toAuthUser(meData.user) });
      } catch {
        if (DEV_AUTO_LOGIN) {
          try {
            const { data } = await axios.post(
              '/auth/login',
              { email: DEV_LOGIN_EMAIL, password: DEV_LOGIN_PASSWORD },
              { withCredentials: true }
            );
            setAccessToken(data.accessToken);
            dispatch({ type: 'AUTHENTICATED', payload: toAuthUser(data.user) });
            return;
          } catch (err) {
            console.warn(
              '[dev auto-login] failed — check VITE_DEV_LOGIN_* in .env.local or run npm run qa:bootstrap -- --apply',
              err.response?.data?.message || err.message
            );
          }
        }
        dispatch({ type: 'UNAUTHENTICATED' });
      }
    }

    restoreSession();
  }, [applyImpersonationSession]);

  // ── Listen for forced logout / impersonation exit ───────────────────────────
  useEffect(() => {
    function handleForcedLogout() {
      clearImpersonation();
      setImpersonation(null);
      clearAccessToken();
      dispatch({ type: 'UNAUTHENTICATED' });
    }

    async function handleExitImpersonation() {
      const saved = readImpersonation();
      if (!saved) return;
      clearImpersonation();
      setImpersonation(null);
      try {
        const { data } = await axios.post('/auth/refresh', {}, { withCredentials: true });
        setAccessToken(data.accessToken);
        const { data: meData } = await api.get('/auth/me');
        dispatch({ type: 'AUTHENTICATED', payload: toAuthUser(meData.user) });
      } catch {
        clearAccessToken();
        dispatch({ type: 'UNAUTHENTICATED' });
      }
    }

    window.addEventListener('auth:logout', handleForcedLogout);
    window.addEventListener('auth:exit-impersonation', handleExitImpersonation);
    return () => {
      window.removeEventListener('auth:logout', handleForcedLogout);
      window.removeEventListener('auth:exit-impersonation', handleExitImpersonation);
    };
  }, []);

  // ── login ────────────────────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    clearImpersonation();
    setImpersonation(null);
    const { data } = await axios.post(
      '/auth/login',
      { email, password },
      { withCredentials: true }
    );
    setAccessToken(data.accessToken);
    dispatch({ type: 'AUTHENTICATED', payload: data.user });
    return data.user;
  }, []);

  const refreshUser = useCallback(async () => {
    const { data } = await api.get('/auth/me');
    dispatch({ type: 'AUTHENTICATED', payload: toAuthUser(data.user) });
    return data.user;
  }, []);

  // ── logout ───────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await axios.post('/auth/logout', {}, { withCredentials: true });
    } catch {
      // Best-effort
    }
    clearImpersonation();
    setImpersonation(null);
    clearAccessToken();
    dispatch({ type: 'UNAUTHENTICATED' });
  }, []);

  // ── impersonation (owner → tenant portal preview) ───────────────────────────
  const startImpersonation = useCallback(async (tenantUserId, returnPath = '/manager/tenants') => {
    const ownerToken = getAccessToken();
    if (!ownerToken || !state.user) {
      throw new Error('Must be logged in as staff to preview tenant portal.');
    }

    const { data } = await api.post(`/api/users/${tenantUserId}/impersonate`);

    const saved = {
      ownerUser:   state.user,
      ownerToken,
      tenantUser:  data.user,
      tenantToken: data.accessToken,
      returnPath,
    };
    writeImpersonation(saved);
    applyImpersonationSession(saved);
    return data.user;
  }, [state.user, applyImpersonationSession]);

  const exitImpersonation = useCallback(async () => {
    const saved = readImpersonation();
    const returnPath = saved?.returnPath ?? '/manager/tenants';
    clearImpersonation();
    setImpersonation(null);

    try {
      const { data } = await axios.post('/auth/refresh', {}, { withCredentials: true });
      setAccessToken(data.accessToken);
      const { data: meData } = await api.get('/auth/me');
      dispatch({ type: 'AUTHENTICATED', payload: toAuthUser(meData.user) });
    } catch {
      if (saved?.ownerToken) {
        setAccessToken(saved.ownerToken);
        dispatch({ type: 'AUTHENTICATED', payload: saved.ownerUser });
      } else {
        clearAccessToken();
        dispatch({ type: 'UNAUTHENTICATED' });
      }
    }

    return returnPath;
  }, []);

  return (
    <AuthContext.Provider value={{
      ...state,
      impersonation,
      login,
      logout,
      refreshUser,
      startImpersonation,
      exitImpersonation,
    }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
