import React from 'react';
import { Home, CreditCard, Wrench, MessageSquare, Megaphone, FileText, Settings } from 'lucide-react';
import PortalShell from '@/components/PortalShell';
import ImpersonationBanner from '@/components/ImpersonationBanner';

const ICON = { size: 18, strokeWidth: 2 };

const NAV = [
  { to: '/tenant',              icon: <Home {...ICON} />,          label: 'My Home'      },
  { to: '/tenant/payments',     icon: <CreditCard {...ICON} />,    label: 'Payments'     },
  { to: '/tenant/maintenance',  icon: <Wrench {...ICON} />,        label: 'Maintenance'  },
  { to: '/tenant/messages',     icon: <MessageSquare {...ICON} />, label: 'Messages'     },
  { to: '/tenant/announcements', icon: <Megaphone {...ICON} />,    label: 'Announcements' },
  { to: '/tenant/lease',        icon: <FileText {...ICON} />,      label: 'My Lease'     },
  { to: '/tenant/account',      icon: <Settings {...ICON} />,      label: 'Account'      },
];

export default function TenantLayout() {
  return (
    <PortalShell
      portal="tenant"
      navItems={NAV}
      maxWidth="max-w-3xl"
      bgClass="bg-[#f8fafc]"
      banner={<ImpersonationBanner />}
    />
  );
}
