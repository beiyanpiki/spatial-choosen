import { pointInRing, ringIntersectsRect } from '@/lib/geometry';
import type {
  BatchPoint,
  BatchRegion,
  BatchSpot,
  BatchSpotAnchorMode,
} from '@/types/batch';

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
  return regions.some((region) => region.points.length >= 3 && pointInRing(point, region.points));
}

export function regionsIntersectRect(
  regions: readonly BatchRegion[],
  rect: SpotRect,
): boolean {
  return regions.some((region) => (
    region.points.length >= 3 && ringIntersectsRect(region.points, rect)
  ));
}

export type SelectBarcodesArgs = {
  spots: readonly BatchSpot[];
  /** Selection polygons in the owning image's full-resolution pixel space. */
  regions: readonly BatchRegion[];
  anchorMode: BatchSpotAnchorMode;
  hitMode: 'center' | 'overlap';
  spotDiameterFullres: number | null;
};

export function selectBarcodes({
  spots,
  regions,
  anchorMode,
  hitMode,
  spotDiameterFullres,
}: SelectBarcodesArgs): string[] {
  if (regions.length === 0) {
    return [];
  }

  const selected: string[] = [];

  for (const spot of spots) {
    const inside = hitMode === 'overlap'
      ? regionsIntersectRect(regions, spotRect(spot, anchorMode, spotDiameterFullres))
      : pointInRegions(spotCenter(spot, anchorMode, spotDiameterFullres), regions);

    if (inside) {
      selected.push(spot.barcode);
    }
  }

  return selected;
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
