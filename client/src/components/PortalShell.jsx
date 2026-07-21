/**
 * PortalShell — shared layout with slide-out sidebar + toggle (mobile + desktop).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';
import PortalTopBar from '@/components/PortalTopBar';
import AnimatedOutlet from '@/components/AnimatedOutlet';

const SIDEBAR_KEY = 'montero-sidebar-open';

function readSidebarPref() {
  try {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored != null) return stored === 'true';
  } catch { /* private mode */ }
  if (typeof window === 'undefined') return true;
  return !window.matchMedia('(max-width: 1023px)').matches;
}

export default function PortalShell({
  portal,
  navItems,
  navSections,
  maxWidth = 'max-w-7xl',
  bgClass = 'bg-[#f4f6f9]',
  banner = null,
  footer = null,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarPref);
  const { pathname } = useLocation();

  const setOpen = useCallback((next) => {
    setSidebarOpen(next);
    try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch { /* ignore */ }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  useEffect(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) {
      setOpen(false);
    }
  }, [pathname, setOpen]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setOpen]);

  useEffect(() => {
    const isMobile = window.matchMedia('(max-width: 1023px)').matches;
    document.body.style.overflow = isMobile && sidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  const mainLabel =
    portal === 'admin' ? 'Owner portal content'
      : portal === 'manager' ? 'Manager portal content'
        : 'Tenant portal content';

  return (
    <div className={`flex h-[100dvh] overflow-hidden ${bgClass}`}>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      )}

      <Sidebar
        portal={portal}
        navItems={navItems}
        navSections={navSections}
        open={sidebarOpen}
        onClose={() => setOpen(false)}
        onNavigate={() => {
          if (window.matchMedia('(max-width: 1023px)').matches) setOpen(false);
        }}
      />

      <div
        className={`flex min-w-0 flex-1 flex-col overflow-hidden transition-[margin] duration-300 ease-out ${
          sidebarOpen ? 'lg:ml-[260px]' : ''
        }`}
      >
        {banner}
        <PortalTopBar
          portal={portal}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
        />
        <main
          id="main-content"
          tabIndex={-1}
          aria-label={mainLabel}
          className="flex-1 min-h-0 scroll-touch overflow-y-auto overflow-x-hidden overscroll-y-contain outline-none"
        >
          <div className={`mx-auto w-full ${maxWidth} px-4 py-5 sm:px-6 sm:py-8 lg:px-10 safe-bottom`}>
            <AnimatedOutlet />
          </div>
        </main>
      </div>

      {footer}
    </div>
  );
}
