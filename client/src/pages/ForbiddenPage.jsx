import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import ErrorShell from '@/components/errors/ErrorShell';

export default function ForbiddenPage() {
  const [params] = useSearchParams();
  const message = params.get('msg')
    || 'You do not have permission to view or change this resource.';

  return (
    <ErrorShell
      title="Access denied"
      message={message}
      icon={<ShieldAlert size={28} strokeWidth={1.5} />}
      actions={[
        { label: 'Go home', to: '/', primary: true },
        { label: 'Go to login', to: '/login' },
      ]}
    />
  );
}
