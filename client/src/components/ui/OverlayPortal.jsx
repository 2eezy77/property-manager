import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders modals/drawers on document.body so fixed positioning is viewport-wide
 * (not clipped by main overflow or motion-page transform).
 */
export default function OverlayPortal({ children }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(children, document.body);
}
