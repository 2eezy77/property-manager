import React from 'react';

/** Swipeable horizontal scroll for wide tables on iPhone (see .table-scroll in index.css). */
export default function TableScroll({ children, className = '' }) {
  return (
    <div
      className={`table-scroll table-scroll-edge w-full max-w-full ${className}`}
      tabIndex={0}
      role="region"
      aria-label="Table — swipe sideways to see more columns"
    >
      {children}
    </div>
  );
}
