import React from 'react';
import { Navigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ROLE_HOME } from '@/utils/roles';

export default function RootRedirect() {
  const { user, status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="login-mesh flex h-screen flex-col items-center justify-center text-white">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
          <Building2 size={26} strokeWidth={2} />
        </div>
        <p className="mt-4 text-sm font-semibold">Montero Rentals</p>
        <div className="mt-6 h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={ROLE_HOME[user.role] ?? '/login'} replace />;
}
