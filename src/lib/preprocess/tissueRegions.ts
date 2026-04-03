import { regionIntersectsRect } from '@/lib/geometry';
import type { Region } from '@/types/project';
import type { ProjectedSpot, TissueRegion, TissueSelectionSlice } from '@/types/preprocess';

type TissueParitySummary = NonNullable<TissueSelectionSlice['paritySummary']>;

export function normalizeTissueRegion(region: TissueRegion): TissueRegion {
  return {
    ...region,
    paths: region.paths?.length ? region.paths : [region.points],
  };
}

const toGeometryRegion = (region: TissueRegion): Region => {
  const normalized = normalizeTissueRegion(region);
  return {
    id: normalized.id,
    label: 0,
    color: normalized.color,
    points: normalized.points,
    paths: normalized.paths,
  };
};

export function deriveSelectedSpotIdsFromRegions(
  regions: TissueRegion[],
  projectedSpots: ProjectedSpot[],
): string[] {
  if (regions.length === 0) {
    return [];
  }

  const geometryRegions = regions.map(toGeometryRegion);

  return projectedSpots
    .filter((spot) => geometryRegions.some((region) => regionIntersectsRect(region, {
      x: spot.x - spot.diameterX / 2,
      y: spot.y - spot.diameterY / 2,
      width: spot.diameterX,
      height: spot.diameterY,
    })))
    .map((spot) => spot.id);
}

export function buildSelectedCountSummary(selectedIds: string[], totalSpots: number): TissueParitySummary {
  const selectedCount = selectedIds.length;
  const selectedPercent = totalSpots > 0 ? (selectedCount / totalSpots) * 100 : 0;

  return {
    selectedCount,
    selectedPercent,
    maskCoverage: selectedPercent,
  };
}
