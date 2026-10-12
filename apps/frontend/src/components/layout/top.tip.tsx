'use client';

import { Tooltip } from 'react-tooltip';

// Touch screens have no hover: a tap opens the tooltip and it stays until the
// next tap elsewhere, covering the card it belongs to. Hover labels are only
// shown where there is a real hover.
const canHover = () =>
  typeof window === 'undefined' || !window.matchMedia('(hover: none)').matches;

export const ToolTip = () => {
  return <Tooltip className="z-[200]" id="tooltip" hidden={!canHover()} />;
};
