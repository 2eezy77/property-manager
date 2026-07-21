/**
 * PlaidOAuthReturn.jsx
 * Resumes Plaid Link after OAuth institution redirect (oauth_state_id in query).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '@/api/axios';
import { useAuth } from '@/context/AuthContext';
import { ROLE_HOME } from '@/utils/roles';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import {
  usePlaidLink,
  readPlaidOAuthSession,
  clearPlaidOAuthSession,
} from '@/hooks/usePlaidLink';

export default function PlaidOAuthReturn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [exchangeError, setExchangeError] = useState('');
  const [done, setDone] = useState(false);

  const oauthStateId = useMemo(
    () => new URLSearchParams(location.search).get('oauth_state_id'),
    [location.search],
  );

  const session = useMemo(() => readPlaidOAuthSession(), []);

  const returnTo = session?.returnTo || (user?.role ? ROLE_HOME[user.role] : '/');

  const setupError = useMemo(() => {
    if (!oauthStateId) {
      return 'Missing OAuth state from your bank. Start bank linking again from your account page.';
    }
    if (!session?.linkTokenPath || !session?.exchangePath) {
      return 'Bank linking session expired. Go back and tap Connect bank again.';
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
      await api.post(session.exchangePath, { publicToken, accountId });
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
    receivedRedirectUri: oauthStateId ? window.location.href : undefined,
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
