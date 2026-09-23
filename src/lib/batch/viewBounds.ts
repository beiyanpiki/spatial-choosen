import type { BatchAffineMatrix, BatchBounds, BatchPoint } from '@/types/batch';

import { applyAffine } from './affine';

export const boundsCorners = (bounds: BatchBounds): BatchPoint[] => [
  { x: bounds.x, y: bounds.y },
  { x: bounds.x + bounds.width, y: bounds.y },
  { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  { x: bounds.x, y: bounds.y + bounds.height },
];

/** Axis-aligned box that contains `bounds` after the matrix is applied. */
export function transformBounds(bounds: BatchBounds, matrix: BatchAffineMatrix): BatchBounds {
  const corners = boundsCorners(bounds).map((corner) => applyAffine(matrix, corner));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionBounds(left: BatchBounds, right: BatchBounds): BatchBounds {
  const minX = Math.min(left.x, right.x);
  const minY = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function boundsCoverFrame(bounds: BatchBounds): boolean {
  return bounds.width >= 0.999 && bounds.height >= 0.999
    && bounds.x <= 0.0005 && bounds.y <= 0.0005;
}
