import React from 'react';
import { SearchX } from 'lucide-react';
import ErrorShell from '@/components/errors/ErrorShell';

export default function NotFoundPage() {
  return (
    <ErrorShell
      title="Page not found"
      message="The link you followed does not match any page in Montero Rentals."
      icon={<SearchX size={28} strokeWidth={1.5} />}
      actions={[
        { label: 'Go home', to: '/', primary: true },
        { label: 'Go to login', to: '/login' },
      ]}
    />
  );
}
