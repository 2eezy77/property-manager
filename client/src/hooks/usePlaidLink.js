/**
 * usePlaidLink.js
 * Fetches a Plaid Link token, initialises react-plaid-link, and persists OAuth
 * session state so /oauth-return can resume OAuth institutions (Chase, BoA, etc.).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePlaidLink as usePlaidLinkSDK } from 'react-plaid-link';
import api from '@/api/axios';

export const PLAID_OAUTH_SESSION_KEY = 'plaid_oauth_session';
const PLAID_OAUTH_LOCAL_KEY = 'plaid_oauth_session_backup';

function defaultExchangePath(linkTokenPath) {
  if (linkTokenPath.endsWith('/link-token')) {
    return linkTokenPath.replace(/\/link-token$/, '/exchange');
  }
  return '/api/payments/plaid/exchange';
}

export function savePlaidOAuthSession(session) {
  const json = JSON.stringify(session);
  try {
    sessionStorage.setItem(PLAID_OAUTH_SESSION_KEY, json);
  } catch { /* ignore quota / private mode */ }
  // Mobile OAuth redirects can drop sessionStorage; localStorage survives the round-trip.
  try {
    localStorage.setItem(PLAID_OAUTH_LOCAL_KEY, json);
  } catch { /* ignore */ }
}

export function readPlaidOAuthSession() {
  for (const key of [PLAID_OAUTH_SESSION_KEY, PLAID_OAUTH_LOCAL_KEY]) {
    try {
      const store = key === PLAID_OAUTH_LOCAL_KEY ? localStorage : sessionStorage;
      const raw = store.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch { /* try next */ }
  }
  return null;
}

export function clearPlaidOAuthSession() {
  try {
    sessionStorage.removeItem(PLAID_OAUTH_SESSION_KEY);
  } catch { /* ignore */ }
  try {
    localStorage.removeItem(PLAID_OAUTH_LOCAL_KEY);
  } catch { /* ignore */ }
}

function plaidFetchErrorMessage(err) {
  const serverMsg = err.response?.data?.message;
  if (typeof serverMsg === 'string' && serverMsg.length > 0) return serverMsg;
  if (!err.response) {
    return 'Unable to reach the server. Check your connection and try again.';
  }
  return 'Could not initialise bank connection. OAuth banks (Chase, Bank of America, Navy Federal) need PLAID_REDIRECT_URI configured on the server.';
}

/**
 * @param {{
 *   onSuccess: (publicToken: string, metadata: object) => void,
 *   enabled?: boolean,
 *   linkTokenPath?: string,
 *   linkTokenBody?: object,
 *   exchangePath?: string,
 *   returnTo?: string,
 *   receivedRedirectUri?: string,
 *   initialLinkToken?: string | null,
 *   autoOpen?: boolean,
 * }} options
 */
export function usePlaidLink({
  onSuccess,
  enabled = true,
  linkTokenPath = '/api/payments/plaid/link-token',
  linkTokenBody = null,
  exchangePath,
  returnTo,
  receivedRedirectUri,
  initialLinkToken = null,
  autoOpen = false,
}) {
  const resolvedExchangePath = exchangePath ?? defaultExchangePath(linkTokenPath);
  const [linkToken, setLinkToken] = useState(initialLinkToken);
  const [loading, setLoading] = useState(!initialLinkToken);
  const [fetchError, setFetchError] = useState(null);
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    if (initialLinkToken) {
      setLinkToken(initialLinkToken);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;

    async function fetchLinkToken() {
      setLoading(true);
      setFetchError(null);
      try {
        const { data } = await api.post(linkTokenPath, linkTokenBody || undefined);
        if (!cancelled) setLinkToken(data.linkToken);
      } catch (err) {
        if (!cancelled) setFetchError(plaidFetchErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchLinkToken();
    return () => { cancelled = true; };
  }, [enabled, linkTokenPath, initialLinkToken, linkTokenBody]);

  const handleSuccess = useCallback(onSuccess, [onSuccess]);

  const config = {
    token: linkToken,
    onSuccess: handleSuccess,
    onExit: (err) => {
      if (err) console.warn('[Plaid Link] exited with error:', err);
    },
    ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
  };

  const { open: openSDK, ready } = usePlaidLinkSDK(config);

  const open = useCallback(() => {
    if (!linkToken) return;
    savePlaidOAuthSession({
      linkToken,
      linkTokenPath,
      exchangePath: resolvedExchangePath,
      returnTo: returnTo ?? window.location.pathname,
    });
    openSDK();
  }, [linkToken, linkTokenPath, resolvedExchangePath, returnTo, openSDK]);

  const sdkReady = ready && !loading && !!linkToken;

  useEffect(() => {
    if (autoOpen && sdkReady && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      openSDK();
    }
  }, [autoOpen, sdkReady, openSDK]);

  return {
    open,
    ready: sdkReady,
    loading,
    error: fetchError,
  };
}
