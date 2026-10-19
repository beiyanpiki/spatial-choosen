import type {
  PreprocessPoint,
  ProjectedSpot,
  TissueActivationValue,
  TissueSelectionSlice,
} from '@/types/preprocess';

import { deriveFilledTissueMatrix } from './tissueFill';
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

type ManualTissueFillEditArgs = {
  current: TissueSelectionSlice;
  projectedSpots: ProjectedSpot[];
  editArea?: PreprocessPoint[];
  nextValue?: TissueActivationValue;
  spotId?: string;
  rows?: number | null;
  columns?: number | null;
  updatedAt: string;
};

const resolveManualFillBaseMatrix = (args: {
  current: TissueSelectionSlice;
  rows?: number | null;
  columns?: number | null;
}) => {
  if (args.current.fillMatrix) {
    return args.current.fillMatrix;
  }

  if (args.current.matrix) {
    return deriveFilledTissueMatrix(args.current.matrix);
  }

  return typeof args.rows === 'number'
    && Number.isInteger(args.rows)
    && args.rows > 0
    && typeof args.columns === 'number'
    && Number.isInteger(args.columns)
    && args.columns > 0
    ? createEmptyMatrix(args.rows, args.columns)
    : null;
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

const toMatrixCellIndex = (
  matrix: { rows: number; columns: number },
  arrayRow: number,
  arrayCol: number,
) => {
  if (
    !Number.isInteger(arrayRow)
    || !Number.isInteger(arrayCol)
    || arrayRow < 1
    || arrayRow > matrix.rows
    || arrayCol < 1
    || arrayCol > matrix.columns
  ) {
    return null;
  }

  return (arrayRow - 1) * matrix.columns + (arrayCol - 1);
};

/**
 * Applies a manual draw/erase edit to the contour-filled matrix. The first
 * edit materializes the fill from the current derivation (or an empty grid
 * when no selection exists yet), freezing it against further automatic
 * re-derivation until detection reruns or the fill is reset.
 *
 * Only `fillMatrix` and `updatedAt` change: the selection pipeline state
 * (status, matrix, selectedSpotIds) belongs to the selection edits.
 */
export function buildManualTissueFillSelectionState(
  args: ManualTissueFillEditArgs,
): TissueSelectionSlice {
  const { current } = args;
  const hasSpotEdit = typeof args.spotId === 'string';
  if (typeof args.nextValue === 'undefined' || (!hasSpotEdit && !args.editArea)) {
    return current;
  }

  const baseMatrix = resolveManualFillBaseMatrix({
    current,
    rows: args.rows,
    columns: args.columns,
  });
  if (baseMatrix === null) {
    return current;
  }

  let nextMatrix = baseMatrix;

  if (hasSpotEdit) {
    const targetSpot = args.projectedSpots.find((spot) => spot.id === args.spotId);
    const index = targetSpot
      ? toMatrixCellIndex(baseMatrix, targetSpot.arrayRow, targetSpot.arrayCol)
      : null;
    if (index === null || baseMatrix.values[index] === args.nextValue) {
      return current;
    }

    nextMatrix = {
      rows: baseMatrix.rows,
      columns: baseMatrix.columns,
      values: baseMatrix.values.map((value, valueIndex) => (
        valueIndex === index ? args.nextValue as TissueActivationValue : value
      )),
    };
  } else {
    const editArea = args.editArea as PreprocessPoint[];
    nextMatrix = applyTissueMatrixEdit({
      matrix: baseMatrix,
      projectedSpots: args.projectedSpots,
      editArea,
      nextValue: args.nextValue,
    });
  }

  if (nextMatrix === baseMatrix) {
    return current;
  }

  return {
    ...current,
    fillMatrix: nextMatrix,
    updatedAt: args.updatedAt,
  };
}

/**
 * Drops a materialized fill matrix so the fill goes back to tracking the
 * detected selection contour automatically.
 */
export function buildResetTissueFillSelectionState(args: {
  current: TissueSelectionSlice;
  updatedAt: string;
}): TissueSelectionSlice {
  if (args.current.fillMatrix == null) {
    return args.current;
  }

  return {
    ...args.current,
    fillMatrix: null,
    updatedAt: args.updatedAt,
  };
}
