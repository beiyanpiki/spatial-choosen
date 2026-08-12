'use client';

import { Icon } from '@chakra-ui/react';

/**
 * Shared, visually consistent stroke-based SVG icons for the {@link CanvasStage}
 * image-operation toolbar.
 *
 * Every icon uses the same 24x24 viewBox, the same stroke weight, and the same
 * round line caps/joins so the buttons in the Zoom / Rotation / Flip / Reset
 * sections line up pixel-for-pixel regardless of the glyph they represent. This
 * replaces the previous Unicode glyphs (`−`, `+`, `↺`, `⇋`, `⟲`, ...) which
 * rendered at inconsistent em-box sizes across fonts and produced uneven button
 * widths when paired with text labels.
 */

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  boxSize: 4,
  'aria-hidden': true,
};

export const ZoomInIcon = () => (
  <Icon {...ICON_PROPS}>
    <circle cx='11' cy='11' r='7' />
    <line x1='21' y1='21' x2='16.65' y2='16.65' />
    <line x1='11' y1='8' x2='11' y2='14' />
    <line x1='8' y1='11' x2='14' y2='11' />
  </Icon>
);

export const ZoomOutIcon = () => (
  <Icon {...ICON_PROPS}>
    <circle cx='11' cy='11' r='7' />
    <line x1='21' y1='21' x2='16.65' y2='16.65' />
    <line x1='8' y1='11' x2='14' y2='11' />
  </Icon>
);

export const RotateLeftIcon = () => (
  <Icon {...ICON_PROPS}>
    <polyline points='1 4 1 10 7 10' />
    <path d='M3.51 15a9 9 0 1 0 2.13-9.36L1 10' />
  </Icon>
);

export const RotateRightIcon = () => (
  <Icon {...ICON_PROPS}>
    <polyline points='23 4 23 10 17 10' />
    <path d='M20.49 15a9 9 0 1 1-2.12-9.36L23 10' />
  </Icon>
);

export const FlipHorizontalIcon = () => (
  <Icon {...ICON_PROPS}>
    <path d='M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3' />
    <path d='M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3' />
    <line x1='12' y1='2' x2='12' y2='22' strokeDasharray='2 2' />
  </Icon>
);

export const FlipVerticalIcon = () => (
  <Icon {...ICON_PROPS}>
    <path d='M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3' />
    <path d='M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3' />
    <line x1='2' y1='12' x2='22' y2='12' strokeDasharray='2 2' />
  </Icon>
);

export const ResetIcon = () => (
  <Icon {...ICON_PROPS}>
    <polyline points='1 4 1 10 7 10' />
    <path d='M3.51 15a9 9 0 1 0 2.13-9.36L1 10' />
    <polyline points='23 4 23 10 17 10' />
  </Icon>
);
