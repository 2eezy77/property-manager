import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, Landmark, Smartphone } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import api from '@/api/axios';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { usePlaidLink } from '@/hooks/usePlaidLink';
import CardPaymentForm from '@/components/payments/CardPaymentForm';

function fmtMoney(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function showToast(message, variant = 'error') {
  window.dispatchEvent(new CustomEvent('api:toast', { detail: { message, variant } }));
}

function AccountButton({ account, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(account)}
      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
        selected ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-100' : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
    >
      <p className="text-sm font-semibold text-slate-900">{account.institution_name || 'Bank account'}</p>
      <p className="text-xs text-slate-500">
        {account.account_name || account.account_type || 'Checking'} ending {account.account_mask || '----'} - {account.status}
      </p>
    </button>
  );
}

export default function FinishLeasePay({ lease, onPaid }) {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [connectingBank, setConnectingBank] = useState(false);
  const [message, setMessage] = useState(null);
  const [method, setMethod] = useState('card');
  const [includeFirstMonth, setIncludeFirstMonth] = useState(false);
  const [cardIntent, setCardIntent] = useState(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [achLoading, setAchLoading] = useState(false);
  const [cashAppLoading, setCashAppLoading] = useState(false);
  const [stripeConfig, setStripeConfig] = useState(null);
  const [autopayWanted, setAutopayWanted] = useState(false);
  const [autopaySaving, setAutopaySaving] = useState(false);
  const [autopayNote, setAutopayNote] = useState('');

  const verifiedAccounts = useMemo(
    () => accounts.filter((account) => account.status === 'verified' && account.link_status !== 'needs_relink'),
    [accounts]
  );

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const { data } = await api.get('/api/payments/bank-accounts');
      setAccounts(data.accounts || []);
    } catch (err) {
      setMessage({ success: false, text: apiErrorMessage(err, 'Could not load bank accounts.') });
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  useEffect(() => {
    let cancelled = false;
    async function loadStripeConfig() {
      try {
        const { data } = await api.get('/api/payments/stripe-config');
        if (!cancelled) setStripeConfig(data);
      } catch {
        if (!cancelled) setStripeConfig(null);
      }
    }
    loadStripeConfig();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedAccount && verifiedAccounts.length > 0) {
      const def = verifiedAccounts.find((account) => account.is_default) || verifiedAccounts[0];
      setSelectedAccount(def);
    }
  }, [verifiedAccounts, selectedAccount]);

  const handlePlaidSuccess = useCallback(async (publicToken, metadata) => {
    const accountId = metadata.accounts?.[0]?.id;
    if (!accountId) {
      setMessage({ success: false, text: 'No bank account was selected. Try linking again.' });
      return;
    }

    setConnectingBank(true);
    setMessage(null);
    try {
      await api.post('/api/payments/plaid/exchange', { publicToken, accountId });
      await loadAccounts();
      showToast('Bank account linked.', 'success');
    } catch (err) {
      setMessage({ success: false, text: apiErrorMessage(err, 'Failed to link bank account.') });
    } finally {
      setConnectingBank(false);
    }
  }, [loadAccounts]);

  const { open: openPlaid, ready: plaidReady, loading: plaidLoading, error: plaidError } = usePlaidLink({
    onSuccess: handlePlaidSuccess,
    returnTo: '/tenant/lease',
  });

  async function tryEnableAutopay(account = selectedAccount, force = false) {
    if ((!force && !autopayWanted) || !account) return;
    setAutopaySaving(true);
    setAutopayNote('');
    try {
      const { data } = await api.patch('/api/payments/autopay', {
        enabled: true,
        bankAccountId: account.id,
      });
      setAutopayNote(data.message || 'Autopay enabled.');
      showToast(data.message || 'Autopay enabled.', 'success');
    } catch (err) {
      const code = err.response?.data?.error;
      if (code === 'NO_ACTIVE_LEASE') {
        setAutopayNote('Autopay can be enabled after the deposit activates your lease. This does not block activation.');
      } else {
        setAutopayNote(apiErrorMessage(err, 'Could not enable autopay.'));
      }
    } finally {
      setAutopaySaving(false);
    }
  }

  async function startCardPayment() {
    setCardLoading(true);
    setMessage(null);
    setCardIntent(null);
    try {
      const { data } = await api.post('/api/payments/card/create-intent', {
        leaseId: lease.id,
        paymentType: 'security_deposit',
        includeFirstMonth,
      }, { skipGlobalError: true });
      setCardIntent(data);
    } catch (err) {
      setMessage({ success: false, text: apiErrorMessage(err, 'Could not start card payment.') });
    } finally {
      setCardLoading(false);
    }
  }

  async function payByAch() {
    if (!selectedAccount) {
      setMessage({ success: false, text: 'Connect and select a verified bank account first.' });
      return;
    }

    setAchLoading(true);
    setMessage(null);
    try {
      const { data } = await api.post('/api/payments/charge', {
        bankAccountId: selectedAccount.id,
        leaseId: lease.id,
        paymentType: 'security_deposit',
      }, { skipGlobalError: true });
      if (autopayWanted) await tryEnableAutopay(selectedAccount, true);
      setMessage({
        success: true,
        text: data.message || 'Security deposit submitted. ACH transfers settle in 4-5 business days.',
      });
      onPaid?.(data);
    } catch (err) {
      setMessage({ success: false, text: apiErrorMessage(err, 'Deposit payment failed. Please try again.') });
    } finally {
      setAchLoading(false);
    }
  }

  async function startCashAppPayment() {
    setCashAppLoading(true);
    setMessage(null);
    try {
      const { data } = await api.post('/api/payments/cashapp/create-intent', {
        leaseId: lease.id,
        paymentType: 'security_deposit',
      }, { skipGlobalError: true });
      const publishableKey = data.publishableKey || stripeConfig?.publishableKey;
      if (!publishableKey || !data.clientSecret) {
        throw new Error('Cash App Pay is not configured.');
      }

      const stripeJs = await loadStripe(publishableKey);
      if (!stripeJs) throw new Error('Could not load Stripe.');

      const returnUrl = `${window.location.origin}/tenant/lease?cashapp_deposit_return=1`;
      const { error } = await stripeJs.confirmCashappPayment(data.clientSecret, {
        payment_method: { type: 'cashapp' },
        return_url: returnUrl,
      });

      if (error) {
        setMessage({ success: false, text: error.message || 'Cash App payment was cancelled.' });
      }
    } catch (err) {
      setMessage({ success: false, text: apiErrorMessage(err, 'Cash App payment could not be started.') });
    } finally {
      setCashAppLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentIntent = params.get('payment_intent');
    if (!params.get('cashapp_deposit_return') || !paymentIntent) return;

    let cancelled = false;
    api.get(`/api/payments/cashapp/sync?payment_intent=${encodeURIComponent(paymentIntent)}`)
      .then(({ data }) => {
        if (cancelled) return;
        if (data.status === 'succeeded') {
          setMessage({ success: true, text: `Cash App deposit of ${fmtMoney(data.amount)} confirmed.` });
          showToast(`Cash App deposit of ${fmtMoney(data.amount)} confirmed.`, 'success');
          onPaid?.(data);
        } else if (data.status === 'processing') {
          setMessage({ success: true, text: 'Cash App deposit submitted. Confirmation may take a moment.' });
          onPaid?.(data);
        } else if (data.status === 'failed') {
          setMessage({ success: false, text: data.failureReason || 'Cash App deposit was not completed.' });
        }
      })
      .catch((err) => {
        if (!cancelled) setMessage({ success: false, text: apiErrorMessage(err, 'Could not confirm Cash App deposit.') });
      })
      .finally(() => {
        if (!cancelled) window.history.replaceState({}, '', '/tenant/lease');
      });

    return () => { cancelled = true; };
  }, [onPaid]);

  function handleCardSuccess(paymentIntent) {
    setMessage({
      success: true,
      text: paymentIntent?.status === 'processing'
        ? 'Card payment submitted. We will update the lease once Stripe confirms it.'
        : 'Security deposit paid. Your lease will activate once confirmation posts.',
    });
    setCardIntent(null);
    onPaid?.(paymentIntent);
  }

  const methodButtonClass = (key) => (
    `flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
      method === key ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
    }`
  );
  const cardTotal = Number(lease.security_deposit || 0) + (includeFirstMonth ? Number(lease.monthly_rent || 0) : 0);

  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Finish lease</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">Pay your security deposit</h2>
          <p className="mt-1 text-sm text-slate-600">
            Both signatures are complete. Pay {fmtMoney(lease.security_deposit)} to activate the lease.
          </p>
        </div>
        <div className="hidden rounded-full bg-white px-3 py-1 text-xs font-semibold text-indigo-700 sm:block">
          Signed -&gt; Pay deposit -&gt; Active
        </div>
      </div>

      <ol className="mt-5 grid grid-cols-3 gap-2 text-center text-xs font-semibold">
        <li className="rounded-lg bg-emerald-50 px-2 py-2 text-emerald-700">Signed</li>
        <li className="rounded-lg bg-indigo-100 px-2 py-2 text-indigo-800">Pay deposit</li>
        <li className="rounded-lg bg-white px-2 py-2 text-slate-400">Active</li>
      </ol>

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={() => setMethod('card')} className={methodButtonClass('card')}>
          <CreditCard size={16} /> Card
        </button>
        <button type="button" onClick={() => setMethod('ach')} className={methodButtonClass('ach')}>
          <Landmark size={16} /> ACH bank
        </button>
        <button type="button" onClick={() => setMethod('cashapp')} className={methodButtonClass('cashapp')}>
          <Smartphone size={16} /> Cash App
        </button>
      </div>

      {message && (
        <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${
          message.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
        }`}>
          {message.text}
        </p>
      )}

      {method === 'card' && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
          <label className="mb-4 flex items-start gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={includeFirstMonth}
              onChange={(event) => {
                setIncludeFirstMonth(event.target.checked);
                setCardIntent(null);
              }}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
            />
            <span>
              Include first month rent with this card payment
              <span className="block text-xs text-slate-400">
                Total: {fmtMoney(cardTotal)}
              </span>
            </span>
          </label>
          {!cardIntent ? (
            <button
              type="button"
              onClick={startCardPayment}
              disabled={cardLoading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {cardLoading ? 'Preparing card form...' : `Pay ${fmtMoney(cardTotal)}`}
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700">Amount: {fmtMoney(cardIntent.amount)}</p>
              <CardPaymentForm
                clientSecret={cardIntent.clientSecret}
                publishableKey={cardIntent.publishableKey}
                onSuccess={handleCardSuccess}
                onError={(err) => setMessage({ success: false, text: err.message || 'Card payment failed.' })}
              />
            </div>
          )}
        </div>
      )}

      {method === 'ach' && (
        <div className="mt-5 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Bank account</p>
              <p className="text-xs text-slate-500">ACH uses your verified Plaid-linked bank account.</p>
            </div>
            <button
              type="button"
              onClick={() => openPlaid()}
              disabled={!plaidReady || plaidLoading || connectingBank}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
            >
              {connectingBank ? 'Linking...' : plaidLoading ? 'Preparing...' : 'Connect bank'}
            </button>
          </div>

          {(plaidError || loadingAccounts) && (
            <p className="text-sm text-slate-500">{loadingAccounts ? 'Loading bank accounts...' : plaidError}</p>
          )}

          <div className="space-y-2">
            {verifiedAccounts.map((account) => (
              <AccountButton
                key={account.id}
                account={account}
                selected={selectedAccount?.id === account.id}
                onSelect={setSelectedAccount}
              />
            ))}
            {!loadingAccounts && verifiedAccounts.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
                Connect a bank account to pay by ACH.
              </div>
            )}
          </div>

          <label className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <input
              type="checkbox"
              checked={autopayWanted}
              disabled={!selectedAccount || autopaySaving}
              onChange={(event) => {
                setAutopayWanted(event.target.checked);
                if (event.target.checked) tryEnableAutopay(selectedAccount, true);
                else setAutopayNote('');
              }}
              className="mt-0.5 h-4 w-4 rounded border-emerald-300 text-emerald-600"
            />
            <span>
              Turn on Autopay after my bank is linked
              <span className="block text-xs text-emerald-700">
                ACH bank required. Autopay is best-effort and does not block lease activation.
              </span>
            </span>
          </label>
          {autopayNote && <p className="text-xs text-emerald-700">{autopayNote}</p>}

          <button
            type="button"
            onClick={payByAch}
            disabled={!selectedAccount || achLoading}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {achLoading ? 'Submitting deposit...' : `Pay ${fmtMoney(lease.security_deposit)} by ACH`}
          </button>
        </div>
      )}

      {method === 'cashapp' && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">
            Cash App Pay opens a secure Stripe confirmation flow and returns you to this lease page.
          </p>
          <button
            type="button"
            onClick={startCashAppPayment}
            disabled={cashAppLoading}
            className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
          >
            {cashAppLoading ? 'Opening Cash App...' : `Pay ${fmtMoney(lease.security_deposit)} with Cash App`}
          </button>
        </div>
      )}
    </section>
  );
}
