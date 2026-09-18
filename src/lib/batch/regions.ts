import type {
  BatchAffineMatrix,
  BatchImageSize,
  BatchPoint,
  BatchRegion,
  BatchSimilarityParams,
} from '@/types/batch';

import {
  applyAffine,
  invertAffine,
  normalizedToPixelPoints,
  similarityNormalizedMatrix,
} from './affine';

let regionSequence = 0;

export const MIN_REGION_POINTS = 3;

export function createRegionId(prefix = 'region'): string {
  regionSequence += 1;
  return `${prefix}-${regionSequence.toString(36)}`;
}

export function isRegionUsable(points: readonly BatchPoint[]): boolean {
  return points.length >= MIN_REGION_POINTS;
}

export function createRegion(points: readonly BatchPoint[]): BatchRegion | null {
  if (!isRegionUsable(points)) return null;

  return {
    id: createRegionId(),
    points: points.map((point) => ({ x: point.x, y: point.y })),
  };
}

export function cloneRegions(regions: readonly BatchRegion[]): BatchRegion[] {
  return regions.map((region) => ({
    id: region.id,
    points: region.points.map((point) => ({ x: point.x, y: point.y })),
  }));
}

export function transformRegions(
  regions: readonly BatchRegion[],
  matrix: BatchAffineMatrix,
): BatchRegion[] {
  return regions.map((region) => ({
    id: region.id,
    points: region.points.map((point) => applyAffine(matrix, point)),
  }));
}

/**
 * Maps reference-frame regions into a package's own normalized frame.
 *
 * Step 2 solves `moving -> reference`, so projecting the reference selection
 * into a package requires the inverse of that similarity transform.
 */
export function mapReferenceRegionsToPackage(
  referenceRegions: readonly BatchRegion[],
  params: BatchSimilarityParams,
): BatchRegion[] {
  const matrix = invertAffine(similarityNormalizedMatrix(params));
  if (!matrix) return [];

  return transformRegions(referenceRegions, matrix);
}

export function regionsToPixelSpace(
  regions: readonly BatchRegion[],
  size: BatchImageSize,
): BatchRegion[] {
  return regions.map((region) => ({
    id: region.id,
    points: normalizedToPixelPoints(region.points, size),
  }));
}

export function isPointInRing(point: BatchPoint, ring: readonly BatchPoint[]): boolean {
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const last = ring[previous];
    const crossesRay = current.y > point.y !== last.y > point.y
      && point.x < ((last.x - current.x) * (point.y - current.y)) / (last.y - current.y) + current.x;

    if (crossesRay) inside = !inside;
  }

  return inside;
}

/**
 * Erase tool hit test: a stroke removes every region it passes through or
 * fully covers, which keeps the interaction predictable for freehand input.
 */
export function regionsTouchedByStroke(
  regions: readonly BatchRegion[],
  stroke: readonly BatchPoint[],
): Set<string> {
  const touched = new Set<string>();
  if (stroke.length === 0) return touched;

  for (const region of regions) {
    if (!isRegionUsable(region.points)) continue;
    if (stroke.some((point) => isPointInRing(point, region.points))) {
      touched.add(region.id);
      continue;
    }

    if (region.points.some((point) => isPointInRing(point, stroke) && stroke.length >= 3)) {
      touched.add(region.id);
    }
  }

  return touched;
}
