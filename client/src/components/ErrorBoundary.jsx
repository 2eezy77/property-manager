import React from 'react';
import { Lock, Home } from 'lucide-react';
import ErrorShell from '@/components/errors/ErrorShell';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const msg = error?.message ?? '';
    const isAuth = msg.includes('useAuth must be used inside');

    return (
      <ErrorShell
        title={isAuth ? 'Session not ready' : 'Something went wrong'}
        message={
          isAuth
            ? 'Your session could not be loaded. Sign in again to continue.'
            : 'The app ran into a problem while rendering this view.'
        }
        icon={isAuth ? <Lock size={28} strokeWidth={1.5} /> : <Home size={28} strokeWidth={1.5} />}
        actions={[
          { label: 'Reload page', onClick: () => window.location.reload(), primary: true },
          { label: 'Go to login', to: '/login' },
          { label: 'Go home', to: '/' },
        ]}
        technical={
          error instanceof Error
            ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
            : String(error)
        }
      />
    );
  }
}
