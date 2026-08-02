/**
 * PlaidOAuthReturn.jsx
 * Resumes Plaid Link after OAuth institution redirect (oauth_state_id in query).
 *
 * On Android/Samsung, the bank SMS step often returns via a Custom Tab that may:
 *  - land here while the auth cookie is cold (bounce through /login), or
 *  - drop sessionStorage. We stash the full redirect URL + Link session in
 *    localStorage so resume still works.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '@/api/axios';
import { useAuth } from '@/context/AuthContext';
import { ROLE_HOME } from '@/utils/roles';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import {
  usePlaidLink,
  readPlaidOAuthSession,
  clearPlaidOAuthSession,
  savePlaidOAuthReturnUrl,
  readPlaidOAuthReturnUrl,
} from '@/hooks/usePlaidLink';

function resolveReceivedRedirectUri(location) {
  const current = `${window.location.origin}${location.pathname}${location.search}${location.hash}`;
  if (current.includes('oauth_state_id=')) {
    savePlaidOAuthReturnUrl(current);
    return current;
  }
  const stashed = readPlaidOAuthReturnUrl();
  if (stashed && stashed.includes('oauth_state_id=')) return stashed;
  return undefined;
}

export default function PlaidOAuthReturn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [exchangeError, setExchangeError] = useState('');
  const [done, setDone] = useState(false);

  // Capture redirect URL immediately — before any later navigation strips the query.
  useEffect(() => {
    const href = `${window.location.origin}${location.pathname}${location.search}${location.hash}`;
    if (href.includes('oauth_state_id=')) {
      savePlaidOAuthReturnUrl(href);
    }
  }, [location.pathname, location.search, location.hash]);

  const receivedRedirectUri = useMemo(
    () => resolveReceivedRedirectUri(location),
    [location.pathname, location.search, location.hash],
  );

  const oauthStateId = useMemo(() => {
    const fromLocation = new URLSearchParams(location.search).get('oauth_state_id');
    if (fromLocation) return fromLocation;
    if (!receivedRedirectUri) return null;
    try {
      return new URL(receivedRedirectUri).searchParams.get('oauth_state_id');
    } catch {
      return null;
    }
  }, [location.search, receivedRedirectUri]);

  const session = useMemo(() => readPlaidOAuthSession(), []);

  const returnTo = session?.returnTo || (user?.role ? ROLE_HOME[user.role] : '/');

  const setupError = useMemo(() => {
    if (!oauthStateId) {
      return 'Missing OAuth state from your bank. Start bank linking again from Payments — and stay in the same browser (not a different Samsung tab).';
    }
    if (!session?.linkToken || !session?.linkTokenPath || !session?.exchangePath) {
      return 'Bank linking session expired after the SMS/code step. Go back to Payments and tap Connect bank again in this same browser.';
    }
    return null;
  }, [oauthStateId, session]);

  const handlePlaidSuccess = useCallback(async (publicToken, metadata) => {
    const accountId = metadata.accounts[0]?.id;
    if (!accountId) {
      setExchangeError('No bank account was selected. Try linking again.');
      return;
    }

    setExchangeError('');
    try {
      const body = { publicToken, accountId };
      if (session.bankAccountId) {
        body.bankAccountId = session.bankAccountId;
      }
      await api.post(session.exchangePath, body);
      clearPlaidOAuthSession();
      setDone(true);
      navigate(returnTo, { replace: true });
    } catch (err) {
      setExchangeError(apiErrorMessage(err, 'Failed to link bank account after OAuth.'));
    }
  }, [session, navigate, returnTo]);

  const { ready, loading, error: linkError } = usePlaidLink({
    onSuccess: handlePlaidSuccess,
    enabled: !setupError && !done,
    linkTokenPath: session?.linkTokenPath ?? '/api/payments/plaid/link-token',
    exchangePath: session?.exchangePath,
    returnTo: session?.returnTo,
    initialLinkToken: session?.linkToken ?? null,
    receivedRedirectUri: oauthStateId ? receivedRedirectUri : undefined,
    autoOpen: !!oauthStateId && !!session?.linkToken,
  });

  const displayError = setupError || linkError || exchangeError;

  return (
    <div className="login-mesh flex min-h-screen flex-col items-center justify-center px-4 text-white">
      <div className="w-full max-w-md rounded-2xl bg-white/10 p-8 text-center ring-1 ring-white/20 backdrop-blur-sm">
        <p className="text-lg font-semibold">Finishing bank connection</p>
        {displayError ? (
          <>
            <p className="mt-3 text-sm text-red-200">{displayError}</p>
            <p className="mt-2 text-xs text-white/70">
              On Android/Samsung: use Chrome (not a private tab), start Connect bank,
              complete the SMS code, and return to the same browser window.
            </p>
            <button
              type="button"
              onClick={() => navigate(returnTo, { replace: true })}
              className="mt-5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              Back to portal
            </button>
          </>
        ) : (
          <p className="mt-3 text-sm text-white/80">
            {loading || !ready
              ? 'Reconnecting to Plaid…'
              : 'Complete the steps in the Plaid window to link your account.'}
          </p>
        )}
      </div>
    </div>
  );
}
