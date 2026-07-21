import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '@/api/axios';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { useAuth } from '@/context/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import Panel from '@/components/ui/Panel';
import TableScroll from '@/components/ui/TableScroll';
import UserPasswordModal from '@/components/admin/UserPasswordModal';
import { OnboardingProgress } from '@/components/manager/TenantOnboarding';
import { canPreviewTenantPortal, canPreviewStaffPortal, ROLE_HOME } from '@/utils/roles';

const ROLE_LABEL = {
  owner: 'Owner',
  property_manager: 'Manager',
  tenant: 'Tenant',
};

const ROLE_BADGE = {
  owner: 'bg-violet-100 text-violet-800',
  property_manager: 'bg-emerald-100 text-emerald-800',
  tenant: 'bg-blue-100 text-blue-800',
};

function fmtDate(iso) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function UsersPage() {
  const { user, startImpersonation } = useAuth();
  const navigate = useNavigate();
  const canViewAsTenant = canPreviewTenantPortal(user?.role);
  const canViewAsStaff = canPreviewStaffPortal(user);

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [primaryOwnerId, setPrimaryOwnerId] = useState(null);
  const [passwordUser, setPasswordUser] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data } = await api.get('/api/admin/users');
      setUsers(data.users || []);
      setPrimaryOwnerId(data.primaryOwnerId || null);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load users.'));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter((u) => !roleFilter || u.role === roleFilter);

  async function handleViewAs(target) {
    setBusyId(target.id);
    try {
      const previewUser = await startImpersonation(target.id, '/admin/users');
      const home = ROLE_HOME[previewUser?.role] || '/manager';
      navigate(home);
    } catch (e) {
      window.alert(e.response?.data?.message || 'Could not open preview.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleEmailAllTenantPasswords() {
    if (!window.confirm(
      'Generate a new unique password for each active tenant, email them individually, and BCC you on each send?'
    )) return;
    setBulkBusy(true);
    try {
      const { data } = await api.post('/api/admin/users/tenants/email-passwords');
      const ok = (data.results || []).filter((r) => r.status === 'ok').length;
      const fail = (data.results || []).filter((r) => r.status === 'error').length;
      window.alert(`Done: ${ok} emailed, ${fail} failed.`);
      await load();
    } catch (e) {
      window.alert(apiErrorMessage(e, 'Bulk email failed.'));
    } finally {
      setBulkBusy(false);
    }
  }

  function canSetPassword(u) {
    if (!u.is_active) return false;
    if (u.is_org_primary_owner || u.id === primaryOwnerId) return false;
    if (u.role === 'owner') return false;
    return u.role === 'tenant' || u.role === 'property_manager';
  }

  async function handleResetOnboarding(tenantId, name) {
    if (!window.confirm(`Reset move-in onboarding for ${name}?`)) return;
    setBusyId(tenantId);
    try {
      await api.post(`/api/tenants/${tenantId}/reset-onboarding`);
      await load();
    } catch (e) {
      window.alert(e.response?.data?.message || 'Reset failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        portal="admin"
        title="Users"
        subtitle="Accounts in your organization — preview any portal, reset tenant onboarding, or open the manager roster."
      />

      <div className="flex flex-wrap items-center gap-2">
        {[['', 'All'], ['owner', 'Owners'], ['property_manager', 'Managers'], ['tenant', 'Tenants']].map(([v, l]) => (
          <button
            key={v || 'all'}
            type="button"
            onClick={() => setRoleFilter(v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              roleFilter === v ? 'bg-violet-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {l}
          </button>
        ))}
        <Link
          to="/manager/tenants"
          className="ml-auto text-xs font-semibold text-emerald-700 hover:underline"
        >
          Manager → Tenants (full roster)
        </Link>
      </div>

      <Panel title="Portal passwords" className="!p-5">
        <p className="text-sm text-slate-600 mb-4">
          Set a unique password per person and email it only to them. You are BCC on credential emails.
          When a tenant changes their password in the portal, you receive a staff alert email.
          Your owner account is excluded.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={bulkBusy}
            onClick={handleEmailAllTenantPasswords}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {bulkBusy ? 'Sending…' : 'Generate & email all tenants'}
          </button>
          <Link
            to="/admin/portal-launch"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50"
          >
            Launch emails (welcome + passwords)
          </Link>
        </div>
      </Panel>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {passwordUser && (
        <UserPasswordModal
          user={passwordUser}
          onClose={() => setPasswordUser(null)}
          onSuccess={() => load()}
        />
      )}

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="portal-card p-10 text-center text-sm text-slate-500">No users match this filter.</div>
      ) : (
        <TableScroll className="portal-card !p-0 portal-table">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                {['Name', 'Role', 'Property / unit', 'Onboarding', 'Last login', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((u) => {
                const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;
                const isTenant = u.role === 'tenant';
                const showTenantPreview = isTenant && canViewAsTenant && u.is_active;
                const isPrimaryAccount = u.is_org_primary_owner || u.id === primaryOwnerId;
                const showStaffPreview = !isTenant && canViewAsStaff && u.is_active && u.id !== user?.id
                  && !isPrimaryAccount
                  && (u.role === 'owner' || u.role === 'property_manager');
                const showPassword = canSetPassword(u);
                const hasActions = showTenantPreview || showStaffPreview || isTenant || showPassword;
                return (
                  <tr key={u.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{name}</p>
                      <p className="text-xs text-slate-400">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_BADGE[u.role] || 'bg-slate-100 text-slate-600'}`}>
                        {ROLE_LABEL[u.role] || u.role}
                      </span>
                      {!u.is_active && (
                        <span className="ml-1 text-xs text-red-600">inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {isTenant ? (
                        <>
                          {u.property_name || '—'}
                          {u.unit_number ? <span className="block text-xs text-slate-400">Unit {u.unit_number}</span> : null}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isTenant && u.checkin ? (
                        <OnboardingProgress checkin={u.checkin} compact />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(u.last_login_at)}</td>
                    <td className="px-4 py-3">
                      {hasActions ? (
                        <div className="flex flex-wrap gap-1.5">
                          {showTenantPreview && (
                            <button
                              type="button"
                              disabled={busyId === u.id}
                              onClick={() => handleViewAs(u)}
                              className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                            >
                              View as tenant
                            </button>
                          )}
                          {showStaffPreview && (
                            <button
                              type="button"
                              disabled={busyId === u.id}
                              onClick={() => handleViewAs(u)}
                              className="rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                            >
                              {u.role === 'owner' ? 'View as owner' : 'View as manager'}
                            </button>
                          )}
                          {showPassword && (
                            <button
                              type="button"
                              disabled={busyId === u.id}
                              onClick={() => setPasswordUser(u)}
                              className="rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                            >
                              Set password
                            </button>
                          )}
                          {isTenant && (
                            <button
                              type="button"
                              disabled={busyId === u.id}
                              onClick={() => handleResetOnboarding(u.id, name)}
                              className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                            >
                              Reset onboarding
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
}
