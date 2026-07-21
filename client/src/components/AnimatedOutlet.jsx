import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';

/** Re-mounts outlet on route change for page enter animation. */
export default function AnimatedOutlet() {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="motion-page">
      <Outlet />
    </div>
  );
}
