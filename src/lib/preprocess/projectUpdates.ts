import type { ProjectedSpot, TissueRegion, TissueSelectionSlice } from '@/types/preprocess';
import { buildSelectedCountSummary, deriveSelectedSpotIdsFromRegions } from './tissueRegions';

export function buildUpdatedProjectSnapshot<T extends { updatedAt: string }>(
  current: T,
  updater: (current: T) => T,
  updatedAt: string,
): T {
  const nextProject = updater(current);
  if (nextProject === current) {
    return current;
  }

  return {
    ...nextProject,
    updatedAt,
  };
}

export function buildManualTissueSelectionState(args: {
  current: TissueSelectionSlice;
  projectedSpots: ProjectedSpot[];
  nextRegions: TissueRegion[];
  updatedAt: string;
}): TissueSelectionSlice {
  const finalSelectedSpotIds = args.nextRegions.length > 0
    ? deriveSelectedSpotIdsFromRegions(args.nextRegions, args.projectedSpots)
    : [];

  return {
    ...args.current,
    mode: 'polygon',
    regions: args.nextRegions,
    autoSelectedSpotIds: args.nextRegions.length > 0 ? args.current.autoSelectedSpotIds : [],
    selectedSpotIds: finalSelectedSpotIds,
    paritySummary: buildSelectedCountSummary(finalSelectedSpotIds, args.projectedSpots.length),
    overrideNotice: null,
    status: 'complete',
    isStale: false,
    updatedAt: args.updatedAt,
    warning: null,
    error: null,
  };
}
