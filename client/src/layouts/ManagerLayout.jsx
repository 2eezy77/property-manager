import React from 'react';
import {
  LayoutDashboard, Building2, Users, FileText, ClipboardList,
  Wrench, MessageSquare, Banknote, Footprints, Zap, Megaphone, Settings,
} from 'lucide-react';
import PortalShell from '@/components/PortalShell';
import ImpersonationBanner from '@/components/ImpersonationBanner';

const ICON = { size: 18, strokeWidth: 2 };

const NAV_SECTIONS = [
  {
    label: 'Workspace',
    items: [
      { to: '/manager',            icon: <LayoutDashboard {...ICON} />, label: 'Dashboard'  },
      { to: '/manager/properties', icon: <Building2 {...ICON} />,       label: 'Properties' },
      { to: '/manager/tenants',    icon: <Users {...ICON} />,           label: 'Tenants'    },
      { to: '/manager/leases',     icon: <FileText {...ICON} />,        label: 'Leases'     },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/manager/playbook',      icon: <ClipboardList {...ICON} />, label: 'Checklist'     },
      { to: '/manager/maintenance',   icon: <Wrench {...ICON} />,        label: 'Maintenance'   },
      { to: '/manager/messages',      icon: <MessageSquare {...ICON} />, label: 'Inbox'         },
      { to: '/manager/payments',      icon: <Banknote {...ICON} />,      label: 'Payments'      },
      { to: '/manager/site-visits',   icon: <Footprints {...ICON} />,    label: 'Boots on site' },
      { to: '/manager/utilities',     icon: <Zap {...ICON} />,           label: 'Utilities'     },
      { to: '/manager/announcements', icon: <Megaphone {...ICON} />,     label: 'Announcements' },
    ],
  },
  {
    label: 'Settings',
    items: [{ to: '/manager/account', icon: <Settings {...ICON} />, label: 'Account' }],
  },
];

export default function ManagerLayout() {
  return (
    <PortalShell
      portal="manager"
      navSections={NAV_SECTIONS}
      banner={<ImpersonationBanner />}
    />
  );
}
