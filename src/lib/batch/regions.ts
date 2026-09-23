import polygonClipping from 'polygon-clipping';

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
import { DEFAULT_REGION_COLOR_ID, normalizeRegionColorId } from './regionColors';

type Pair = [number, number];
type Ring = Pair[];
type Polygon = Ring[];
type MultiPolygon = Polygon[];

let regionSequence = 0;

export const MIN_REGION_POINTS = 3;

export function createRegionId(prefix = 'region'): string {
  regionSequence += 1;
  return `${prefix}-${regionSequence.toString(36)}`;
}

export function isRegionUsable(points: readonly BatchPoint[]): boolean {
  return points.length >= MIN_REGION_POINTS;
}

export function createRegion(
  points: readonly BatchPoint[],
  colorId: number = DEFAULT_REGION_COLOR_ID,
): BatchRegion | null {
  if (!isRegionUsable(points)) return null;

  return {
    id: createRegionId(),
    points: points.map((point) => ({ x: point.x, y: point.y })),
    colorId: normalizeRegionColorId(colorId),
  };
}

/** Fills in defaults for regions loaded from older payloads. */
export function normalizeRegion(region: BatchRegion): BatchRegion {
  return {
    id: region.id,
    points: region.points.map((point) => ({ x: point.x, y: point.y })),
    holes: region.holes?.map((hole) => hole.map((point) => ({ x: point.x, y: point.y }))),
    colorId: normalizeRegionColorId(region.colorId),
  };
}

export function cloneRegions(regions: readonly BatchRegion[]): BatchRegion[] {
  return regions.map(normalizeRegion);
}

const mapPoints = (points: readonly BatchPoint[], matrix: BatchAffineMatrix) =>
  points.map((point) => applyAffine(matrix, point));

export function transformRegions(
  regions: readonly BatchRegion[],
  matrix: BatchAffineMatrix,
): BatchRegion[] {
  return regions.map((region) => ({
    id: region.id,
    points: mapPoints(region.points, matrix),
    holes: region.holes?.map((hole) => mapPoints(hole, matrix)),
    colorId: normalizeRegionColorId(region.colorId),
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

/**
 * Maps a package's own regions into the reference frame.
 *
 * Steps 3 and 4 show packages already aligned to the reference, so their stored
 * polygons have to be lifted into the frame that is on screen.
 */
export function mapPackageRegionsToReference(
  packageRegions: readonly BatchRegion[],
  params: BatchSimilarityParams,
): BatchRegion[] {
  return transformRegions(packageRegions, similarityNormalizedMatrix(params));
}

/** Swaps the listed regions for `replacements`, keeping the painting order. */
export function replaceRegions(
  regions: readonly BatchRegion[],
  replacedIds: readonly string[],
  replacements: readonly BatchRegion[],
): BatchRegion[] {
  const replaced = new Set(replacedIds);
  return [...regions.filter((region) => !replaced.has(region.id)), ...replacements];
}

export function regionsToPixelSpace(
  regions: readonly BatchRegion[],
  size: BatchImageSize,
): BatchRegion[] {
  return regions.map((region) => ({
    id: region.id,
    points: normalizedToPixelPoints(region.points, size),
    holes: region.holes?.map((hole) => normalizedToPixelPoints(hole, size)),
    colorId: normalizeRegionColorId(region.colorId),
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

/** True when the point is inside the outline and outside every hole. */
export function isPointInRegion(point: BatchPoint, region: BatchRegion): boolean {
  if (!isRegionUsable(region.points)) return false;
  if (!isPointInRing(point, region.points)) return false;

  return !(region.holes ?? []).some((hole) => isPointInRing(point, hole));
}

/**
 * Cut-out hit test: a stroke removes every region it passes through or fully
 * covers, which keeps the interaction predictable for freehand input.
 */
export function regionsTouchedByStroke(
  regions: readonly BatchRegion[],
  stroke: readonly BatchPoint[],
): Set<string> {
  const touched = new Set<string>();
  if (stroke.length === 0) return touched;

  for (const region of regions) {
    if (!isRegionUsable(region.points)) continue;
    if (stroke.some((point) => isPointInRegion(point, region))) {
      touched.add(region.id);
      continue;
    }

    if (region.points.some((point) => isPointInRing(point, stroke) && stroke.length >= 3)) {
      touched.add(region.id);
    }
  }

  return touched;
}

const toClosedRing = (points: readonly BatchPoint[]): Ring => {
  const ring: Ring = points.map((point) => [point.x, point.y]);
  if (ring.length > 0) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  return ring;
};

const ringToPoints = (ring: Ring): BatchPoint[] => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const isClosed = ring.length > 1 && first[0] === last[0] && first[1] === last[1];
  const open = isClosed ? ring.slice(0, -1) : ring;

  return open.map(([x, y]) => ({ x, y }));
};

const regionToPolygon = (region: BatchRegion): Polygon => [
  toClosedRing(region.points),
  ...(region.holes ?? []).map(toClosedRing),
];

const multiPolygonToRegions = (multi: MultiPolygon, colorId: number): BatchRegion[] =>
  multi
    .map((polygon) => ({
      id: createRegionId(),
      points: ringToPoints(polygon[0]),
      holes: polygon.slice(1).map(ringToPoints).filter((hole) => hole.length >= 3),
      colorId: normalizeRegionColorId(colorId),
    }))
    .filter((region) => region.points.length >= 3);

/**
 * Merges regions into one outline. The merged regions take `colorId`, which is
 * the class the operator had active when merging.
 */
export function unionRegions(
  regions: readonly BatchRegion[],
  colorId: number,
): BatchRegion[] {
  const usable = regions.filter((region) => isRegionUsable(region.points));
  if (usable.length === 0) return [];
  if (usable.length === 1) return [normalizeRegion({ ...usable[0], colorId })];

  const result = polygonClipping.union(
    regionToPolygon(usable[0]) as never,
    ...usable.slice(1).map((region) => regionToPolygon(region) as never),
  ) as unknown as MultiPolygon;

  return multiPolygonToRegions(result, colorId);
}

/** Cuts every `cutter` out of `base`, keeping `base`'s class. */
export function subtractRegions(
  base: BatchRegion,
  cutters: readonly BatchRegion[],
): BatchRegion[] {
  const usableCutters = cutters.filter(
    (region) => region.id !== base.id && isRegionUsable(region.points),
  );
  if (usableCutters.length === 0) return [normalizeRegion(base)];

  const result = polygonClipping.difference(
    regionToPolygon(base) as never,
    ...usableCutters.map((region) => regionToPolygon(region) as never),
  ) as unknown as MultiPolygon;

  return multiPolygonToRegions(result, base.colorId);
}

/**
 * Applies one freehand stroke to a region list.
 *
 * `merge` (the default drawing mode) unions the stroke into the regions that
 * already carry the active class and takes the stroke out of every other class,
 * so a new colour paints over what was underneath instead of blending with it.
 * `cut` carves the stroke out of every region it touches.
 */
export function applyRegionStroke(
  regions: readonly BatchRegion[],
  stroke: BatchRegion,
  tool: 'merge' | 'cut',
  colorId: number,
): BatchRegion[] {
  if (tool === 'cut') {
    return regions.flatMap((region) => (
      regionsTouchedByStroke([region], stroke.points).size > 0
        ? subtractRegions(region, [stroke])
        : [region]
    ));
  }

  const activeColor = regions.filter((region) => region.colorId === colorId);
  const otherColors = regions.filter((region) => region.colorId !== colorId);

  return [
    ...otherColors.flatMap((region) => (
      regionsTouchedByStroke([region], stroke.points).size > 0
        ? subtractRegions(region, [stroke])
        : [region]
    )),
    ...unionRegions([...activeColor, stroke], colorId),
  ];
}
