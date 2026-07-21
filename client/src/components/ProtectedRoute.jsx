import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { meetsMinRole, ROLE_HOME } from '@/utils/roles';

function FullScreenLoader() {
  return (
    <div className="login-mesh flex h-screen flex-col items-center justify-center text-white">
      <div className="motion-loader flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
        <Building2 size={26} strokeWidth={2} />
      </div>
      <p className="mt-4 text-sm font-semibold">Montero Rentals</p>
      <div className="mt-6 h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
    </div>
  );
}

export default function ProtectedRoute({ minRole, roles }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullScreenLoader />;

  if (status === 'unauthenticated' || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={ROLE_HOME[user.role]} replace />;
  }

  if (minRole && !meetsMinRole(user.role, minRole)) {
    return <Navigate to={ROLE_HOME[user.role]} replace />;
  }

  return <Outlet />;
}
