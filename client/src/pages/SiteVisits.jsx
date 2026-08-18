import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLocation } from 'react-router';
import { loadStripe } from '@stripe/stripe-js';
import api from '@/api/axios';
import { useAuth } from '@/context/AuthContext';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { usePlaidLink } from '@/hooks/usePlaidLink';
import PageHeader from '@/components/ui/PageHeader';
import Panel from '@/components/ui/Panel';
import {
  earlierMonthsCaption,
  groupVisitsByMonth,
  norfolkMonthValue,
  splitUpcomingVisits,
  visitIsLeftover,
  visitMonthKey,
  visitNeedsShortNoticeWarning,
} from '@/utils/siteVisitMonths';
import {
  buildSiteVisitPayPreview,
  OWNER_PAY_METHOD_COPY,
  payActionLabel,
  payoutKindLabel,
} from '@/utils/siteVisitPayroll';

const PAYMENT_METHOD_LABELS = {
  manual: 'Manual / other',
  zelle: 'Zelle',
  check: 'Check',
  cash_app: 'Cash App Pay',
  ach: 'Bank transfer (ACH)',
  other: 'Other',
};

const STRIPE_PAY_LABELS = {
  cash_app: 'Cash App Pay',
  ach: 'Bank transfer (ACH)',
};

const STATUS_META = {
  pending_approval: { label: 'Scheduling', color: 'bg-amber-100 text-amber-800' },
  approved:         { label: 'Scheduled', color: 'bg-blue-100 text-blue-800' },
  completed:        { label: 'Done', color: 'bg-emerald-100 text-emerald-800' },
  rejected:         { label: 'Rejected', color: 'bg-red-100 text-red-700' },
  cancelled:        { label: 'Cancelled', color: 'bg-slate-100 text-slate-600' },
};

const COMMON_LABELS = {
  kitchen_living: 'Kitchen / living',
  parking: 'Parking lot',
  lawn_porch: 'Front lawn / porch',
};

const PURPOSE_LABELS = {
  routine_inspection: 'Routine inspection',
  maintenance_followup: 'Maintenance follow-up',
  vacant_showing: 'Show vacant room',
};

const PURPOSE_NOTICE = {
  routine_inspection: '24h notice to tenant',
  maintenance_followup: '24h notice to tenant',
  vacant_showing: 'Courtesy inbox to other tenants — same-day OK',
};

function fmtMoney(cents) {
  return `$${(Number(cents) / 100).toFixed(0)}`;
}

function fmtWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function accountNeedsRelink(acct) {
  return acct?.linkStatus === 'needs_relink' || acct?.link_status === 'needs_relink';
}

function visitNeeds24h(visit) {
  return (visit?.roomTargets || []).some(
    (t) => t.tenantId && t.roomPurpose !== 'vacant_showing'
  );
}

function VisitScheduleEditor({
  visit,
  minPlanned,
  minNow,
  busy,
  onReschedule,
  onApprove,
  onCancel,
  showApprove,
  showCancel = true,
  allowReschedule = true,
}) {
  const saved = visit.plannedVisitAtLocal || '';
  const [draft, setDraft] = useState(saved);
  const [open, setOpen] = useState(false);
  const minDatetime = visitNeeds24h(visit) ? minPlanned : minNow;

  useEffect(() => {
    setDraft(saved);
  }, [saved, visit.id]);

  const canChange = ['pending_approval', 'approved'].includes(visit.status);

  if (!canChange) return null;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-3">
        {allowReschedule && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-semibold text-slate-600 hover:text-slate-900"
        >
          {open ? 'Close date' : 'Change date'}
        </button>
        )}
        {showApprove && visit.status === 'pending_approval' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onApprove(visit.id)}
            className="text-xs font-semibold text-violet-700 hover:text-violet-900"
          >
            Approve &amp; send notices
          </button>
        )}
        {showCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onCancel(visit.id)}
            className="text-xs text-slate-500 hover:text-slate-800"
          >
            Cancel
          </button>
        )}
      </div>
      {allowReschedule && open && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-slate-700">
            Visit date (Norfolk)
            <input
              type="datetime-local"
              value={draft}
              min={minDatetime || undefined}
              onChange={(e) => setDraft(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={busy || !draft || draft === saved}
            onClick={() => onReschedule(visit.id, draft)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Save date
          </button>
        </div>
      )}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="flex flex-wrap rounded-lg border border-slate-200 overflow-hidden text-sm w-fit">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`px-3.5 py-1.5 font-medium transition-colors ${
            value === opt.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {opt.label}
          {opt.count != null && (
            <span className={`ml-1.5 text-[11px] ${value === opt.id ? 'text-white/70' : 'text-slate-400'}`}>
              {opt.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function HowVisitsWork({ isOwner }) {
  return (
    <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-600">
      <summary className="cursor-pointer text-xs font-semibold text-slate-700">How visits work</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
        <li>$20 each, up to 5 visits / $100 a month.</li>
        <li>Every visit covers kitchen, parking, and lawn — video at check-in.</li>
        <li>Occupied rooms need 24-hour Norfolk notice. Vacant showings can be same-day.</li>
        {isOwner ? (
          <li>Konstantin is the property manager. Associate pay prefers Cash App (about 30 minutes). Bank transfer stays available if you need it.</li>
        ) : (
          <li>No owner approval. Change or cancel the date anytime.</li>
        )}
        <li>$350 per signed lease, paid after 3 months of rent.</li>
      </ul>
    </details>
  );
}

function extraRooms(visit) {
  return (visit.roomTargets || []).map((r) => r.roomLabel).filter(Boolean);
}


function VisitMonthSection({ month, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen, month.key]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left ${
          month.isCurrent ? 'bg-slate-50' : 'bg-white hover:bg-slate-50'
        }`}
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{month.label}</h3>
            {month.isCurrent && (
              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                This month
              </span>
            )}
            {month.isPaid && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                Paid
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {month.leftoverCount > 0 && month.isPast
              ? `${month.leftoverCount} leftover scheduled`
              : `${month.count} visit${month.count === 1 ? '' : 's'}`}
            {month.isPaid ? ' · already paid' : month.isPast ? ' · closed' : ''}
          </p>
        </div>
        <ChevronDown
          size={18}
          strokeWidth={2}
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {children}
        </ul>
      )}
    </section>
  );
}

function VisitMonthList({ visits, openPast = false, paidMonths = {}, rowProps }) {
  const groups = groupVisitsByMonth(visits, { paidMonths });
  return (
    <div className="space-y-3">
      {groups.map((month) => (
        <VisitMonthSection
          key={month.key}
          month={month}
          defaultOpen={(!month.isPast && month.leftoverCount === 0) || openPast}
        >
          {month.visits.map((visit) => (
            <VisitRow
              key={visit.id}
              visit={visit}
              isOwner={rowProps.isOwner}
              isManager={rowProps.isManager}
              completingId={rowProps.completingId}
              setCompletingId={rowProps.setCompletingId}
              onCompleteDone={rowProps.onCompleteDone}
              busy={rowProps.busyId === visit.id}
              minPlanned={rowProps.minPlanned}
              minNow={rowProps.minNow}
              onReschedule={rowProps.onReschedule}
              onCancel={rowProps.onCancel}
              monthPaid={Boolean(paidMonths[visitMonthKey(visit)])}
            />
          ))}
        </VisitMonthSection>
      ))}
    </div>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function scopeSummary(visit) {
  const parts = [];
  (visit.scopeCommon || []).forEach((k) => parts.push(COMMON_LABELS[k] || k));
  (visit.roomTargets || []).forEach((r) => {
    const purpose = PURPOSE_LABELS[r.roomPurpose] || r.roomPurpose;
    parts.push(`${r.roomLabel} (${purpose})`);
  });
  return parts.join(', ') || '—';
}

function MediaProof({ item }) {
  if (!item?.photoUrl) return null;
  if (item.mediaType === 'video') {
    return (
      <video
        src={item.photoUrl}
        controls
        className="h-20 w-28 rounded border object-cover bg-black"
        preload="metadata"
      />
    );
  }
  return (
    <a href={item.photoUrl} target="_blank" rel="noreferrer">
      <img src={item.photoUrl} alt="" className="h-14 w-14 rounded border object-cover" />
    </a>
  );
}

function CompleteVisitForm({ visit, onDone, onCancel }) {
  const slots = useMemo(() => {
    const list = [];
    (visit.scopeCommon || []).forEach((key) => {
      list.push({ areaType: 'common', areaKey: key, label: COMMON_LABELS[key] || key, required: true });
    });
    (visit.roomTargets || []).forEach((r) => {
      list.push({ areaType: 'tenant_room', unitId: r.unitId, label: r.roomLabel, required: false });
    });
    return list;
  }, [visit]);

  const [videos, setVideos] = useState({});
  const [previews, setPreviews] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function slotKey(slot) {
    return slot.areaType === 'common' ? `c-${slot.areaKey}` : `r-${slot.unitId}`;
  }

  async function onFile(slot, e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setError('Record or upload a short video (MP4 or MOV) for each area.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError('Each video must be under 25 MB — pan slowly, ~15–30 seconds per area.');
      return;
    }
    setError('');
    const dataUrl = await readFileAsDataUrl(file);
    const k = slotKey(slot);
    setPreviews((p) => ({ ...p, [k]: dataUrl }));
    setVideos((p) => ({ ...p, [k]: dataUrl }));
  }

  async function submit(e) {
    e.preventDefault();
    const payload = slots.map((slot) => {
      const k = slotKey(slot);
      const videoDataUrl = videos[k];
      if (!videoDataUrl) return null;
      return {
        areaType: slot.areaType,
        areaKey: slot.areaKey || undefined,
        unitId: slot.unitId || undefined,
        videoDataUrl,
      };
    }).filter(Boolean);

    if (payload.length < slots.length) {
      setError('Upload one video for each area listed below.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await api.post(`/api/site-visits/${visit.id}/complete`, { photos: payload });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not complete visit.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-slate-900">Check in now</p>
        <p className="text-xs text-slate-600 mt-1">
          Scheduled: <strong>{visit.visitWhen?.at || visit.plannedVisitAtFormatted || 'Today'}</strong>.
          {' '}Record a short video for <strong>each</strong> area below (3 common areas always required).
        </p>
      </div>
      <ul className="space-y-3">
        {slots.map((slot) => {
          const k = slotKey(slot);
          return (
            <li key={k} className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold text-slate-800">
                {slot.label}
                {slot.required && <span className="ml-1 text-emerald-700">(required)</span>}
              </p>
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/*"
                capture="environment"
                onChange={(e) => onFile(slot, e)}
                className="mt-2 w-full text-xs"
              />
              {previews[k] && (
                <video src={previews[k]} controls className="mt-2 max-h-32 w-full rounded border bg-black" />
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? 'Submitting…' : 'Submit visit ($20)'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
          Cancel
        </button>
      </div>
    </form>
  );
}

function RequestVisitForm({ areas, minPlanned, minNow, onDone }) {
  const [note, setNote] = useState('');
  const [plannedVisitAt, setPlannedVisitAt] = useState(minNow || minPlanned || '');
  const [units, setUnits] = useState(new Set());
  const [purposes, setPurposes] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const needs24h = useMemo(() => (
    (areas?.rooms || []).some((r) => {
      if (!units.has(r.unitId)) return false;
      const purpose = purposes[r.unitId] || (r.occupied ? 'routine_inspection' : 'vacant_showing');
      return r.occupied && (purpose === 'routine_inspection' || purpose === 'maintenance_followup');
    })
  ), [areas, units, purposes]);

  const minDatetime = needs24h ? minPlanned : minNow;

  useEffect(() => {
    if (!plannedVisitAt && minDatetime) setPlannedVisitAt(minDatetime);
    else if (needs24h && minPlanned && plannedVisitAt < minPlanned) setPlannedVisitAt(minPlanned);
    else if (!needs24h && minNow && plannedVisitAt < minNow) setPlannedVisitAt(minNow);
  }, [needs24h, minPlanned, minNow, minDatetime, plannedVisitAt]);

  const allCommonKeys = (areas?.common || []).map((a) => a.key);

  function toggleUnit(id, occupied) {
    setUnits((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
        setPurposes((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
      } else {
        n.add(id);
        setPurposes((p) => ({
          ...p,
          [id]: occupied ? 'routine_inspection' : 'vacant_showing',
        }));
      }
      return n;
    });
  }

  function setPurpose(unitId, purpose) {
    setPurposes((p) => ({ ...p, [unitId]: purpose }));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const unitIds = [...units];
      await api.post('/api/site-visits/request', {
        note: note.trim() || undefined,
        plannedVisitAt,
        commonAreas: allCommonKeys,
        unitIds,
        roomSelections: unitIds.map((unitId) => ({
          unitId,
          purpose: purposes[unitId] || 'routine_inspection',
        })),
      });
      window.dispatchEvent(new CustomEvent('api:toast', {
        detail: { message: 'Visit scheduled. Tenants were notified — no owner approval needed.', variant: 'success' },
      }));
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not schedule visit.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-xs text-slate-500">
        Kitchen, parking, and lawn are included every visit (video at check-in).
      </p>
      <div>
        <p className="text-xs font-bold uppercase text-slate-500 mb-2">Add tenant rooms (optional)</p>
        <div className="space-y-2">
          {(areas?.rooms || []).map((r) => {
            const selected = units.has(r.unitId);
            const purpose = purposes[r.unitId] || (r.occupied ? 'routine_inspection' : 'vacant_showing');
            return (
              <div key={r.unitId} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
                <label className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 -mx-1 px-1 py-1 rounded">
                  <input type="checkbox" checked={selected} onChange={() => toggleUnit(r.unitId, r.occupied)} />
                  <span className="font-medium">{r.label}</span>
                  {r.occupied ? (
                    <span className="text-slate-500">— {r.tenantName}</span>
                  ) : (
                    <span className="text-amber-700">— Vacant</span>
                  )}
                </label>
                {selected && (
                  <div className="mt-2 pl-6">
                    {r.occupied ? (
                      <select
                        value={purpose}
                        onChange={(e) => setPurpose(r.unitId, e.target.value)}
                        className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs"
                      >
                        <option value="routine_inspection">Routine inspection</option>
                        <option value="maintenance_followup">Maintenance follow-up</option>
                      </select>
                    ) : (
                      <p className="text-slate-600">Show vacant room to prospective tenant</p>
                    )}
                    <p className="text-slate-500 mt-1">{PURPOSE_NOTICE[purpose]}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <label className="block text-xs font-medium text-slate-700">
        When (Norfolk)
        <span className="block text-slate-500 font-normal mt-0.5">
          {needs24h
            ? 'Occupied rooms need 24 hours. Tenants are notified when you schedule.'
            : 'Same-day is fine for vacant / common-only. Tenants are notified when you schedule.'}
        </span>
        <input
          type="datetime-local"
          value={plannedVisitAt}
          min={minDatetime}
          onChange={(e) => setPlannedVisitAt(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          required
        />
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note for the owner"
        rows={2}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? 'Scheduling…' : 'Schedule visit'}
      </button>
    </form>
  );
}

function parseMonthValue(value) {
  const [year, month] = (value || '').split('-');
  return { year: parseInt(year, 10), month: parseInt(month, 10) };
}

function ManagerPayoutBankSection({ onChanged }) {
  const location = useLocation();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectSetup, setConnectSetup] = useState(null);
  const [openingSetup, setOpeningSetup] = useState(false);
  const [error, setError] = useState('');
  const [relinkAccount, setRelinkAccount] = useState(null);
  const [updateLinkToken, setUpdateLinkToken] = useState(null);
  const [relinkLoading, setRelinkLoading] = useState(false);

  const loadConnectSetup = useCallback(async () => {
    try {
      const { data } = await api.get('/api/site-visits/payout-bank/connect-onboarding');
      setConnectSetup(data);
    } catch {
      setConnectSetup(null);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/site-visits/payout-bank');
      setAccounts(data.accounts || []);
      if ((data.accounts || []).length > 0) {
        await loadConnectSetup();
      } else {
        setConnectSetup(null);
      }
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load payout bank accounts.'));
    } finally {
      setLoading(false);
    }
  }, [loadConnectSetup]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const handlePlaidSuccess = useCallback(async (publicToken, metadata) => {
    const accountId = metadata.accounts[0]?.id;
    if (!accountId) return;
    setConnecting(true);
    setError('');
    try {
      await api.post('/api/site-visits/payout-bank/plaid/exchange', { publicToken, accountId });
      await loadAccounts();
      onChanged?.();
    } catch (e) {
      setError(apiErrorMessage(e, 'Failed to link payout bank account.'));
    } finally {
      setConnecting(false);
    }
  }, [loadAccounts, onChanged]);

  const handleRelinkSuccess = useCallback(async (publicToken) => {
    if (!relinkAccount) return;
    setRelinkLoading(true);
    setError('');
    try {
      await api.post('/api/site-visits/payout-bank/plaid/exchange-update', {
        publicToken,
        bankAccountId: relinkAccount.id,
      });
      setRelinkAccount(null);
      setUpdateLinkToken(null);
      await loadAccounts();
      onChanged?.();
      window.dispatchEvent(new CustomEvent('api:toast', {
        detail: { message: 'Payout bank account reconnected successfully.', variant: 'success' },
      }));
    } catch (e) {
      setError(apiErrorMessage(e, 'Failed to refresh bank connection.'));
    } finally {
      setRelinkLoading(false);
    }
  }, [relinkAccount, loadAccounts, onChanged]);

  const { open: openPlaid, ready: plaidReady, error: plaidError } = usePlaidLink({
    onSuccess: handlePlaidSuccess,
    linkTokenPath: '/api/site-visits/payout-bank/plaid/link-token',
    exchangePath: '/api/site-visits/payout-bank/plaid/exchange',
    returnTo: location.pathname,
    enabled: !loading && accounts.length === 0 && !updateLinkToken,
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
    linkTokenPath: '/api/site-visits/payout-bank/plaid/update-link-token',
    exchangePath: '/api/site-visits/payout-bank/plaid/exchange-update',
    returnTo: location.pathname,
  });

  async function startRelink(acct) {
    setRelinkAccount(acct);
    setError('');
    setRelinkLoading(true);
    try {
      const { data } = await api.post('/api/site-visits/payout-bank/plaid/update-link-token', {
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

  const needsRelinkAccounts = accounts.filter(accountNeedsRelink);

  async function removeAccount(id) {
    setError('');
    try {
      await api.delete(`/api/site-visits/payout-bank/${id}`);
      await loadAccounts();
      onChanged?.();
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not remove bank account.'));
    }
  }

  async function openConnectSetup() {
    setOpeningSetup(true);
    setError('');
    try {
      const { data } = await api.get('/api/site-visits/payout-bank/connect-onboarding');
      if (data.ready) {
        setConnectSetup(data);
        window.dispatchEvent(new CustomEvent('api:toast', {
          detail: { message: 'Stripe payout setup is already complete.', variant: 'success' },
        }));
        return;
      }
      if (data.onboardingUrl) {
        window.open(data.onboardingUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not open Stripe payout setup.'));
    } finally {
      setOpeningSetup(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('connect') === 'done' || params.get('connect') === 'refresh') {
      loadAccounts();
    }
  }, [location.search, loadAccounts]);

  return (
    <Panel title="Payout bank account">
      <p className="text-xs text-slate-600 mb-3">
        Where Instant Payouts land after Jose pays.
      </p>
      {loading ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : (
        <>
          {needsRelinkAccounts.length > 0 && (
            <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-4">
              <p className="text-sm font-semibold text-amber-900">Bank reconnection required</p>
              <p className="mt-1 text-sm text-amber-800">
                Your payout bank login expired or needs to be refreshed. Reconnect before ACH payroll can run.
              </p>
              <div className="mt-3 space-y-2">
                {needsRelinkAccounts.map((acct) => (
                  <div key={acct.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-amber-200 bg-white px-3 py-2">
                    <span className="text-sm text-gray-800">
                      {acct.institutionName} ····{acct.accountMask}
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
          {accounts.length > 0 ? (
            <ul className="space-y-2 mb-3">
              {accounts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs">
                  <span>
                    <strong>{a.institutionName}</strong>
                    {' '}{a.accountName} ····{a.accountMask}
                    {a.isDefault && <span className="ml-2 text-emerald-700">Default</span>}
                    {accountNeedsRelink(a) && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">reconnect needed</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAccount(a.id)}
                    className="text-slate-500 hover:text-red-600"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mb-3">
              No payout bank linked yet. Connect one so the owner knows where to send payment.
            </p>
          )}
          <button
            type="button"
            onClick={() => openPlaid()}
            disabled={!plaidReady || connecting}
            className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {connecting ? 'Linking…' : accounts.length ? 'Link another account' : 'Connect bank via Plaid'}
          </button>
          {accounts.length > 0 && connectSetup && !connectSetup.ready && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="mb-2">
                One more step: complete Stripe payout setup so Jose can pay you via ACH.
              </p>
              <button
                type="button"
                onClick={openConnectSetup}
                disabled={openingSetup}
                className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
              >
                {openingSetup ? 'Opening…' : 'Complete Stripe payout setup'}
              </button>
            </div>
          )}
          {accounts.length > 0 && connectSetup?.ready && (
            <p className="mt-2 text-xs text-emerald-700">Stripe payout setup complete — Instant Payouts enabled.</p>
          )}
        </>
      )}
      {(error || plaidError || relinkPlaidError) && (
        <p className="mt-2 text-xs text-red-600">{error || plaidError || relinkPlaidError}</p>
      )}
    </Panel>
  );
}

function OwnerPayrollPanel() {
  const location = useLocation();
  const [monthValue, setMonthValue] = useState(norfolkMonthValue());
  const [payroll, setPayroll] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash_app');
  const [note, setNote] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [error, setError] = useState('');

  const { year, month } = parseMonthValue(monthValue);

  const payPreview = useMemo(() => buildSiteVisitPayPreview({
    visitCount: payroll?.visitCount || 0,
    visitCents: payroll?.totalCents || 0,
    outstandingCount: payroll?.outstandingCount || 0,
    outstandingCents: payroll?.outstandingCents || 0,
    otherWorkAmount: customAmount,
    monthLabel: payroll?.monthLabel || '',
  }), [payroll, customAmount]);

  const payMethodBlocked = (paymentMethod === 'ach' && (
    !payroll?.propertyBank?.linked
    || !payroll?.payoutBank?.linked
    || payroll?.connectPayoutReady === false
  )) || (paymentMethod === 'cash_app' && (
    !payroll?.cashAppPayAvailable
    || !payroll?.payoutBank?.linked
    || payroll?.connectPayoutReady === false
  ));

  useEffect(() => {
    if (!payroll?.paymentMethods?.length) return;
    setPaymentMethod(
      payroll.paymentMethods.includes('cash_app') ? 'cash_app' : payroll.paymentMethods[0]
    );
  }, [year, month, payroll?.paymentMethods]);

  useEffect(() => {
    if (location.hash === '#pay-konstantin' && !loading) {
      document.getElementById('pay-konstantin')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [location.hash, loading]);

  const loadPayroll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/site-visits/payroll', { params: { year, month } });
      setPayroll(data.payroll);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load payroll summary.'));
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { loadPayroll(); }, [loadPayroll]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('cashapp_payroll') !== '1') return;
    const paymentIntentId = params.get('payment_intent');
    if (!paymentIntentId) return;

    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/api/site-visits/payroll/cashapp/sync', {
          params: { payment_intent: paymentIntentId },
        });
        if (cancelled) return;
        setPayroll(data.payroll);
        if (data.status === 'paid') {
          window.dispatchEvent(new CustomEvent('api:toast', {
            detail: { message: 'Site-visit payroll paid via Cash App Pay.', variant: 'success' },
          }));
        } else if (data.status === 'processing') {
          window.dispatchEvent(new CustomEvent('api:toast', {
            detail: { message: 'Cash App payroll submitted — confirmation may take a moment.', variant: 'success' },
          }));
        } else if (data.failureReason) {
          setError(data.failureReason);
        }
      } catch (e) {
        if (!cancelled) setError(apiErrorMessage(e, 'Could not confirm Cash App payment.'));
      } finally {
        if (!cancelled) {
          window.history.replaceState({}, '', `${location.pathname}${location.hash || ''}`);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [location.search, location.pathname, location.hash]);

  async function cancelProcessing() {
    setCancelling(true);
    setError('');
    try {
      const { data } = await api.post('/api/site-visits/payroll/cancel-processing', { year, month });
      setPayroll(data.payroll);
      window.dispatchEvent(new CustomEvent('api:toast', {
        detail: { message: 'Cancelled in-progress payroll — choose another payment method.', variant: 'success' },
      }));
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not cancel in-progress payroll.'));
    } finally {
      setCancelling(false);
    }
  }

  async function payViaCashApp({ outstanding = false, customAmount: custom, payVisits } = {}) {
    const dueCount = outstanding ? payroll?.outstandingCount : payroll?.visitCount;
    if (!custom && !dueCount) return;
    setPaying(true);
    setError('');
    try {
      const { data } = await api.post('/api/site-visits/payroll/cashapp/create-intent', {
        year,
        month,
        outstanding,
        payVisits,
        customAmount: custom,
        note: note.trim() || undefined,
      }, { skipGlobalError: true });

      const publishableKey = data.publishableKey;
      if (!publishableKey || !data.clientSecret) {
        throw new Error('Cash App Pay is not configured.');
      }

      const stripeJs = await loadStripe(publishableKey);
      if (!stripeJs) throw new Error('Could not load Stripe.');

      const returnUrl = `${window.location.origin}${location.pathname}?cashapp_payroll=1#pay-konstantin`;
      const { error: stripeError } = await stripeJs.confirmCashappPayment(data.clientSecret, {
        payment_method: { type: 'cashapp' },
        return_url: returnUrl,
      });

      if (stripeError) {
        setError(stripeError.message || 'Cash App payment was cancelled.');
      }
    } catch (e) {
      setError(apiErrorMessage(e, 'Cash App Pay could not be started.'));
    } finally {
      setPaying(false);
    }
  }

  async function submitPayroll(e, {
    outstanding = false,
    payVisits = true,
    custom,
  } = {}) {
    e?.preventDefault?.();
    const extra = custom != null ? Number(custom) : 0;
    const hasCustom = Number.isFinite(extra) && extra >= 0.5;
    const payOutstanding = outstanding
      || (payVisits !== false && payroll?.visitCount < 1 && payroll?.outstandingCount > 0);
    const dueCount = payOutstanding ? payroll?.outstandingCount : payroll?.visitCount;
    if (!hasCustom && !dueCount) return;
    if (hasCustom && payVisits === false && extra < 0.5) {
      setError('Enter at least $0.50 for other work.');
      return;
    }
    if (paymentMethod === 'cash_app') {
      await payViaCashApp({
        outstanding: payOutstanding,
        payVisits,
        customAmount: hasCustom ? extra : undefined,
      });
      return;
    }
    setPaying(true);
    setError('');
    try {
      await api.post('/api/site-visits/payroll/pay', {
        year,
        month,
        outstanding: payOutstanding,
        payVisits,
        customAmount: hasCustom ? extra : undefined,
        paymentMethod,
        note: note.trim() || undefined,
      });
      setNote('');
      if (hasCustom) setCustomAmount('');
      await loadPayroll();
      const via = paymentMethod === 'ach' ? 'ACH' : PAYMENT_METHOD_LABELS[paymentMethod] || paymentMethod;
      let message;
      if (hasCustom && payVisits !== false && dueCount) {
        message = `Paid visits plus $${extra.toFixed(2)} other work via ${via}.`;
      } else if (hasCustom) {
        message = `Paid $${extra.toFixed(2)} for other work via ${via}.`;
      } else if (payOutstanding) {
        message = 'Outstanding boots-on-site pay submitted via ACH.';
      } else {
        message = `${payroll.monthLabel} payroll submitted via ACH.`;
      }
      window.dispatchEvent(new CustomEvent('api:toast', {
        detail: { message, variant: 'success' },
      }));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not submit payroll.'));
    } finally {
      setPaying(false);
    }
  }

  function submitPrimaryPay(e) {
    e.preventDefault();
    if (payPreview.primaryAction === 'combined') {
      return submitPayroll(e, {
        outstanding: payPreview.hasOutstandingOnly,
        payVisits: true,
        custom: payPreview.otherDollars,
      });
    }
    if (payPreview.primaryAction === 'other') {
      return submitPayroll(e, { payVisits: false, custom: payPreview.otherDollars });
    }
    if (payPreview.primaryAction === 'visits') {
      return submitPayroll(e, { outstanding: payPreview.hasOutstandingOnly, payVisits: true });
    }
  }

  const history = payroll?.history || [];

  const managerFirst = payroll?.manager?.name?.split(' ')[0] || 'Konstantin';

  return (
    <Panel title={`Pay ${managerFirst}`} id="pay-konstantin">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="text-xs font-medium text-slate-700">
          Pay period
          <input
            type="month"
            value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={loadPayroll}
          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-slate-500">Loading payroll…</p>
      ) : !payroll?.manager ? (
        <p className="text-xs text-slate-500">No property manager on file for this organization.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-2xl font-bold tabular-nums text-slate-900">
              {fmtMoney(
                payroll.alreadyPaid && payPreview.otherCents < 50
                  ? 0
                  : payPreview.headlineCents
              )}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {payroll.alreadyPaid && payPreview.otherCents < 50
                ? `Paid · ${payroll.monthLabel}`
                : payPreview.headline}
              {' · '}{managerFirst}
            </p>
            <p className="mt-2 text-xs text-slate-600">
              His bank:{' '}
              {payroll.payoutBank?.linked
                ? `${payroll.payoutBank.institutionName} ····${payroll.payoutBank.accountMask}`
                : 'not linked'}
              {' · '}Your account:{' '}
              {payroll.propertyBank?.linked ? (
                <>
                  {payroll.propertyBank.institutionName} ····{payroll.propertyBank.accountMask}
                  {accountNeedsRelink(payroll.propertyBank) && (
                    <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">reconnect</span>
                  )}
                </>
              ) : (
                <a href="/admin/finance" className="font-semibold text-violet-700 hover:underline">
                  link in Finance
                </a>
              )}
            </p>
          </div>

          {payroll.propertyBank?.linked && accountNeedsRelink(payroll.propertyBank) && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <strong>Property bank reconnection required</strong> — reconnect under{' '}
              <a href="/admin/finance" className="font-semibold underline">Finance → Property account</a>
              {' '}before ACH payroll, or pay with Cash App Pay (no property bank debit).
            </div>
          )}

          {payroll.processing && payroll.payout && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 space-y-2">
              <p>
                <strong>Payment processing</strong> — ${(payroll.payout.amountCents / 100).toFixed(0)} via{' '}
                {PAYMENT_METHOD_LABELS[payroll.payout.paymentMethod] || payroll.payout.paymentMethod}
                {payroll.payout.paymentMethod === 'ach'
                  ? payroll.processingDetails?.stripeStatus === 'requires_action'
                    ? ` — waiting on microdeposit verification for your property bank${payroll.propertyBank?.accountMask ? ` (····${payroll.propertyBank.accountMask})` : ''}. Cancel below to pay with Cash App Pay from your Cash App account instead.`
                    : ' — ACH is already at the bank (3–5 business days). Next time use Cash App to get him paid in about 30 minutes.'
                  : payroll.payout.paymentMethod === 'cash_app'
                    ? ' — finish confirming in your Cash App app, then refresh.'
                    : '.'}
              </p>
              {payroll.processingDetails?.verificationUrl && (
                <p>
                  <a
                    href={payroll.processingDetails.verificationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-amber-900 underline"
                  >
                    Verify property-bank microdeposits (Stripe)
                  </a>
                </p>
              )}
              {payroll.processingDetails?.canCancel && payroll.stripePayReady && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={payViaCashApp}
                    disabled={paying || cancelling}
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    {paying ? 'Opening Cash App…' : `Pay $${(payroll.payout.amountCents / 100).toFixed(0)} via Cash App Pay instead`}
                  </button>
                  <button
                    type="button"
                    onClick={cancelProcessing}
                    disabled={paying || cancelling}
                    className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {cancelling ? 'Cancelling…' : 'Cancel and choose another method'}
                  </button>
                </div>
              )}
            </div>
          )}

          {payroll.alreadyPaid && payroll.payout && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
              <strong>Paid</strong> via {PAYMENT_METHOD_LABELS[payroll.payout.paymentMethod] || payroll.payout.paymentMethod}
              {payroll.payout.paidAt && ` on ${fmtWhen(payroll.payout.paidAt)}`}
              {payroll.payout.note && ` — ${payroll.payout.note}`}
              {payroll.payout.instantPayoutStatus === 'pending' || payroll.payout.instantPayoutStatus === 'paid' ? (
                <span> · Instant Payout {payroll.payout.instantPayoutStatus === 'paid' ? 'sent to his bank' : 'submitted'}</span>
              ) : payroll.payout.instantPayoutStatus === 'pending_available' ? (
                <span> · Instant Payout waits until Stripe funds are available, then hits his bank</span>
              ) : payroll.payout.instantPayoutError ? (
                <span> · Instant Payout: {payroll.payout.instantPayoutError}</span>
              ) : (
                <span> · Instant Payout to his bank when Stripe releases funds</span>
              )}
            </div>
          )}

          {payroll.connectPayoutReady === false && payroll.payoutBank?.linked && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <strong>Stripe setup pending</strong> — {payroll.manager.name} must complete payout setup on his
              Boots on site page before you can pay via Cash App Pay or ACH.
            </div>
          )}

          {!payroll.connectPayoutReady && !payroll.payoutBank?.linked && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <strong>Manager payout bank required</strong> — Konstantin must link his bank under Boots on site before Stripe payments work.
            </div>
          )}

          {payroll.paymentMethods?.length === 0 && payroll.connectPayoutReady && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <strong>No payment methods available</strong> — enable Cash App Pay in Stripe and link your property account under Finance for ACH.
            </div>
          )}

          {paymentMethod === 'cash_app' && payroll.cashAppPayAvailable === false && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <strong>Cash App Pay not configured</strong> — enable it in Stripe Dashboard → Settings → Payment methods.
            </div>
          )}

          {(!payroll.processing || payroll.processingDetails?.canCancel) && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 space-y-4">
              <p className="text-sm font-semibold text-slate-900">Associate pay</p>
              {payroll.canPay && (
              <p className="text-xs text-slate-600">
                {paymentMethod === 'ach' ? (
                  <>
                    Fallback: bank transfer takes 3–5 business days before Instant Payout.
                  </>
                ) : paymentMethod === 'cash_app' ? (
                  <>
                    Property manager payroll: confirm in Cash App, then Instant Payout to his bank
                    {payroll.payoutBank?.accountMask ? ` (····${payroll.payoutBank.accountMask})` : ''}
                    {' '}in about 30 minutes.
                  </>
                ) : (
                  <>Select a payment method.</>
                )}
              </p>
              )}
              {(payroll.paymentMethods || []).includes('cash_app') && (
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash_app')}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold border ${
                    paymentMethod === 'cash_app'
                      ? 'border-violet-600 bg-violet-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {OWNER_PAY_METHOD_COPY.cash_app.label} · {OWNER_PAY_METHOD_COPY.cash_app.speed}
                </button>
              )}
              {(payroll.paymentMethods || []).includes('ach') && (
                <details className="rounded-lg border border-slate-200 bg-white px-3 py-2" open={paymentMethod === 'ach'}>
                  <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                    Just in case — {OWNER_PAY_METHOD_COPY.ach.label} · {OWNER_PAY_METHOD_COPY.ach.speed}
                  </summary>
                  <p className="mt-2 text-xs text-slate-600">{OWNER_PAY_METHOD_COPY.ach.detail}</p>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('ach')}
                    className={`mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold border ${
                      paymentMethod === 'ach'
                        ? 'border-violet-600 bg-violet-600 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    Use bank transfer
                  </button>
                </details>
              )}
              <label className="block text-xs font-medium text-slate-700">
                Note (optional)
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Visits, extra work, memo…"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <form onSubmit={submitPrimaryPay} className="space-y-3">
                {(payroll.visitCount > 0 || payroll.outstandingCount > 0) && (
                  <p className="text-xs text-slate-700">
                    {payroll.visitCount > 0
                      ? `${payroll.visitCount} unpaid visit${payroll.visitCount === 1 ? '' : 's'} in ${payroll.monthLabel} — ${fmtMoney(payroll.totalCents)}`
                      : `${payroll.outstandingCount} unpaid visit${payroll.outstandingCount === 1 ? '' : 's'} — ${fmtMoney(payroll.outstandingCents)}`}
                  </p>
                )}
                <div className="space-y-2 border-t border-violet-100 pt-3">
                  <p className="text-xs font-semibold text-slate-800">Other work — any amount, anytime</p>
                  <label className="block text-xs font-medium text-slate-700">
                    Amount
                    <input
                      type="number"
                      min="0.50"
                      step="0.01"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      placeholder="0.00"
                      className="mt-1 block w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                {payPreview.canCombine && (
                  <p className="text-xs text-slate-700">{payPreview.combinedDetail} — one payment</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={paying || payPreview.primaryAction === 'none' || payMethodBlocked}
                    className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    {paying ? 'Processing…' : payActionLabel(payPreview, paymentMethod)}
                  </button>
                  {payPreview.canCombine && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => submitPayroll(e, {
                          outstanding: payPreview.hasOutstandingOnly,
                          payVisits: true,
                        })}
                        disabled={paying || payMethodBlocked}
                        className="rounded-lg border border-violet-300 bg-white px-4 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-50 disabled:opacity-50"
                      >
                        Visits only {fmtMoney(payPreview.dueVisitCents)}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => submitPayroll(e, {
                          payVisits: false,
                          custom: payPreview.otherDollars,
                        })}
                        disabled={paying || payMethodBlocked}
                        className="rounded-lg border border-violet-300 bg-white px-4 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-50 disabled:opacity-50"
                      >
                        Other work only {fmtMoney(payPreview.otherCents)}
                      </button>
                    </>
                  )}
                  {payroll.outstandingCount > payroll.visitCount && (
                    <button
                      type="button"
                      onClick={(e) => submitPayroll(e, { outstanding: true, payVisits: true })}
                      disabled={paying || payMethodBlocked}
                      className="rounded-lg border border-violet-300 bg-white px-4 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-50 disabled:opacity-50"
                    >
                      Pay all outstanding {fmtMoney(payroll.outstandingCents)}
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}

          {history.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer font-semibold text-slate-700">
                Payout history ({history.length})
              </summary>
              <ul className="mt-2 rounded-lg border border-slate-200 divide-y divide-slate-100">
                {history.map((p) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                    <span>
                      {p.periodLabel}
                      {' · '}
                      {payoutKindLabel(p)}
                      {' · '}
                      {PAYMENT_METHOD_LABELS[p.paymentMethod] || p.paymentMethod}
                    </span>
                    <span className="font-semibold text-emerald-700">{fmtMoney(p.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </Panel>
  );
}

function OwnerLeaseSigningPanel() {
  const location = useLocation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [payingId, setPayingId] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('cash_app');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: res } = await api.get('/api/manager-compensation/lease-signing');
      setData(res);
      if (res.paymentMethods?.length) {
        setPaymentMethod(
          res.paymentMethods.includes('cash_app') ? 'cash_app' : res.paymentMethods[0]
        );
      }
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load lease-signing pay.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('cashapp_lease_fee') !== '1') return;
    const paymentIntentId = params.get('payment_intent');
    if (!paymentIntentId) return;

    let cancelled = false;
    (async () => {
      try {
        const { data: res } = await api.get('/api/manager-compensation/lease-signing/cashapp/sync', {
          params: { payment_intent: paymentIntentId },
        });
        if (cancelled) return;
        setData(res);
        if (res.status === 'paid') {
          window.dispatchEvent(new CustomEvent('api:toast', {
            detail: { message: 'Lease-signing fee paid via Cash App Pay.', variant: 'success' },
          }));
        } else if (res.status === 'processing') {
          window.dispatchEvent(new CustomEvent('api:toast', {
            detail: { message: 'Cash App payment submitted — fee will mark paid once confirmed.', variant: 'success' },
          }));
        } else if (res.failureReason) {
          setError(res.failureReason);
        }
      } catch (e) {
        if (!cancelled) setError(apiErrorMessage(e, 'Could not confirm Cash App payment.'));
      } finally {
        if (!cancelled) {
          window.history.replaceState({}, '', `${location.pathname}${location.hash || ''}`);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [location.search, location.pathname, location.hash]);

  async function syncFees() {
    setSyncing(true);
    setError('');
    try {
      const { data: res } = await api.post('/api/manager-compensation/lease-signing/sync');
      setData(res);
      window.dispatchEvent(new CustomEvent('api:toast', {
        detail: {
          message: res.created
            ? `Added ${res.created} lease-signing record${res.created === 1 ? '' : 's'} (payable after ${rentMonths} rent months).`
            : 'All signed leases already have records on file.',
          variant: 'success',
        },
      }));
    } catch (e) {
      setError(apiErrorMessage(e, 'Sync failed.'));
    } finally {
      setSyncing(false);
    }
  }

  async function payFee(feeId) {
    setPayingId(feeId);
    setError('');
    try {
      if (paymentMethod === 'cash_app') {
        const { data: intent } = await api.post(
          `/api/manager-compensation/lease-signing/${feeId}/cashapp/create-intent`,
          {},
          { skipGlobalError: true }
        );
        const stripeJs = await loadStripe(intent.publishableKey);
        if (!stripeJs) throw new Error('Could not load Stripe.');
        const returnUrl = `${window.location.origin}${location.pathname}?cashapp_lease_fee=1#pay-konstantin`;
        const { error: stripeError } = await stripeJs.confirmCashappPayment(intent.clientSecret, {
          payment_method: { type: 'cashapp' },
          return_url: returnUrl,
        });
        if (stripeError) {
          setError(stripeError.message || 'Cash App payment was cancelled.');
        }
      } else {
        await api.post(`/api/manager-compensation/lease-signing/${feeId}/pay`, { paymentMethod });
        await load();
        window.dispatchEvent(new CustomEvent('api:toast', {
          detail: { message: 'Lease-signing ACH submitted — settles in 4–5 business days.', variant: 'success' },
        }));
      }
    } catch (e) {
      setError(apiErrorMessage(e, 'Payment could not be started.'));
    } finally {
      setPayingId(null);
    }
  }

  const owed = (data?.fees || []).filter((f) => f.status === 'owed');
  const pending = (data?.fees || []).filter((f) => f.status === 'pending_rent');
  const cancelled = (data?.fees || []).filter((f) => f.status === 'cancelled');
  const paid = (data?.fees || []).filter((f) => f.status === 'paid');
  const amount = data?.policy?.amountPerLease ?? 350;
  const rentMonths = data?.policy?.rentMonthsRequired ?? 3;

  return (
    <Panel title="Lease signing pay">
      <details className="mb-3 text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-700">When the $350 is due</summary>
        <p className="mt-2">
          Konstantin earns ${amount} per signed lease after the tenant has paid{' '}
          <strong>{rentMonths} months of rent</strong>. Sync signed leases to add records.
        </p>
      </details>
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={syncFees}
          disabled={syncing}
          className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Sync signed leases'}
        </button>
        {(data?.paymentMethods || []).length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-medium text-slate-700">Pay with</span>
            {data.paymentMethods.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPaymentMethod(m)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold border ${
                  paymentMethod === m
                    ? 'border-violet-600 bg-violet-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {OWNER_PAY_METHOD_COPY[m]
                  ? `${OWNER_PAY_METHOD_COPY[m].label} · ${OWNER_PAY_METHOD_COPY[m].speed}`
                  : STRIPE_PAY_LABELS[m] || m}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-700">
            <strong>{owed.length} ready</strong>
            {owed.length > 0 ? ` · ${fmtMoney(data?.summary?.owedCents ?? 0)}` : ''}
            {' · '}{pending.length} waiting on rent
            {' · '}{paid.length} paid
          </p>

          {pending.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-bold uppercase text-slate-500 mb-2">Waiting for rent ({rentMonths} months)</p>
              <ul className="rounded-lg border border-slate-200 bg-slate-50 divide-y divide-slate-100 text-xs">
                {pending.map((f) => (
                  <li key={f.id} className="px-3 py-2">
                    <strong>{f.tenantName || f.tenantEmail}</strong>
                    {' · '}
                    {f.unitNumber}
                    {' · '}
                    <span className="text-amber-800 font-medium">
                      {f.rentMonthsPaid}/{rentMonths} rent months paid
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {cancelled.length > 0 && (
            <details className="mb-4">
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                Not payable — left early ({cancelled.length})
              </summary>
              <ul className="rounded-lg border border-slate-200 divide-y divide-slate-100 text-xs text-slate-500">
                {cancelled.map((f) => (
                  <li key={f.id} className="px-3 py-2">
                    <strong className="text-slate-700">{f.tenantName || f.tenantEmail}</strong>
                    {' · '}
                    {f.unitNumber}
                    {' · '}
                    {f.rentMonthsPaid}/{rentMonths} rent months
                    {f.cancelReason && (
                      <span className="block text-slate-400 mt-0.5">{f.cancelReason}</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {owed.length > 0 && (
            <ul className="rounded-lg border border-amber-200 bg-amber-50/50 divide-y divide-amber-100 text-xs mb-4">
              {owed.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    <strong>{f.tenantName || f.tenantEmail}</strong>
                    {' · '}
                    {f.unitNumber}
                    {f.signedAt && ` · signed ${fmtWhen(f.signedAt)}`}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={payingId === f.id || !data?.paymentMethods?.length}
                      onClick={() => payFee(f.id)}
                      className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      {payingId === f.id
                        ? 'Processing…'
                        : paymentMethod === 'cash_app'
                          ? `Pay ${fmtMoney(f.amountCents)} via Cash App Pay`
                          : `Pay ${fmtMoney(f.amountCents)} via ACH`}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {owed.length === 0 && pending.length === 0 && (
            <p className="text-xs text-slate-500 mb-3">Nothing ready to pay yet.</p>
          )}

          {paid.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                Paid lease fees ({paid.length})
              </summary>
              <ul className="mt-2 rounded-lg border border-slate-200 divide-y divide-slate-100 text-xs">
                {paid.slice(0, 8).map((f) => (
                  <li key={f.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                    <span>
                      {f.tenantName || f.tenantEmail} · {f.unitNumber}
                      {f.paidAt && ` · ${fmtWhen(f.paidAt)}`}
                    </span>
                    <span className="font-semibold text-emerald-700">{fmtMoney(f.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </Panel>
  );
}

function ManagerLeaseSigningPanel() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/api/manager-compensation/lease-signing')
      .then((r) => setData(r.data))
      .catch(() => setData(null));
  }, []);

  if (!data) return null;

  return (
    <Panel title="Lease signing">
      <p className="text-sm text-slate-700">
        ${data.policy?.amountPerLease ?? 350} after {data.policy?.rentMonthsRequired ?? 3} rent months
        {' · '}
        <strong>{data.summary?.owedCount ?? 0} ready</strong>
        {' · '}{data.summary?.pendingCount ?? 0} waiting
        {' · '}{data.summary?.paidCount ?? 0} paid
      </p>
    </Panel>
  );
}

function ManagerEarningsPanel() {
  const [monthValue, setMonthValue] = useState(norfolkMonthValue());
  const [payroll, setPayroll] = useState(null);
  const [loading, setLoading] = useState(true);

  const { year, month } = parseMonthValue(monthValue);

  const loadPayroll = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/site-visits/payroll', { params: { year, month } });
      setPayroll(data.payroll);
    } catch {
      setPayroll(null);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { loadPayroll(); }, [loadPayroll]);

  if (loading) return null;

  return (
    <Panel title="Your earnings">
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="text-xs font-medium text-slate-700">
          Month
          <input
            type="month"
            value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
      </div>
      <p className="text-2xl font-bold tabular-nums text-slate-900">
        {fmtMoney((payroll?.outstandingCents ?? payroll?.totalCents) || 0)}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">
        {payroll?.visitCount ?? 0} completed
        {payroll?.outstandingCount > 0
          ? ` · ${payroll.outstandingCount} unpaid`
          : payroll?.alreadyPaid ? ' · paid' : ' · awaiting payout'}
        {payroll?.monthLabel ? ` · ${payroll.monthLabel}` : ''}
      </p>
      {payroll?.alreadyPaid && payroll.payout && (
        <p className="mt-3 text-xs text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">
          {payroll.monthLabel} marked paid via {PAYMENT_METHOD_LABELS[payroll.payout.paymentMethod] || payroll.payout.paymentMethod}
          {payroll.payout.paidAt && ` on ${fmtWhen(payroll.payout.paidAt)}`}.
        </p>
      )}
    </Panel>
  );
}

function sectionFromHash(hash) {
  if (hash === '#pay-konstantin') return 'pay';
  if (hash === '#lease-signing') return 'lease';
  return 'visits';
}

function hashForSection(section) {
  if (section === 'pay') return '#pay-konstantin';
  if (section === 'lease') return '#lease-signing';
  return '';
}

function VisitRow({
  visit,
  isOwner,
  isManager,
  completingId,
  setCompletingId,
  onCompleteDone,
  busy,
  minPlanned,
  minNow,
  onReschedule,
  onCancel,
  monthPaid = false,
}) {
  const [showProof, setShowProof] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const leftover = visitIsLeftover(visit);
  const pastMonth = leftover;
  const meta = leftover
    ? { label: 'Leftover', color: 'bg-slate-100 text-slate-600' }
    : (STATUS_META[visit.status] || STATUS_META.cancelled);
  const rooms = extraRooms(visit);
  const photos = visit.photos || [];
  const hasProof = photos.length > 0 || visit.photoUrl;
  const shortNotice = visitNeedsShortNoticeWarning(visit);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${meta.color}`}>
              {meta.label}
            </span>
            <span className="text-sm font-medium text-slate-900">
              {visit.visitWhen?.at || visit.plannedVisitAtFormatted || '—'}
            </span>
            {visit.payoutId ? (
              <span className="text-xs font-semibold text-emerald-700">Paid</span>
            ) : leftover && monthPaid ? (
              <span className="text-xs text-slate-500">Never checked in</span>
            ) : leftover ? (
              <span className="text-xs text-slate-500">Closed</span>
            ) : (
              <span className="text-sm font-semibold text-emerald-700">${visit.amountDollars}</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {rooms.length ? `Rooms: ${rooms.join(', ')}` : 'Common areas'}
          </p>
          {shortNotice && (
            <p className="mt-0.5 text-xs text-amber-700">Under 24-hour notice</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {isManager && visit.status === 'approved' && !pastMonth && completingId !== visit.id && (
            <button
              type="button"
              onClick={() => setCompletingId(visit.id)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Check in
            </button>
          )}
          {hasProof && (
            <button
              type="button"
              onClick={() => setShowProof((v) => !v)}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              {showProof ? 'Hide proof' : 'Proof'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-800"
          >
            {showDetails ? 'Less' : 'Details'}
          </button>
        </div>
      </div>
      {showDetails && (
        <div className="mt-2 text-xs text-slate-500 space-y-1">
          <p>{scopeSummary(visit)}</p>
          {visit.notices?.length > 0 && (
            <p className="text-violet-700">Tenants notified {fmtWhen(visit.notices[0]?.sent_at)}</p>
          )}
          {isOwner && visit.managerName && <p>{visit.managerName}</p>}
          {visit.requestedNote && <p>Note: {visit.requestedNote}</p>}
        </div>
      )}
      {showProof && (
        <div className="mt-2 flex flex-wrap gap-1">
          {photos.map((p) => (
            <MediaProof key={p.id} item={p} />
          ))}
          {visit.photoUrl && !photos.length && (
            <MediaProof item={{ photoUrl: visit.photoUrl, mediaType: 'photo' }} />
          )}
        </div>
      )}
      {isManager && visit.status === 'approved' && !pastMonth && completingId === visit.id && (
        <CompleteVisitForm
          visit={visit}
          onDone={() => { setCompletingId(null); onCompleteDone(); }}
          onCancel={() => setCompletingId(null)}
        />
      )}
      <VisitScheduleEditor
        visit={visit}
        minPlanned={minPlanned}
        minNow={minNow}
        busy={busy}
        onReschedule={onReschedule}
        onCancel={onCancel}
        showApprove={false}
        allowReschedule={!pastMonth}
      />
    </li>
  );
}

export default function SiteVisitsPage({ portal = 'manager' }) {
  const { user } = useAuth();
  const location = useLocation();
  const isOwner = portal === 'admin' || user?.role === 'owner' || user?.role === 'super_admin';
  const isManager = user?.role === 'property_manager';

  const [data, setData] = useState({ usage: null, visits: [], policy: null });
  const [areas, setAreas] = useState(null);
  const [minPlanned, setMinPlanned] = useState('');
  const [minNow, setMinNow] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [completingId, setCompletingId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showRequest, setShowRequest] = useState(false);
  const [section, setSection] = useState(() => sectionFromHash(location.hash));
  const [visitFilter, setVisitFilter] = useState('upcoming');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [visitsRes, areasRes] = await Promise.all([
        api.get('/api/site-visits'),
        api.get('/api/site-visits/areas'),
      ]);
      setData(visitsRes.data);
      setAreas(areasRes.data.areas);
      setMinPlanned(areasRes.data.minPlannedVisitLocal || '');
      setMinNow(areasRes.data.minVisitNowLocal || '');
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load site visits.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setSection(sectionFromHash(location.hash));
  }, [location.hash]);

  const usage = data.usage;
  const visits = data.visits || [];
  const paidMonths = data.paidMonths || {};
  const currentMonth = norfolkMonthValue();
  const { upcomingNow, upcomingPast } = splitUpcomingVisits(visits, currentMonth);
  const upcomingPastGroups = groupVisitsByMonth(upcomingPast, { currentMonth, paidMonths });
  const done = visits.filter((v) => v.status === 'completed');
  const other = visits.filter((v) => ['cancelled', 'rejected'].includes(v.status));
  const filteredVisits = visitFilter === 'done' ? done : visitFilter === 'more' ? other : upcomingNow;
  const atCap = (usage?.visits_remaining ?? 0) < 1;

  function goSection(next) {
    setSection(next);
    const nextHash = hashForSection(next);
    window.history.replaceState({}, '', `${location.pathname}${location.search}${nextHash}`);
  }

  async function cancel(id) {
    setBusyId(id);
    try {
      await api.post(`/api/site-visits/${id}/cancel`);
      await load();
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api:toast', {
        detail: { message: apiErrorMessage(e, 'Cancel failed.'), variant: 'error' },
      }));
    } finally {
      setBusyId(null);
    }
  }

  async function reschedule(id, plannedVisitAt) {
    setBusyId(id);
    try {
      await api.post(`/api/site-visits/${id}/reschedule`, { plannedVisitAt });
      await load();
      window.dispatchEvent(new CustomEvent('api:toast', {
        detail: { message: 'Visit date updated.', variant: 'success' },
      }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api:toast', {
        detail: { message: apiErrorMessage(e, 'Could not change the visit date.'), variant: 'error' },
      }));
    } finally {
      setBusyId(null);
    }
  }

  const visitRowProps = {
    isOwner,
    isManager,
    completingId,
    setCompletingId,
    onCompleteDone: load,
    busyId,
    minPlanned,
    minNow,
    onReschedule: reschedule,
    onCancel: cancel,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        portal={portal}
        title="Boots on site"
        subtitle={
          isOwner
            ? 'Konstantin schedules on his own. Pay anytime.'
            : 'Schedule and check in — no owner approval.'
        }
        actions={(
          <button
            type="button"
            onClick={load}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        )}
      />

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            <strong className="text-slate-900">{upcomingNow.length} scheduled</strong>
            {' · '}{usage?.visits_remaining ?? 0} left this month
            {' · '}{fmtMoney(usage?.reserved_cents ?? 0)} of $100
            {done.length > 0 ? ` · ${done.length} done` : ''}
          </p>

          <Segmented
            value={section}
            onChange={goSection}
            options={
              isOwner
                ? [
                    { id: 'visits', label: 'Visits', count: upcomingNow.length },
                    { id: 'pay', label: 'Pay' },
                    { id: 'lease', label: 'Leases' },
                  ]
                : [
                    { id: 'visits', label: 'Visits', count: upcomingNow.length },
                    { id: 'pay', label: 'Pay' },
                  ]
            }
          />

          {section === 'visits' && (
            <div className="space-y-4">
              {isManager && (
                <Panel title="Schedule">
                  {atCap ? (
                    <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                      Monthly cap reached (5 / $100). You can still change or cancel a scheduled visit.
                    </p>
                  ) : showRequest ? (
                    <RequestVisitForm
                      areas={areas}
                      minPlanned={minPlanned}
                      minNow={minNow}
                      onDone={() => { setShowRequest(false); load(); }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowRequest(true)}
                      className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      Schedule a visit
                    </button>
                  )}
                </Panel>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented
                  value={visitFilter}
                  onChange={setVisitFilter}
                  options={[
                    { id: 'upcoming', label: 'Upcoming', count: upcomingNow.length },
                    { id: 'done', label: 'Done', count: done.length },
                    { id: 'more', label: 'More', count: other.length },
                  ]}
                />
              </div>

              {visitFilter === 'upcoming' && (
                <div className="space-y-3">
                  {upcomingNow.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                      {isManager ? 'Nothing scheduled this month. Add a visit above.' : 'Nothing scheduled this month.'}
                    </p>
                  ) : (
                    <VisitMonthList visits={upcomingNow} paidMonths={paidMonths} rowProps={visitRowProps} />
                  )}
                  {upcomingPast.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-500">
                        {earlierMonthsCaption(upcomingPastGroups)}
                      </p>
                      <VisitMonthList visits={upcomingPast} paidMonths={paidMonths} rowProps={visitRowProps} />
                    </div>
                  )}
                </div>
              )}

              {visitFilter !== 'upcoming' && (
                filteredVisits.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                    {visitFilter === 'done'
                      ? 'No completed visits in this list.'
                      : 'No cancelled or rejected visits.'}
                  </p>
                ) : (
                  <VisitMonthList visits={filteredVisits} paidMonths={paidMonths} rowProps={visitRowProps} />
                )
              )}

              <HowVisitsWork isOwner={isOwner} />
            </div>
          )}

          {section === 'pay' && (
            <div className="space-y-4">
              {isOwner && <OwnerPayrollPanel />}
              {isManager && (
                <>
                  <ManagerEarningsPanel />
                  <ManagerPayoutBankSection />
                  <ManagerLeaseSigningPanel />
                </>
              )}
            </div>
          )}

          {section === 'lease' && isOwner && <OwnerLeaseSigningPanel />}
        </>
      )}
    </div>
  );
}
