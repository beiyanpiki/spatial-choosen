import { pointInRing, ringIntersectsRect } from '@/lib/geometry';
import type {
  BatchPoint,
  BatchRegion,
  BatchSpot,
  BatchSpotAnchorMode,
} from '@/types/batch';

import { isPointInRegion } from './regions';

export type SpotRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Resolves the pixel-space centre of a spot.
 *
 * The NATA/`spatial` contract stores `pxl_row_in_fullres` / `pxl_col_in_fullres`
 * as the top-left pixel of the spot square, but some exports store the centre.
 * Both interpretations stay available so a user can match the package at hand.
 */
export function spotCenter(
  spot: BatchSpot,
  anchorMode: BatchSpotAnchorMode,
  spotDiameterFullres: number | null,
): BatchPoint {
  if (anchorMode === 'center' || !spotDiameterFullres) {
    return { x: spot.pxlColInFullres, y: spot.pxlRowInFullres };
  }

  const radius = spotDiameterFullres / 2;
  return {
    x: spot.pxlColInFullres + radius,
    y: spot.pxlRowInFullres + radius,
  };
}

export function spotRect(
  spot: BatchSpot,
  anchorMode: BatchSpotAnchorMode,
  spotDiameterFullres: number | null,
): SpotRect {
  const diameter = spotDiameterFullres && spotDiameterFullres > 0 ? spotDiameterFullres : 0;

  if (anchorMode === 'top-left') {
    return {
      x: spot.pxlColInFullres,
      y: spot.pxlRowInFullres,
      width: diameter,
      height: diameter,
    };
  }

  return {
    x: spot.pxlColInFullres - diameter / 2,
    y: spot.pxlRowInFullres - diameter / 2,
    width: diameter,
    height: diameter,
  };
}

export function pointInRegions(point: BatchPoint, regions: readonly BatchRegion[]): boolean {
  return regions.some((region) => isPointInRegion(point, region));
}

export function regionIntersectsRect(region: BatchRegion, rect: SpotRect): boolean {
  if (region.points.length < 3) return false;
  if (!ringIntersectsRect(region.points, rect)) return false;

  const holes = region.holes ?? [];
  if (holes.length === 0) return true;

  const corners: BatchPoint[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];

  // A spot that sits entirely inside a hole never touches the region.
  return !holes.some((hole) => corners.every((corner) => pointInRing(corner, hole)));
}

export function regionsIntersectRect(
  regions: readonly BatchRegion[],
  rect: SpotRect,
): boolean {
  return regions.some((region) => regionIntersectsRect(region, rect));
}

export type SelectBarcodesArgs = {
  spots: readonly BatchSpot[];
  /** Selection polygons in the owning image's full-resolution pixel space. */
  regions: readonly BatchRegion[];
  anchorMode: BatchSpotAnchorMode;
  hitMode: 'center' | 'overlap';
  spotDiameterFullres: number | null;
};

export type SpotClassification = {
  selectedBarcodes: string[];
  /** Region class per barcode; later regions win, matching the painting order. */
  classByBarcode: Map<string, number>;
};

/**
 * Classifies every spot against the drawn regions.
 *
 * Regions are evaluated in drawing order and later ones overwrite earlier ones,
 * so the topmost polygon decides which colour value a barcode gets.
 */
export function classifyBarcodes({
  spots,
  regions,
  anchorMode,
  hitMode,
  spotDiameterFullres,
}: SelectBarcodesArgs): SpotClassification {
  const classByBarcode = new Map<string, number>();
  const usable = regions.filter((region) => region.points.length >= 3);

  for (const region of usable) {
    for (const spot of spots) {
      const inside = hitMode === 'overlap'
        ? regionIntersectsRect(region, spotRect(spot, anchorMode, spotDiameterFullres))
        : isPointInRegion(spotCenter(spot, anchorMode, spotDiameterFullres), region);

      if (inside) {
        classByBarcode.set(spot.barcode, region.colorId);
      }
    }
  }

  return { selectedBarcodes: [...classByBarcode.keys()], classByBarcode };
}

export function selectBarcodes({
  ...args
}: SelectBarcodesArgs): string[] {
  return classifyBarcodes(args).selectedBarcodes;
}

export function regionsBoundingBox(regions: readonly BatchRegion[]): SpotRect | null {
  const points = regions.flatMap((region) => region.points);
  if (points.length === 0) return null;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
