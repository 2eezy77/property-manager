import React, { useCallback, useEffect, useState } from 'react';
import api from '@/api/axios';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { usePlaidLink } from '@/hooks/usePlaidLink';
import Panel from '@/components/ui/Panel';

function fmt(n) {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n));
}

function fmtDate(d) {
  if (!d) return '—';
  const iso = typeof d === 'string' ? d.slice(0, 10) : d;
  const parsed = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function relTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function accountNeedsRelink(acct) {
  return acct?.linkStatus === 'needs_relink' || acct?.link_status === 'needs_relink';
}

function PropertyOperatingBankPanel() {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [relinkAccount, setRelinkAccount] = useState(null);
  const [updateLinkToken, setUpdateLinkToken] = useState(null);
  const [relinkLoading, setRelinkLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/owner/property-bank');
      setAccount(data.account);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load property bank account.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePlaidSuccess = useCallback(async (publicToken, metadata) => {
    const accountId = metadata.accounts[0]?.id;
    if (!accountId) return;
    setConnecting(true);
    setError('');
    try {
      const { data } = await api.post('/api/owner/property-bank/plaid/exchange', {
        publicToken,
        accountId,
      });
      setAccount(data.account);
    } catch (e) {
      setError(apiErrorMessage(e, 'Failed to link property account.'));
    } finally {
      setConnecting(false);
    }
  }, []);

  const handleRelinkSuccess = useCallback(async (publicToken) => {
    if (!relinkAccount) return;
    setRelinkLoading(true);
    setError('');
    try {
      await api.post('/api/owner/property-bank/plaid/exchange-update', {
        publicToken,
        bankAccountId: relinkAccount.id,
      });
      setRelinkAccount(null);
      setUpdateLinkToken(null);
      await load();
      window.dispatchEvent(new CustomEvent('api:toast', {
        detail: { message: 'Property bank account reconnected successfully.', variant: 'success' },
      }));
    } catch (e) {
      setError(apiErrorMessage(e, 'Failed to refresh bank connection.'));
    } finally {
      setRelinkLoading(false);
    }
  }, [relinkAccount, load]);

  const { open: openPlaid, ready: plaidReady, error: plaidError } = usePlaidLink({
    onSuccess: handlePlaidSuccess,
    linkTokenPath: '/api/owner/property-bank/plaid/link-token',
    exchangePath: '/api/owner/property-bank/plaid/exchange',
    returnTo: '/admin/finance',
    enabled: !account,
  });

  const {
    open: openRelinkPlaid,
    ready: relinkPlaidReady,
    error: relinkPlaidError,
    loading: relinkPlaidLoading,
  } = usePlaidLink({
    onSuccess: handleRelinkSuccess,
    enabled: !!updateLinkToken,
    initialLinkToken: updateLinkToken,
    linkTokenPath: '/api/owner/property-bank/plaid/update-link-token',
    exchangePath: '/api/owner/property-bank/plaid/exchange-update',
    returnTo: '/admin/finance',
  });

  async function startRelink(acct) {
    setRelinkAccount(acct);
    setError('');
    setRelinkLoading(true);
    try {
      const { data } = await api.post('/api/owner/property-bank/plaid/update-link-token', {
        bankAccountId: acct.id,
      });
      setUpdateLinkToken(data.linkToken);
    } catch (e) {
      setRelinkAccount(null);
      setError(apiErrorMessage(e, 'Could not start bank reconnection.'));
    } finally {
      setRelinkLoading(false);
    }
  }

  useEffect(() => {
    if (updateLinkToken && relinkPlaidReady && !relinkPlaidLoading) {
      openRelinkPlaid();
    }
  }, [updateLinkToken, relinkPlaidReady, relinkPlaidLoading, openRelinkPlaid]);

  async function removeAccount() {
    if (!account?.id) return;
    setError('');
    try {
      await api.delete(`/api/owner/property-bank/${account.id}`);
      setAccount(null);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not remove property account.'));
    }
  }

  return (
    <Panel title="Property operating account">
      <p className="mb-3 text-xs text-slate-600">
        Link the joint checking account you and Trevor use for 743 A Ave — manager pay,
        utilities, and other property expenses. Visible to both owners; only one account per property.
      </p>
      {loading ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : account ? (
        <>
          {accountNeedsRelink(account) && (
            <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-4">
              <p className="text-sm font-semibold text-amber-900">Bank reconnection required</p>
              <p className="mt-1 text-sm text-amber-800">
                Your property account login expired or needs to be refreshed. Reconnect before ACH payroll or expenses.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-amber-200 bg-white px-3 py-2">
                <span className="text-sm text-gray-800">
                  {account.institutionName} ····{account.accountMask}
                </span>
                <button
                  type="button"
                  onClick={() => startRelink(account)}
                  disabled={relinkLoading || relinkPlaidLoading}
                  className="shrink-0 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  {relinkLoading && relinkAccount?.id === account.id ? 'Preparing…' : 'Reconnect'}
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm">
            <div>
              <p className="font-medium text-slate-900">{account.institutionName}</p>
              <p className="text-xs text-slate-500">
                {account.accountName} ····{account.accountMask}
                {account.linkedByName ? ` · linked by ${account.linkedByName}` : ''}
                {accountNeedsRelink(account) && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">reconnect needed</span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={removeAccount}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Remove
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          disabled={!plaidReady || connecting}
          onClick={() => openPlaid()}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {connecting ? 'Connecting…' : 'Connect with Plaid'}
        </button>
      )}
      {(error || plaidError || relinkPlaidError) && (
        <p className="mt-2 text-xs text-red-600">{error || plaidError || relinkPlaidError}</p>
      )}
    </Panel>
  );
}

export default function OwnerFinancePage() {
  const [checklist, setChecklist] = useState([]);
  const [summary, setSummary] = useState(null);
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const [cR, sR, stR] = await Promise.all([
        api.get('/api/owner/checklist'),
        api.get('/api/owner/mortgage/summary'),
        api.get('/api/owner/mortgage/statements?limit=6'),
      ]);
      setChecklist(cR.data.items || []);
      setSummary(sR.data.summary);
      setStatements(stR.data.statements || []);
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not load finance data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function patchItem(id, body) {
    setBusyId(id);
    try {
      const { data } = await api.patch(`/api/owner/checklist/${id}`, body);
      setChecklist((items) => items.map((i) => (i.id === id ? data.item : i)));
    } catch (e) {
      setErr(e.response?.data?.message || 'Update failed.');
    } finally {
      setBusyId(null);
    }
  }

  const meta = summary?.metadata || {};

  return (
    <div className="stagger-section mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Personal finance</h1>
        <p className="mt-1 text-sm text-slate-500">
          Owner payment checklist and mortgage statements for AI/RAG context.
        </p>
      </div>

      {err && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>
      )}

      <PropertyOperatingBankPanel />

      <Panel title="Mortgage (Newrez)" className="!p-0">
        <div className="p-5">
          {loading ? (
            <div className="h-24 skeleton rounded-xl" />
          ) : !summary ? (
            <div className="text-sm text-slate-500">
              <p>No mortgage statements imported yet.</p>
              <p className="mt-2 font-mono text-xs text-slate-400">
                npm run import:mortgage
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Latest statement</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{fmtDate(summary.statement_date)}</p>
                <p className="text-sm text-slate-500">{summary.servicer} · acct {summary.account_number || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Next due</p>
                <p className="mt-1 text-lg font-semibold text-violet-700">{fmtDate(summary.due_date)}</p>
                <p className="text-sm text-slate-500">{fmt(summary.amount_due)} total due</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Monthly payment</p>
                <p className="font-semibold text-slate-900">{fmt(summary.monthly_payment)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Principal balance</p>
                <p className="font-semibold text-slate-900">{fmt(summary.principal_balance)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Escrow</p>
                <p className="font-semibold text-slate-900">{fmt(summary.escrow_balance)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Rate</p>
                <p className="font-semibold text-slate-900">{summary.interest_rate != null ? `${summary.interest_rate}%` : '—'}</p>
              </div>
              {meta.last_payment_date && (
                <div className="sm:col-span-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  Last payment {fmt(meta.last_payment_amount)} on {fmtDate(meta.last_payment_date)}
                </div>
              )}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Payment checklist" className="!p-0">
        <ul className="divide-y divide-slate-100">
          {loading ? (
            [1, 2, 3, 4].map((i) => <li key={i} className="h-16 skeleton m-4 rounded-xl" />)
          ) : checklist.map((item) => (
            <li key={item.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{item.label}</p>
                <p className="text-sm text-slate-500">
                  {fmt(item.amount_estimate)}
                  {item.due_day ? ` · due ~${item.due_day}${['st', 'nd', 'rd'][item.due_day - 1] || 'th'}` : ''}
                  {item.payment_method ? ` · ${item.payment_method.replace(/_/g, ' ')}` : ''}
                </p>
                {item.notes && <p className="mt-1 text-xs text-slate-400">{item.notes}</p>}
                <p className="mt-1 text-xs text-slate-400">
                  {item.last_paid_at ? `Paid ${relTime(item.last_paid_at)}` : 'Not marked paid'}
                  {' · '}
                  {item.last_verified_at ? `Verified ${relTime(item.last_verified_at)}` : 'Not verified'}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => patchItem(item.id, { mark_paid: true })}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                >
                  Mark paid
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => patchItem(item.id, { mark_verified: true })}
                  className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                >
                  Verify
                </button>
                {(item.last_paid_at || item.last_verified_at) && (
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => patchItem(item.id, { clear_paid: true, clear_verified: true })}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Reset
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {statements.length > 0 && (
        <Panel title="Imported statements" className="!p-0">
          <ul className="divide-y divide-slate-100">
            {statements.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium text-slate-900">{fmtDate(s.statement_date)}</p>
                  <p className="text-xs text-slate-500">{s.source_file || 'imported'}</p>
                </div>
                <div className="text-right tabular-nums">
                  <p className="font-semibold text-slate-900">{fmt(s.principal_balance)}</p>
                  <p className="text-xs text-slate-500">due {fmtDate(s.due_date)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
