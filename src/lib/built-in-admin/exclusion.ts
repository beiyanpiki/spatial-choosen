import type {
  ProjectedSpot,
  TissueActivationMatrix,
  TissueActivationValue,
  TissueSelectionSlice,
} from '@/types/built-in-admin';

/**
 * Single source of truth for the capture-area exclusion semantics (user note
 * 2.4 — this behavior may change, keep every exclusion rule in this file).
 *
 * Current semantics: excluded rows/columns never resize the capture box and
 * never compact the grid. They stay in place everywhere (Step 2 heatmap,
 * Step 6 spot projection, exported tissue_positions.csv full grid) but are
 * LOCKED as inactive in every derived view (tissue panel, export): the
 * tissue matrix forces their cells to 0 and selected ids are filtered out.
 *
 * The lock is applied at the view boundary — the persisted tissue selection
 * keeps its raw matrix and ids. Un-excluding a row/column therefore restores
 * the affected spots instead of leaving them permanently zeroed. The helpers
 * below are used by the tissue panel and the export path (see
 * exportBundle.ts getPreprocessZipExportReadiness); lockTissueSelectionSlice
 * remains as the reference implementation of the combined lock for callers
 * that need a whole locked slice at once.
 */

export type ExclusionConfig = {
  excludedRows: number[];
  excludedColumns: number[];
};

export const EMPTY_EXCLUSION_CONFIG: ExclusionConfig = {
  excludedRows: [],
  excludedColumns: [],
};

export const isSpotExcluded = (
  config: ExclusionConfig,
  arrayRow: number,
  arrayCol: number,
): boolean => (
  config.excludedRows.includes(arrayRow) || config.excludedColumns.includes(arrayCol)
);

/** Spot ids (spot.id / barcode) whose array position falls in an excluded row or column. */
export const lockedSpotIds = (
  spots: ProjectedSpot[],
  config: ExclusionConfig,
): Set<string> => {
  const locked = new Set<string>();
  for (const spot of spots) {
    if (isSpotExcluded(config, spot.arrayRow, spot.arrayCol)) {
      locked.add(spot.id);
    }
  }
  return locked;
};

export const filterExcludedFromIds = (
  ids: Iterable<string>,
  locked: Set<string>,
): string[] => {
  const filtered: string[] = [];
  for (const id of ids) {
    if (!locked.has(id)) filtered.push(id);
  }
  return filtered;
};

/** New matrix with every excluded cell forced to 0 (inactive). */
export const applyExclusionLockToMatrix = (
  matrix: TissueActivationMatrix,
  config: ExclusionConfig,
): TissueActivationMatrix => {
  if (config.excludedRows.length === 0 && config.excludedColumns.length === 0) {
    return matrix;
  }

  const values = matrix.values.slice();
  const excludedColumns = new Set(config.excludedColumns);
  const excludedRows = new Set(config.excludedRows);
  for (let arrayRow = 1; arrayRow <= matrix.rows; arrayRow += 1) {
    if (!excludedRows.has(arrayRow)) continue;
    const rowStart = (arrayRow - 1) * matrix.columns;
    for (let col = 1; col <= matrix.columns; col += 1) {
      values[rowStart + col - 1] = 0 as TissueActivationValue;
    }
  }
  for (let arrayRow = 1; arrayRow <= matrix.rows; arrayRow += 1) {
    if (excludedRows.has(arrayRow)) continue;
    const rowStart = (arrayRow - 1) * matrix.columns;
    for (const col of excludedColumns) {
      // Guard against out-of-range values (e.g. from an imported package):
      // assigning past the array end would silently grow the matrix and break
      // every later tissue operation.
      if (!Number.isInteger(col) || col < 1 || col > matrix.columns) continue;
      values[rowStart + col - 1] = 0 as TissueActivationValue;
    }
  }

  return { ...matrix, values };
};

const buildLockedSummary = (selectedIds: string[], totalSpots: number) => {
  const selectedCount = selectedIds.length;
  const selectedPercent = totalSpots > 0 ? (selectedCount / totalSpots) * 100 : 0;
  return {
    selectedCount,
    selectedPercent,
    maskCoverage: selectedPercent,
  };
};

/**
 * Apply the exclusion lock to a whole tissue-selection slice: matrix cells
 * forced to 0, selected/auto-selected ids filtered, parity summary rebuilt.
 * Returns the same slice unchanged when nothing is excluded.
 */
export const lockTissueSelectionSlice = (
  slice: TissueSelectionSlice,
  projectedSpots: ProjectedSpot[],
  config: ExclusionConfig,
): TissueSelectionSlice => {
  if (config.excludedRows.length === 0 && config.excludedColumns.length === 0) {
    return slice;
  }

  const locked = lockedSpotIds(projectedSpots, config);
  if (locked.size === 0) {
    return slice;
  }

  const matrix = slice.matrix
    ? applyExclusionLockToMatrix(slice.matrix, config)
    : null;
  const selectedSpotIds = slice.selectedSpotIds
    ? filterExcludedFromIds(slice.selectedSpotIds, locked)
    : null;
  const autoSelectedSpotIds = filterExcludedFromIds(slice.autoSelectedSpotIds, locked);
  const paritySummary = selectedSpotIds
    ? buildLockedSummary(selectedSpotIds, projectedSpots.length)
    : slice.paritySummary;

  return {
    ...slice,
    matrix,
    selectedSpotIds,
    autoSelectedSpotIds,
    paritySummary,
  };
};
