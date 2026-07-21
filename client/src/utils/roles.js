/**
 * roles.js
 * Single source of truth for role names, rank hierarchy, and portal routing.
 * Mirror of the server-side ROLE_RANK in authorize.js.
 */

import { LayoutDashboard, Wrench, Home } from 'lucide-react';

export const ROLES = /** @type {const} */ ({
  SUPER_ADMIN:       'super_admin',
  OWNER:             'owner',
  PROPERTY_MANAGER:  'property_manager',
  TENANT:            'tenant',
});

/** Numeric rank — higher = more privileged */
export const ROLE_RANK = {
  super_admin:       40,
  owner:             30,
  property_manager:  20,
  tenant:            10,
};

/**
 * Where to redirect a user immediately after login, by role.
 * Each maps to the root of that portal's route tree.
 */
export const ROLE_HOME = {
  super_admin:       '/admin',
  owner:             '/admin',
  property_manager:  '/manager',
  tenant:            '/tenant',
};

/** Portal display metadata for post-login reveal animation */
export const PORTAL_META = {
  super_admin: {
    id:       'owner',
    label:    'Owner',
    title:    'Owner Console',
    subtitle: 'Portfolio overview & billing',
    icon:     LayoutDashboard,
    gradient: 'from-violet-600 via-indigo-600 to-indigo-900',
    glow:     'shadow-violet-500/40',
    ring:     'ring-violet-400/50',
  },
  owner: {
    id:       'owner',
    label:    'Owner',
    title:    'Owner Console',
    subtitle: 'Portfolio overview & billing',
    icon:     LayoutDashboard,
    gradient: 'from-violet-600 via-indigo-600 to-indigo-900',
    glow:     'shadow-violet-500/40',
    ring:     'ring-violet-400/50',
  },
  property_manager: {
    id:       'manager',
    label:    'Manager',
    title:    'Operations',
    subtitle: 'Maintenance, rent & tenant ops',
    icon:     Wrench,
    gradient: 'from-emerald-600 via-teal-600 to-teal-900',
    glow:     'shadow-emerald-500/40',
    ring:     'ring-emerald-400/50',
  },
  tenant: {
    id:       'tenant',
    label:    'Tenant',
    title:    'My Home',
    subtitle: 'Pay rent & submit requests',
    icon:     Home,
    gradient: 'from-blue-600 via-blue-700 to-indigo-900',
    glow:     'shadow-blue-500/40',
    ring:     'ring-blue-400/50',
  },
};

/** All portals shown in the reveal carousel (order fixed) */
export const REVEAL_PORTALS = [
  { id: 'owner',   match: ['owner', 'super_admin'], label: 'Owner',   icon: LayoutDashboard, accent: 'violet' },
  { id: 'manager', match: ['property_manager'],     label: 'Manager', icon: Wrench,          accent: 'emerald' },
  { id: 'tenant',  match: ['tenant'],               label: 'Tenant',  icon: Home,            accent: 'blue' },
];

/**
 * Returns true if the user's role meets the minimum required rank.
 * @param {string} userRole
 * @param {string} minRole
 */
export function meetsMinRole(userRole, minRole) {
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[minRole] ?? Infinity);
}

/** Owner or property manager — can open tenant portal preview. */
export function canPreviewTenantPortal(userRole) {
  return meetsMinRole(userRole, 'property_manager');
}

/** Any org owner — preview manager/co-owner portals (not the primary owner account). */
export function canPreviewStaffPortal(user) {
  return user?.role === 'owner' || user?.role === 'super_admin';
}
