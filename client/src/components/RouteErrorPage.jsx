import React from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Lock, SearchX, ShieldAlert, AlertTriangle, Home } from 'lucide-react';
import ErrorShell from '@/components/errors/ErrorShell';

function formatTechnical(error) {
  if (isRouteErrorResponse(error)) {
    return `${error.status} ${error.statusText}\n${error.data?.message ?? error.data ?? ''}`.trim();
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ''}`;
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function classify(error) {
  const msg = error instanceof Error ? error.message : String(error?.message ?? error ?? '');

  if (msg.includes('useAuth must be used inside')) {
    return {
      title: 'Session not ready',
      message: 'Your session could not be loaded. Sign in again to continue.',
      icon: <Lock size={28} strokeWidth={1.5} />,
      primary: 'login',
    };
  }

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return { title: 'Page not found', message: 'That page does not exist or was moved.', icon: <SearchX size={28} strokeWidth={1.5} />, primary: 'home' };
    }
    if (error.status === 403) {
      return { title: 'Access denied', message: 'You do not have permission to view this page.', icon: <ShieldAlert size={28} strokeWidth={1.5} />, primary: 'home' };
    }
    if (error.status >= 500) {
      return { title: 'Server error', message: 'Something failed on our side. Try again in a moment.', icon: <AlertTriangle size={28} strokeWidth={1.5} />, primary: 'reload' };
    }
  }

  return {
    title: 'Something went wrong',
    message: 'An unexpected error occurred while loading this page.',
    icon: <Home size={28} strokeWidth={1.5} />,
    primary: 'reload',
  };
}

export default function RouteErrorPage() {
  const error = useRouteError();
  const info = classify(error);

  const actions = [
    { label: 'Reload page', onClick: () => window.location.reload(), primary: info.primary === 'reload' },
    { label: 'Go home', to: '/', primary: info.primary === 'home' },
    { label: 'Go to login', to: '/login', primary: info.primary === 'login' },
  ];

  return (
    <ErrorShell
      title={info.title}
      message={info.message}
      icon={info.icon}
      actions={actions}
      technical={formatTechnical(error)}
    />
  );
}
