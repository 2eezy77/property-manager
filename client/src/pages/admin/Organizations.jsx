import React from 'react';
import { Landmark } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';

export default function OrganizationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        portal="admin"
        title="Organizations"
        subtitle="Owner organizations and subscription tiers for multi-property portfolios."
      />
      <div className="portal-card p-10 text-center">
        <Landmark size={40} strokeWidth={1.5} className="mx-auto mb-3 text-slate-300" />
        <p className="font-medium text-slate-700">Organization settings coming soon</p>
        <p className="mt-1 text-sm text-slate-400">
          Montero Rentals currently runs as a single org for 743 A Ave.
        </p>
      </div>
    </div>
  );
}
