import React from 'react';
import { Outlet } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import ApiNotifier from '@/components/ApiNotifier';

/**
 * Root layout: AuthProvider must wrap all routed UI (portals, Sidebar, login).
 * Fixes useAuth crashes when provider was only outside RouterProvider.
 */
export default function AppRoot() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ApiNotifier />
        <Outlet />
      </AuthProvider>
    </ErrorBoundary>
  );
}
