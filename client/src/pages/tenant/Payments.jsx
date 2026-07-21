/**
 * Payments.jsx — Tenant payments portal
 *
 * Sections:
 *  1. Rent Balance card  — shows amount due, due date, late fee total
 *  2. Bank Accounts      — connected accounts + "Connect" button (Plaid Link)
 *  3. Pay Rent flow      — account selector → confirmation → processing → result
 *  4. Payment History    — paginated table of all past payments
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Landmark, CheckCircle2, XCircle } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import api from '@/api/axios';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { usePlaidLink } from '@/hooks/usePlaidLink';
import { notifyCheckinRefresh } from '@/hooks/useCheckin';
import { isManagerImpersonation } from '@/utils/impersonation';
import RentHero from '@/components/ui/RentHero';
import TableScroll from '@/components/ui/TableScroll';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function showToast(message, variant = 'error') {
  window.dispatchEvent(new CustomEvent('api:toast', { detail: { message, variant } }));
}

const METHOD_LABEL = {
  cash_app: 'Cash App',
  check: 'Check',
  zelle: 'Zelle',
  venmo: 'Venmo',
  wire: 'Wire',
  cash: 'Cash',
  other: 'Other',
  ach: 'Bank (ACH)',
};

function paymentSourceLabel(p) {
  if (p.payment_method) return METHOD_LABEL[p.payment_method] || p.payment_method;
  if (p.metadata?.source === 'cash_app_import' || p.metadata?.source === 'stripe_cashapp') return 'Cash App';
  if (p.metadata?.payment_method === 'cash_app') return 'Cash App';
  if (p.institution_name) return `${p.institution_name} ····${p.account_mask || ''}`.trim();
  return 'Bank (ACH)';
}

const STATUS_BADGE = {
  succeeded:  'bg-emerald-50 text-emerald-700',
  processing: 'bg-blue-50 text-blue-700',
  pending:    'bg-amber-50 text-amber-700',
  failed:     'bg-red-50 text-red-700',
  refunded:   'bg-slate-100 text-slate-600',
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status}
    </span>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BankAccountCard({ account, isSelected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(account)}
      aria-pressed={isSelected}
      aria-label={`${account.institution_name}, ending in ${account.account_mask}${isSelected ? ', selected' : ''}`}
      className={`w-full rounded-xl border p-4 text-left transition-all ${
        isSelected
          ? 'border-brand bg-brand/5 ring-1 ring-brand'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600" aria-hidden>
            <Landmark size={18} strokeWidth={2} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900">{account.institution_name}</p>
            <p className="text-xs text-slate-500">
              {account.account_name} ····{account.account_mask}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            account.link_status === 'needs_relink'
              ? 'bg-amber-50 text-amber-800'
              : account.status === 'verified'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-amber-50 text-amber-700'
          }`}>
            {account.link_status === 'needs_relink' ? 'reconnect needed' : account.status}
          </span>
          {account.is_default && (
            <span className="text-xs text-slate-400">Default</span>
          )}
        </div>
      </div>
    </button>
  );
}

function PayConfirmModal({ account, balance, onConfirm, onCancel, loading }) {
  const rent = balance?.lease?.monthlyRent ?? 0;
  const late = balance?.lateFeeBalance ?? 0;
  const total = rent + late;

  return (
    <div className="modal-overlay" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pay-confirm-title"
        className="w-full max-w-sm rounded-2xl bg-white shadow-xl"
      >
        <div className="p-6">
          <h2 id="pay-confirm-title" className="text-lg font-semibold text-gray-900">Confirm Payment</h2>
          <p className="mt-1 text-sm text-gray-500">Review the details before submitting.</p>

          <div className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-200">
            <div className="flex justify-between px-4 py-3">
              <span className="text-sm text-gray-500">Rent</span>
              <span className="text-sm text-gray-900">{fmt(rent)}</span>
            </div>
            {late > 0 && (
              <div className="flex justify-between px-4 py-3">
                <span className="text-sm text-red-600">Late fees</span>
                <span className="text-sm font-medium text-red-600">{fmt(late)}</span>
              </div>
            )}
            <div className="flex justify-between px-4 py-3">
              <span className="text-sm font-medium text-gray-700">Total</span>
              <span className="text-sm font-semibold text-gray-900">{fmt(total)}</span>
            </div>
            <div className="flex justify-between px-4 py-3">
              <span className="text-sm text-gray-500">From</span>
              <span className="text-sm text-gray-900">
                {account.institution_name} ····{account.account_mask}
              </span>
            </div>
            <div className="flex justify-between px-4 py-3">
              <span className="text-sm text-gray-500">Settlement</span>
              <span className="text-sm text-gray-500">4–5 business days (ACH)</span>
            </div>
          </div>

          <p className="mt-4 text-xs text-gray-400 leading-relaxed">
            By confirming, you authorise a one-time ACH debit from your account.
            ACH transfers cannot be recalled once submitted.
          </p>
        </div>

        <div className="flex gap-3 border-t border-gray-100 px-6 py-4">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 transition-colors"
          >
            {loading ? 'Submitting…' : `Pay ${fmt(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────
export default function PaymentsPage() {
  const location = useLocation();
  const managerPreview = isManagerImpersonation();
  const [balance,  setBalance]  = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [history,  setHistory]  = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });

  // UI state
  const [pageLoading,   setPageLoading]   = useState(true);
  const [pageLoadError, setPageLoadError] = useState('');
  const [showPayFlow,   setShowPayFlow]   = useState(false);
  const [selectedAcct,  setSelectedAcct]  = useState(null);
  const [showConfirm,   setShowConfirm]   = useState(false);
  const [showDepositConfirm, setShowDepositConfirm] = useState(false);
  const [depositPayLoading, setDepositPayLoading] = useState(false);
  const [payLoading,    setPayLoading]    = useState(false);
  const [payResult,     setPayResult]     = useState(null);  // { success, message }
  const [histPage,      setHistPage]      = useState(1);
  const [connectingBank, setConnectingBank] = useState(false);
  const [connectError,   setConnectError]  = useState('');
  const [autopay, setAutopay] = useState(null);
  const [autopaySaving, setAutopaySaving] = useState(false);
  const [cashAppLoading, setCashAppLoading] = useState(false);
  const [stripeConfig, setStripeConfig] = useState(null);
  const [relinkAccount, setRelinkAccount] = useState(null);
  const [updateLinkToken, setUpdateLinkToken] = useState(null);
  const [relinkLoading, setRelinkLoading] = useState(false);

  // Load balance, accounts, and history
  const load = useCallback(async (historyPage = 1) => {
    setPageLoadError('');
    try {
      const requests = [
        api.get('/api/payments/balance'),
        api.get(`/api/payments/history?page=${historyPage}&limit=10`),
      ];
      if (!managerPreview) {
        requests.splice(1, 0, api.get('/api/payments/bank-accounts'));
        requests.push(api.get('/api/payments/autopay'));
        requests.push(api.get('/api/payments/config'));
      }
      const results = await Promise.all(requests);
      const balRes = results[0];
      const acctRes = managerPreview ? null : results[1];
      const histRes = managerPreview ? results[1] : results[2];
      const autopayRes = managerPreview ? null : results[3];
      const stripeRes = managerPreview ? null : results[4];
      setBalance(balRes.data);
      setAccounts(acctRes?.data?.accounts ?? []);
      setHistory(histRes.data.payments);
      setPagination(histRes.data.pagination);
      if (autopayRes) setAutopay(autopayRes.data.autopay);
      if (stripeRes) setStripeConfig(stripeRes.data);
    } catch (err) {
      setPageLoadError(apiErrorMessage(err, 'Could not load payments. Please try again.'));
    } finally {
      setPageLoading(false);
    }
  }, [managerPreview]);

  useEffect(() => { load(histPage); }, [load, histPage]);

  // After Cash App redirect, sync payment status from Stripe
  useEffect(() => {
    if (managerPreview) return;
    const params = new URLSearchParams(location.search);
    const paymentIntent = params.get('payment_intent');
    if (!params.get('cashapp_return') || !paymentIntent) return;

    api.get(`/api/payments/cashapp/sync?payment_intent=${encodeURIComponent(paymentIntent)}`)
      .then(({ data }) => {
        if (data.status === 'succeeded') {
          setPayResult({
            success: true,
            message: `Cash App payment of ${fmt(data.amount)} confirmed.`,
          });
          showToast(`Cash App payment of ${fmt(data.amount)} confirmed.`, 'success');
          notifyCheckinRefresh();
        } else if (data.status === 'processing') {
          setPayResult({
            success: true,
            message: 'Cash App payment submitted — confirmation may take a moment.',
          });
          showToast('Cash App payment submitted — we will update your balance shortly.', 'success');
        } else if (data.status === 'failed') {
          setPayResult({
            success: false,
            message: data.failureReason || 'Cash App payment was not completed.',
          });
        }
        load(1);
      })
      .catch((err) => {
        setPayResult({
          success: false,
          message: apiErrorMessage(err, 'Could not confirm Cash App payment.'),
        });
      })
      .finally(() => {
        window.history.replaceState({}, '', location.pathname);
      });
  }, [location.search, location.pathname, managerPreview]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select default account when pay flow opens
  useEffect(() => {
    if (showPayFlow && !selectedAcct) {
      const def = accounts.find((a) => a.is_default && a.status === 'verified');
      if (def) setSelectedAcct(def);
    }
  }, [showPayFlow, accounts, selectedAcct]);

  // ── Plaid Link callbacks ────────────────────────────────────────────────────
  const handlePlaidSuccess = useCallback(async (publicToken, metadata) => {
    const accountId = metadata.accounts[0]?.id;
    if (!accountId) return;

    setConnectingBank(true);
    setConnectError('');
    try {
      await api.post('/api/payments/plaid/exchange', { publicToken, accountId });
      await load(histPage);
      notifyCheckinRefresh();
    } catch (err) {
      setConnectError(apiErrorMessage(err, 'Failed to link bank account.'));
    } finally {
      setConnectingBank(false);
    }
  }, [load, histPage]);

  const handleRelinkSuccess = useCallback(async (publicToken) => {
    if (!relinkAccount) return;
    setRelinkLoading(true);
    setConnectError('');
    try {
      await api.post('/api/payments/plaid/exchange-update', {
        publicToken,
        bankAccountId: relinkAccount.id,
      });
      setRelinkAccount(null);
      setUpdateLinkToken(null);
      await load(histPage);
      notifyCheckinRefresh();
      showToast('Bank account reconnected successfully.', 'success');
    } catch (err) {
      setConnectError(apiErrorMessage(err, 'Failed to refresh bank connection.'));
    } finally {
      setRelinkLoading(false);
    }
  }, [relinkAccount, load, histPage]);

  const { open: openPlaid, ready: plaidReady, error: plaidError, loading: plaidLoading } = usePlaidLink({
    onSuccess: handlePlaidSuccess,
    enabled: !managerPreview && !updateLinkToken,
    exchangePath: '/api/payments/plaid/exchange',
    returnTo: location.pathname,
  });

  const {
    open: openRelinkPlaid,
    ready: relinkPlaidReady,
    error: relinkPlaidError,
    loading: relinkPlaidLoading,
  } = usePlaidLink({
    onSuccess: handleRelinkSuccess,
    enabled: !managerPreview && !!updateLinkToken,
    initialLinkToken: updateLinkToken,
    linkTokenPath: '/api/payments/plaid/update-link-token',
    exchangePath: '/api/payments/plaid/exchange-update',
    returnTo: location.pathname,
  });

  async function startRelink(account) {
    setRelinkAccount(account);
    setConnectError('');
    setRelinkLoading(true);
    try {
      const { data } = await api.post('/api/payments/plaid/update-link-token', {
        bankAccountId: account.id,
      });
      setUpdateLinkToken(data.linkToken);
    } catch (err) {
      setRelinkAccount(null);
      setConnectError(apiErrorMessage(err, 'Could not start bank reconnection.'));
    } finally {
      setRelinkLoading(false);
    }
  }
  useEffect(() => {
    if (updateLinkToken && relinkPlaidReady && !relinkPlaidLoading) {
      openRelinkPlaid();
    }
  }, [updateLinkToken, relinkPlaidReady, relinkPlaidLoading, openRelinkPlaid]);

  async function handleDepositPay() {
    if (!selectedAcct || !balance?.lease || !balance?.securityDepositPayment) return;
    setDepositPayLoading(true);
    try {
      await api.post('/api/payments/charge', {
        bankAccountId: selectedAcct.id,
        leaseId: balance.lease.id,
        paymentType: 'security_deposit',
      });
      setShowDepositConfirm(false);
      setShowPayFlow(false);
      setPayResult({
        success: true,
        message: 'Security deposit submitted! ACH transfers settle in 4–5 business days.',
      });
      await load(1);
    } catch (err) {
      setPayResult({
        success: false,
        message: apiErrorMessage(err, 'Deposit payment failed. Please try again.'),
      });
    } finally {
      setDepositPayLoading(false);
    }
  }

  async function handlePayConfirm() {
    if (!selectedAcct || !balance?.lease) return;
    setPayLoading(true);
    try {
      await api.post('/api/payments/charge', {
        bankAccountId: selectedAcct.id,
        leaseId:       balance.lease.id,
        paymentType:   'rent',
      });
      setShowConfirm(false);
      setShowPayFlow(false);
      setPayResult({ success: true, message: 'Payment submitted! ACH transfers settle in 4–5 business days.' });
      await load(1);
    } catch (err) {
      setShowConfirm(false);
      setPayResult({
        success: false,
        message: apiErrorMessage(err, 'Payment failed. Please try again.'),
      });
    } finally {
      setPayLoading(false);
    }
  }

  async function handleCashAppPay() {
    if (!balance?.lease) return;
    setCashAppLoading(true);
    setPayResult(null);
    try {
      const { data } = await api.post('/api/payments/cashapp/create-intent', {
        leaseId: balance.lease.id,
        paymentType: 'rent',
      }, { skipGlobalError: true });

      const publishableKey = data.publishableKey || stripeConfig?.publishableKey;
      if (!publishableKey || !data.clientSecret) {
        throw new Error('Cash App Pay is not configured.');
      }

      const stripeJs = await loadStripe(publishableKey);
      if (!stripeJs) throw new Error('Could not load Stripe.');

      const returnUrl = `${window.location.origin}/tenant/payments?cashapp_return=1`;
      const { error } = await stripeJs.confirmCashappPayment(data.clientSecret, {
        payment_method: { type: 'cashapp' },
        return_url: returnUrl,
      });

      if (error) {
        setPayResult({ success: false, message: error.message || 'Cash App payment was cancelled.' });
      }
    } catch (err) {
      setPayResult({
        success: false,
        message: apiErrorMessage(err, 'Cash App payment could not be started.'),
      });
    } finally {
      setCashAppLoading(false);
    }
  }

  async function toggleAutopay(enabled) {
    const def = accounts.find((a) => a.is_default && a.status === 'verified')
      || accounts.find((a) => a.status === 'verified');
    if (enabled && !def) {
      setPayResult({ success: false, message: 'Connect and verify a bank account before enabling autopay.' });
      return;
    }
    setAutopaySaving(true);
    try {
      const { data } = await api.patch('/api/payments/autopay', {
        enabled,
        bankAccountId: enabled ? def.id : undefined,
      });
      setAutopay(data.autopay);
      showToast(
        data.message
          || (enabled
            ? 'Autopay on — rent late fees waived while enabled. Utilities auto-debit after each bill.'
            : 'Autopay off — late fees apply if rent is unpaid after the grace period.'),
        enabled ? 'success' : 'error'
      );
    } catch (err) {
      setPayResult({
        success: false,
        message: apiErrorMessage(err, 'Could not update autopay settings.'),
      });
    } finally {
      setAutopaySaving(false);
    }
  }

  if (pageLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-44 rounded-2xl" />
        <div className="skeleton h-24 rounded-2xl" />
        <div className="skeleton h-40 rounded-2xl" />
      </div>
    );
  }

  if (pageLoadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-sm text-red-700">{pageLoadError}</p>
        <button
          type="button"
          onClick={() => { setPageLoading(true); load(histPage); }}
          className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          Try again
        </button>
      </div>
    );
  }

  const verifiedAccounts = accounts.filter((a) => a.status === 'verified' && a.link_status !== 'needs_relink');
  const needsRelinkAccounts = accounts.filter((a) => a.link_status === 'needs_relink');
  const cashAppAvailable = !!(
    stripeConfig?.cashAppEnabled
    || stripeConfig?.cashAppPayAvailable
    || balance?.cashAppPayAvailable
  );
  const noBankLinked = verifiedAccounts.length === 0;
  const rentDue = Number(balance?.totalDue || 0) > 0;
  const depositDue = !managerPreview && balance?.securityDepositPayment;

  return (
    <div className="stagger-section space-y-6">
      {managerPreview && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Preview only — payment history is visible; bank accounts and pay actions are hidden.
        </div>
      )}

      {payResult && (
        <div
          role={payResult.success ? 'status' : 'alert'}
          aria-live={payResult.success ? 'polite' : 'assertive'}
          className={`flex items-start gap-3 rounded-xl border p-4 ${payResult.success ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}
        >
          <span className="mt-0.5 shrink-0" aria-hidden>
            {payResult.success
              ? <CheckCircle2 size={18} className="text-emerald-600" />
              : <XCircle size={18} className="text-red-600" />}
          </span>
          <p className={`flex-1 text-sm font-medium ${payResult.success ? 'text-emerald-800' : 'text-red-800'}`}>
            {payResult.message}
          </p>
          <button type="button" onClick={() => setPayResult(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none" aria-label="Dismiss">×</button>
        </div>
      )}

      {!managerPreview && needsRelinkAccounts.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4">
          <p className="text-sm font-semibold text-amber-900">Reconnect your bank</p>
          <p className="mt-1 text-sm text-amber-800">
            Your bank login expired. Reconnect before paying rent or using autopay.
          </p>
          <div className="mt-3 space-y-2">
            {needsRelinkAccounts.map((acct) => (
              <div key={acct.id} className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-slate-800">
                  {acct.institution_name} ····{acct.account_mask}
                </span>
                <button
                  type="button"
                  onClick={() => startRelink(acct)}
                  disabled={relinkLoading || relinkPlaidLoading}
                  className="shrink-0 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  {relinkLoading && relinkAccount?.id === acct.id ? 'Preparing…' : 'Reconnect'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <section
        aria-labelledby="pay-here-heading"
        className="rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-4"
      >
        <h2 id="pay-here-heading" className="text-sm font-semibold text-blue-950">
          Pay here for the cleanest record
        </h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-blue-900/90">
          <li>
            <strong className="font-semibold">Autopay + bank</strong>
            {' — late fees waived while Autopay is on. Best for monthly rent.'}
          </li>
          <li>
            <strong className="font-semibold">Cash App in this page</strong>
            {' — one-time rent that posts to your ledger right away (no screenshot chase).'}
          </li>
          <li>
            Outside cashtag / Venmo / Zelle can lag or need manual matching — use this portal when you can.
          </li>
        </ul>
      </section>

      <RentHero
        balance={balance}
        hidePayAction={managerPreview}
        onPay={managerPreview ? undefined : () => {
          setShowPayFlow(true);
          setPayResult(null);
        }}
      />

      {!managerPreview && rentDue && cashAppAvailable && !showPayFlow && (
        <button
          type="button"
          onClick={handleCashAppPay}
          disabled={cashAppLoading}
          className="portal-card hover-lift flex w-full items-center justify-between gap-3 px-4 py-3 text-left disabled:opacity-50"
        >
          <div>
            <p className="text-sm font-semibold text-slate-900">Pay with Cash App in the portal</p>
            <p className="text-xs text-slate-500">
              {noBankLinked
                ? 'Posts to your balance immediately · no bank link required'
                : 'One-time · for Autopay + late-fee waiver, connect a bank below'}
            </p>
          </div>
          <span className="shrink-0 rounded-lg bg-[#00D632] px-3 py-1.5 text-xs font-bold text-white">
            {cashAppLoading ? 'Opening…' : 'Cash App'}
          </span>
        </button>
      )}

      {depositDue && !showPayFlow && (
        <button
          type="button"
          onClick={() => { setShowPayFlow(true); setPayResult(null); }}
          className="portal-card hover-lift flex w-full items-center justify-between gap-3 border border-violet-200 px-4 py-3 text-left ring-1 ring-violet-100"
        >
          <div>
            <p className="text-sm font-semibold text-slate-900">Security deposit due — pay in the portal</p>
            <p className="text-xs text-slate-500">
              {fmt(balance.securityDepositPayment.amount)} · due {fmtDate(balance.securityDepositPayment.due_date)}
              {' · '}ACH after you connect a bank (Cash App Pay is rent-only)
            </p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-violet-700">Pay →</span>
        </button>
      )}

      {!managerPreview && showPayFlow && (
        <section aria-labelledby="pay-flow-heading" className="portal-card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 id="pay-flow-heading" className="text-base font-semibold text-slate-900">Choose how to pay</h2>
            <button type="button" onClick={() => setShowPayFlow(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="Close">×</button>
          </div>

          <p className="text-xs text-slate-500">
            Preferred: bank ACH (and Autopay for late-fee waiver). Cash App below is fine for one-time rent.
          </p>

          {cashAppAvailable && rentDue && (
            <button
              type="button"
              onClick={handleCashAppPay}
              disabled={cashAppLoading}
              className="w-full rounded-xl bg-[#00D632] py-2.5 text-sm font-bold text-white hover:bg-[#00bf2d] disabled:opacity-50"
            >
              {cashAppLoading ? 'Opening Cash App…' : `Pay ${fmt(balance.totalDue)} with Cash App (portal)`}
            </button>
          )}

          {verifiedAccounts.length === 0 ? (
            <p className="text-sm text-slate-500">
              Connect a bank below for ACH, deposits, and Autopay
              {cashAppAvailable && rentDue ? ' — or use portal Cash App for rent above' : '.'}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bank (ACH)</p>
              {verifiedAccounts.map((acct) => (
                <BankAccountCard
                  key={acct.id}
                  account={acct}
                  isSelected={selectedAcct?.id === acct.id}
                  onSelect={setSelectedAcct}
                />
              ))}
            </div>
          )}

          {selectedAcct && (
            <div className="flex flex-col gap-2">
              {rentDue && (
                <button
                  type="button"
                  onClick={() => setShowConfirm(true)}
                  className="w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-dark transition-colors"
                >
                  Pay rent with ····{selectedAcct.account_mask}
                </button>
              )}
              {depositDue && (
                <button
                  type="button"
                  onClick={() => setShowDepositConfirm(true)}
                  className="w-full rounded-xl border border-violet-300 bg-violet-50 py-2.5 text-sm font-semibold text-violet-900 hover:bg-violet-100 transition-colors"
                >
                  Pay deposit ({fmt(balance.securityDepositPayment.amount)})
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {showDepositConfirm && selectedAcct && balance?.securityDepositPayment && (
        <div className="modal-overlay" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="deposit-confirm-title"
            className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-6"
          >
            <h2 id="deposit-confirm-title" className="text-lg font-semibold text-gray-900">Confirm security deposit</h2>
            <p className="mt-2 text-sm text-gray-600">
              {fmt(balance.securityDepositPayment.amount)} due {fmtDate(balance.securityDepositPayment.due_date)}
            </p>
            <p className="mt-1 text-xs text-gray-500">From ····{selectedAcct.account_mask}</p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setShowDepositConfirm(false)}
                className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={depositPayLoading}
                onClick={handleDepositPay}
                className="flex-1 rounded-lg bg-violet-700 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {depositPayLoading ? 'Processing…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {showConfirm && selectedAcct && (
        <PayConfirmModal
          account={selectedAcct}
          balance={balance}
          onConfirm={handlePayConfirm}
          onCancel={() => setShowConfirm(false)}
          loading={payLoading}
        />
      )}

      {!managerPreview && (
      <section
        aria-labelledby="autopay-heading"
        className={`portal-card flex items-start justify-between gap-3 p-5 ${
          !autopay?.autopay_enabled ? 'border border-emerald-200 ring-1 ring-emerald-100' : ''
        }`}
      >
        <div className="min-w-0">
          <h2 id="autopay-heading" className="text-base font-semibold text-slate-900">Autopay</h2>
          <p className="mt-1 text-xs text-slate-500">
            ACH on the 1st · utilities auto-debit after the dispute window
          </p>
          {autopay?.autopay_enabled ? (
            <p className="mt-2 text-xs font-medium text-emerald-700">Late-fee protection on — keep Autopay enabled</p>
          ) : (
            <p className="mt-2 text-xs font-medium text-emerald-800">
              {verifiedAccounts.length === 0
                ? 'Connect a bank, then turn Autopay on — late fees waived while it stays on.'
                : 'Turn on to waive late fees while Autopay stays enabled.'}
            </p>
          )}
        </div>
        <label className="flex shrink-0 items-center gap-2">
          <input
            type="checkbox"
            checked={!!autopay?.autopay_enabled}
            disabled={autopaySaving || verifiedAccounts.length === 0}
            onChange={(e) => toggleAutopay(e.target.checked)}
            aria-describedby="autopay-heading"
            className="h-4 w-4 rounded border-slate-300 text-brand"
          />
          <span className="text-sm font-medium text-slate-700">{autopaySaving ? '…' : 'On'}</span>
        </label>
      </section>
      )}

      {!managerPreview && (
      <section aria-labelledby="bank-accounts-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="bank-accounts-heading" className="text-base font-semibold text-slate-900">Bank accounts</h2>
          <button
            type="button"
            onClick={() => openPlaid()}
            disabled={!plaidReady || connectingBank || plaidLoading}
            aria-label="Connect bank account"
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {(connectingBank || plaidLoading) ? (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
            ) : <span aria-hidden>+</span>}
            {connectingBank ? 'Linking…' : plaidLoading ? 'Preparing…' : 'Connect'}
          </button>
        </div>

        {(connectError || plaidError || relinkPlaidError) && (
          <p role="alert" className="text-sm text-red-600">{connectError || plaidError || relinkPlaidError}</p>
        )}

        {accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 py-10 text-center">
            <Landmark size={28} strokeWidth={1.5} className="mx-auto mb-2 text-emerald-400" aria-hidden />
            <p className="text-sm font-medium text-slate-800">Connect a bank to unlock Autopay</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
              Autopay waives late fees while it is on. Also needed for security deposits and utility ACH.
              {cashAppAvailable && rentDue ? ' Portal Cash App above still works for one-time rent.' : ''}
            </p>
            <button
              type="button"
              onClick={() => openPlaid()}
              disabled={!plaidReady || plaidLoading || connectingBank}
              className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50 transition-colors"
            >
              {plaidLoading ? 'Preparing…' : connectingBank ? 'Linking…' : 'Connect bank'}
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {accounts.map((acct) => (
              <li key={acct.id}>
                <BankAccountCard
                  account={acct}
                  isSelected={false}
                  onSelect={() => {}}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      <section aria-labelledby="payment-history-heading" className="space-y-3">
        <h2 id="payment-history-heading" className="text-base font-semibold text-slate-900">
          History
          {pagination.total > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-400">({pagination.total})</span>
          )}
        </h2>

        {history.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
            No payments yet.
          </p>
        ) : (
          <>
            <TableScroll className="rounded-xl border border-slate-200 bg-white">
              <table className="min-w-[32rem] w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {['Description', 'Date', 'Method', 'Amount', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 font-medium capitalize text-slate-900">
                        {p.payment_type.replace('_', ' ')}
                        {p.period_start && (
                          <span className="ml-1.5 text-xs font-normal text-slate-400">
                            {new Date(p.period_start).toLocaleString('en-US', { month: 'short', year: 'numeric' })}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                        {fmtDate(p.paid_at ?? p.due_date)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                        {paymentSourceLabel(p)}
                        {p.external_reference && (
                          <span className="block max-w-[140px] truncate text-xs text-slate-400" title={p.external_reference}>
                            {p.external_reference}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                        {fmt(p.amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={p.status} />
                        {p.status === 'processing' && (
                          <p className="mt-0.5 text-xs text-blue-600">Settling (4–5 business days)</p>
                        )}
                        {p.failure_reason && (
                          <p className="mt-0.5 max-w-[160px] truncate text-xs text-red-500" title={p.failure_reason}>
                            {p.failure_reason}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>

            {pagination.pages > 1 && (
              <nav aria-label="Payment history pages" className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => setHistPage((p) => Math.max(1, p - 1))}
                  disabled={histPage === 1}
                  aria-label="Previous page"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  ← Previous
                </button>
                <span className="text-slate-400" aria-live="polite">
                  Page {histPage} of {pagination.pages}
                </span>
                <button
                  type="button"
                  onClick={() => setHistPage((p) => Math.min(pagination.pages, p + 1))}
                  disabled={histPage === pagination.pages}
                  aria-label="Next page"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  Next →
                </button>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}
