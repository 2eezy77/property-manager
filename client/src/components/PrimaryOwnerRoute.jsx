import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

/** Platform settings — only the org's primary owner (organizations.owner_id). */
export default function PrimaryOwnerRoute() {
  const { user } = useAuth();
  if (!user?.isPrimaryOwner) {
    return <Navigate to="/admin" replace />;
  }
  return <Outlet />;
}
