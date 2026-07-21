/**
 * App.jsx
 * Defines the complete route tree using React Router v6 createBrowserRouter.
 *
 * AppRoot wraps AuthProvider around all routes so Sidebar/portals always have auth context.
 */

import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';

import AppRoot from '@/components/AppRoot';
import RouteErrorPage from '@/components/RouteErrorPage';
import ProtectedRoute from '@/components/ProtectedRoute';
import PrimaryOwnerRoute from '@/components/PrimaryOwnerRoute';

// Layouts
import TenantLayout  from '@/layouts/TenantLayout';
import ManagerLayout from '@/layouts/ManagerLayout';
import AdminLayout   from '@/layouts/AdminLayout';

// Auth pages
import LoginPage from '@/pages/Login';
import ForgotPasswordPage from '@/pages/ForgotPassword';
import ResetPasswordPage from '@/pages/ResetPassword';
import PrivacyPolicy from '@/pages/PrivacyPolicy';
import TermsOfService from '@/pages/TermsOfService';
import PlaidOAuthReturn from '@/pages/PlaidOAuthReturn';
import RootRedirect from '@/pages/RootRedirect';
import NotFoundPage from '@/pages/NotFoundPage';
import ForbiddenPage from '@/pages/ForbiddenPage';

// Tenant pages
import TenantDashboard   from '@/pages/tenant/Dashboard';
import TenantLease       from '@/pages/tenant/Lease';
import TenantPayments    from '@/pages/tenant/Payments';
import TenantMaintenance from '@/pages/tenant/Maintenance';
import TenantMessages       from '@/pages/tenant/Messages';
import TenantAnnouncements  from '@/pages/tenant/Announcements';
import TenantAccount     from '@/pages/tenant/AccountSettings';

// Manager pages
import ManagerDashboard     from '@/pages/manager/Dashboard';
import ManagerProperties    from '@/pages/manager/Properties';
import ManagerTenants       from '@/pages/manager/Tenants';
import ManagerLeases        from '@/pages/manager/Leases';
import ManagerMaintenance   from '@/pages/manager/MaintenanceQueue';
import ManagerMessages      from '@/pages/manager/Inbox';
import ManagerPayments      from '@/pages/manager/Payments';
import ManagerUtilities     from '@/pages/manager/Utilities';
import ManagerAnnouncements from '@/pages/manager/Announcements';
import ManagerAccount       from '@/pages/manager/AccountSettings';
import ManagerPlaybook      from '@/pages/manager/Playbook';

// Admin pages
import AdminDashboard     from '@/pages/admin/Dashboard';
import AdminOrganizations from '@/pages/admin/Organizations';
import AdminUsers         from '@/pages/admin/Users';
import AdminAudit         from '@/pages/admin/AuditLogs';
import OwnerFinance       from '@/pages/admin/OwnerFinance';
import PortalLaunchCampaign from '@/pages/admin/PortalLaunchCampaign';
import SiteVisits from '@/pages/SiteVisits';

const routeError = { errorElement: <RouteErrorPage /> };

export const router = createBrowserRouter([
  {
    element: <AppRoot />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/', element: <RootRedirect /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/privacy', element: <PrivacyPolicy /> },
      { path: '/terms', element: <TermsOfService /> },
      { path: '/forbidden', element: <ForbiddenPage /> },

      {
        element: <ProtectedRoute />,
        ...routeError,
        children: [
          { path: '/oauth-return', element: <PlaidOAuthReturn /> },
        ],
      },

      {
        element: <ProtectedRoute roles={['tenant']} />,
        ...routeError,
        children: [{
          element: <TenantLayout />,
          ...routeError,
          children: [
            { path: '/tenant',             element: <TenantDashboard /> },
            { path: '/tenant/lease',       element: <TenantLease /> },
            { path: '/tenant/payments',    element: <TenantPayments /> },
            { path: '/tenant/maintenance', element: <TenantMaintenance /> },
            { path: '/tenant/messages',       element: <TenantMessages /> },
            { path: '/tenant/announcements',  element: <TenantAnnouncements /> },
            { path: '/tenant/account',     element: <TenantAccount /> },
          ],
        }],
      },

      {
        element: <ProtectedRoute minRole="property_manager" />,
        ...routeError,
        children: [{
          element: <ManagerLayout />,
          ...routeError,
          children: [
            { path: '/manager',                 element: <ManagerDashboard /> },
            { path: '/manager/properties',      element: <ManagerProperties /> },
            { path: '/manager/tenants',         element: <ManagerTenants /> },
            { path: '/manager/leases',          element: <ManagerLeases /> },
            { path: '/manager/maintenance',     element: <ManagerMaintenance /> },
            { path: '/manager/messages',        element: <ManagerMessages /> },
            { path: '/manager/payments',        element: <ManagerPayments /> },
            { path: '/manager/utilities',       element: <ManagerUtilities /> },
            { path: '/manager/announcements',   element: <ManagerAnnouncements /> },
            { path: '/manager/playbook',        element: <ManagerPlaybook /> },
            { path: '/manager/site-visits',     element: <SiteVisits portal="manager" /> },
            { path: '/manager/account',         element: <ManagerAccount /> },
          ],
        }],
      },

      {
        element: <ProtectedRoute minRole="owner" />,
        ...routeError,
        children: [{
          element: <AdminLayout />,
          ...routeError,
          children: [
            { path: '/admin',                element: <AdminDashboard /> },
            { path: '/admin/finance',        element: <OwnerFinance /> },
            { path: '/admin/users',          element: <AdminUsers /> },
            { path: '/admin/playbook',       element: <ManagerPlaybook /> },
            { path: '/admin/portal-launch',  element: <PortalLaunchCampaign /> },
            { path: '/admin/audit',          element: <Navigate to="/admin/activity" replace /> },
            { path: '/admin/activity',       element: <AdminAudit /> },
            { path: '/admin/site-visits',    element: <SiteVisits portal="admin" /> },
            {
              element: <PrimaryOwnerRoute />,
              children: [
                { path: '/admin/organizations', element: <AdminOrganizations /> },
              ],
            },
          ],
        }],
      },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
