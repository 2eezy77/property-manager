import React, { useMemo } from 'react';
import {
  LayoutDashboard, ScrollText, Footprints, Mail, Wallet, ClipboardCheck, User, Landmark,
} from 'lucide-react';
import PortalShell from '@/components/PortalShell';
import ImpersonationBanner from '@/components/ImpersonationBanner';
import { useAuth } from '@/context/AuthContext';

const ICON = { size: 18, strokeWidth: 2 };

const PORTFOLIO_NAV = [
  { to: '/admin',               icon: <LayoutDashboard {...ICON} />, label: 'Overview' },
  { to: '/admin/activity',      icon: <ScrollText {...ICON} />,      label: 'Activity log' },
  { to: '/admin/site-visits',   icon: <Footprints {...ICON} />,      label: 'Boots on site' },
  { to: '/admin/portal-launch', icon: <Mail {...ICON} />,            label: 'Launch emails' },
  { to: '/admin/finance',       icon: <Wallet {...ICON} />,          label: 'Personal Finance' },
  { to: '/admin/playbook',      icon: <ClipboardCheck {...ICON} />,  label: 'Checklist' },
  { to: '/admin/users',         icon: <User {...ICON} />,            label: 'Users' },
];

const PLATFORM_NAV = [
  { to: '/admin/organizations', icon: <Landmark {...ICON} />, label: 'Organizations' },
];

export default function AdminLayout() {
  const { user } = useAuth();

  const navSections = useMemo(() => {
    const sections = [{ label: 'Portfolio', items: PORTFOLIO_NAV }];
    if (user?.isPrimaryOwner) {
      sections.push({ label: 'Platform', items: PLATFORM_NAV });
    }
    return sections;
  }, [user?.isPrimaryOwner]);

  return (
    <PortalShell
      portal="admin"
      navSections={navSections}
      banner={<ImpersonationBanner />}
    />
  );
}
