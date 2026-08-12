import type {
  PreprocessPoint,
  ProjectedSpot,
  TissueActivationValue,
  TissueSelectionSlice,
} from '@/types/built-in-admin';

import {
  createEmptyMatrix,
  invertTissueActivationMatrix,
  matrixFromSelectedSpotIds,
  selectedSpotIdsFromMatrix,
} from './tissueMatrix';
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
  spotId?: string;
  rows?: number | null;
  columns?: number | null;
  updatedAt: string;
};

type InvertManualTissueSelectionArgs = {
  current: TissueSelectionSlice;
  projectedSpots: ProjectedSpot[];
  rows?: number | null;
  columns?: number | null;
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
  const hasSpotToggle = typeof args.spotId === 'string';
  if (!hasSpotToggle && (!args.editArea || typeof args.nextValue === 'undefined')) {
    return current;
  }

  const matrix = current.matrix ?? (
    typeof args.rows === 'number'
      && Number.isInteger(args.rows)
      && args.rows > 0
      && typeof args.columns === 'number'
      && Number.isInteger(args.columns)
      && args.columns > 0
      ? createEmptyMatrix(args.rows, args.columns)
      : null
  );

  if (matrix === null) {
    return current;
  }

  let nextMatrix: typeof matrix;
  if (hasSpotToggle) {
    const targetSpot = args.projectedSpots.find((spot) => spot.id === args.spotId);
    if (!targetSpot) {
      return current;
    }

    const selectedSpotIds = new Set(selectedSpotIdsFromMatrix(matrix, args.projectedSpots));
    if (selectedSpotIds.has(targetSpot.id)) {
      selectedSpotIds.delete(targetSpot.id);
    } else {
      selectedSpotIds.add(targetSpot.id);
    }
    nextMatrix = matrixFromSelectedSpotIds({
      rows: matrix.rows,
      columns: matrix.columns,
      projectedSpots: args.projectedSpots,
      selectedSpotIds: [...selectedSpotIds],
    });
  } else {
    if (!args.editArea || typeof args.nextValue === 'undefined') {
      return current;
    }
    nextMatrix = applyTissueMatrixEdit({
      matrix,
      projectedSpots: args.projectedSpots,
      editArea: args.editArea,
      nextValue: args.nextValue,
    });
  }

  if (current.matrix !== null && nextMatrix === matrix) {
    return current;
  }

  if (
    nextMatrix.rows === matrix.rows
    && nextMatrix.columns === matrix.columns
    && nextMatrix.values.every((value, index) => value === matrix.values[index])
  ) {
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

export function buildInvertedTissueSelectionState(
  args: InvertManualTissueSelectionArgs,
): TissueSelectionSlice {
  const { current } = args;
  const matrix = current.matrix ?? (
    typeof args.rows === 'number'
      && Number.isInteger(args.rows)
      && args.rows > 0
      && typeof args.columns === 'number'
      && Number.isInteger(args.columns)
      && args.columns > 0
      ? createEmptyMatrix(args.rows, args.columns)
      : null
  );

  if (matrix === null) {
    return current;
  }

  const nextMatrix = invertTissueActivationMatrix(matrix);
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
