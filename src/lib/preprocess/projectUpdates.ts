import type {
  PreprocessPoint,
  ProjectedSpot,
  TissueActivationValue,
  TissueSelectionSlice,
} from '@/types/preprocess';

import { selectedSpotIdsFromMatrix } from './tissueMatrix';
import { applyTissueMatrixEdit } from './tissueMatrixEdits';

const buildSelectedCountSummary = (selectedIds: string[], totalSpots: number) => {
  const selectedCount = selectedIds.length;
  const selectedPercent = totalSpots > 0 ? (selectedCount / totalSpots) * 100 : 0;

  return {
    selectedCount,
    selectedPercent,
    maskCoverage: selectedPercent,
  };
};

type ManualTissueSelectionMatrixEditArgs = {
  current: TissueSelectionSlice;
  projectedSpots: ProjectedSpot[];
  editArea?: PreprocessPoint[];
  nextValue?: TissueActivationValue;
  updatedAt: string;
};

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

export function buildManualTissueSelectionState<T extends ManualTissueSelectionMatrixEditArgs>(
  args: T,
): TissueSelectionSlice {
  const { current } = args;
  if (current.matrix === null || !args.editArea || typeof args.nextValue === 'undefined') {
    return current;
  }

  const nextMatrix = applyTissueMatrixEdit({
    matrix: current.matrix,
    projectedSpots: args.projectedSpots,
    editArea: args.editArea,
    nextValue: args.nextValue,
  });

  if (nextMatrix === current.matrix) {
    return current;
  }

  const finalSelectedSpotIds = selectedSpotIdsFromMatrix(nextMatrix, args.projectedSpots);

  return {
    ...current,
    mode: 'matrix',
    matrix: nextMatrix,
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
