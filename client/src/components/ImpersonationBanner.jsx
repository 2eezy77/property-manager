import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
const PORTAL_LABEL = {
  tenant: 'tenant portal',
  property_manager: 'manager portal',
  owner: 'owner console',
};

export default function ImpersonationBanner() {
  const { impersonation, exitImpersonation } = useAuth();
  const navigate = useNavigate();

  if (!impersonation) return null;

  const preview = impersonation.tenantUser;
  const name = [preview?.firstName, preview?.lastName]
    .filter(Boolean)
    .join(' ') || preview?.email || 'User';
  const portal = PORTAL_LABEL[preview?.role] || 'portal';
  const isTenant = preview?.role === 'tenant';

  async function handleExit() {
    const path = await exitImpersonation();
    navigate(path || '/admin/users', { replace: true });
  }

  return (
    <div className="sticky top-0 z-[100] flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 shadow-sm safe-top sm:flex-nowrap sm:gap-3">
      <p className="min-w-0 truncate">
        <span className="font-semibold">Previewing {portal}:</span>{' '}
        {name}
        <span className="hidden sm:inline text-amber-800/80">
          {isTenant && impersonation.ownerUser?.role === 'property_manager'
            ? ' — history only, no bank or pay actions'
            : ' — what they see (1 hour)'}
        </span>
      </p>
      <button
        type="button"
        onClick={handleExit}
        className="shrink-0 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-950"
      >
        Exit preview
      </button>
    </div>
  );
}
