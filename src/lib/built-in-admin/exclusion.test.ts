import { describe, expect, it } from 'vitest';

import type { ProjectedSpot, TissueActivationMatrix, TissueSelectionSlice } from '@/types/built-in-admin';
import {
  applyExclusionLockToMatrix,
  filterExcludedFromIds,
  isSpotExcluded,
  lockedSpotIds,
  lockTissueSelectionSlice,
} from './exclusion';

const makeSpot = (arrayRow: number, arrayCol: number): ProjectedSpot => ({
  id: `${arrayRow}:${arrayCol}`,
  barcode: `${arrayRow}:${arrayCol}`,
  arrayRow,
  arrayCol,
  x: 0.5,
  y: 0.5,
  width: 0.05,
  height: 0.05,
  diameterX: 0.05,
  diameterY: 0.05,
});

const makeSpots = (rows: number, columns: number) => {
  const spots: ProjectedSpot[] = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let col = 1; col <= columns; col += 1) {
      spots.push(makeSpot(row, col));
    }
  }
  return spots;
};

const makeMatrix = (rows: number, columns: number, value: 0 | 1): TissueActivationMatrix => ({
  rows,
  columns,
  values: Array.from({ length: rows * columns }, () => value),
});

const makeSlice = (matrix: TissueActivationMatrix): TissueSelectionSlice => ({
  status: 'complete',
  isStale: false,
  updatedAt: null,
  error: null,
  mode: 'matrix',
  thresholdMode: 'raw',
  activationThreshold: 0.1,
  blockThreshold: 135,
  dbscanEps: 0.03,
  dbscanMinSamples: 5,
  minConnectedSpotCount: 2,
  autoSelectedSpotIds: ['1:1'],
  matrix,
  supportState: 'supported',
  unsupportedReason: null,
  selectedSpotIds: ['1:1', '2:2'],
  paritySummary: { selectedCount: 2, selectedPercent: 50, maskCoverage: 50 },
  warning: null,
});

describe('exclusion lock primitives', () => {
  it('flags spots in excluded rows or columns', () => {
    expect(isSpotExcluded({ excludedRows: [2], excludedColumns: [] }, 2, 1)).toBe(true);
    expect(isSpotExcluded({ excludedRows: [2], excludedColumns: [] }, 1, 2)).toBe(false);
    expect(isSpotExcluded({ excludedRows: [], excludedColumns: [3] }, 1, 3)).toBe(true);
  });

  it('computes locked ids and filters id lists', () => {
    const spots = makeSpots(2, 2);
    const locked = lockedSpotIds(spots, { excludedRows: [1], excludedColumns: [2] });
    expect([...locked].sort()).toEqual(['1:1', '1:2', '2:2']);
    expect(filterExcludedFromIds(['1:1', '2:1', '2:2', 'x'], locked)).toEqual(['2:1', 'x']);
  });

  it('forces excluded matrix cells to 0 without resizing the matrix', () => {
    const matrix = makeMatrix(3, 3, 1);
    const locked = applyExclusionLockToMatrix(matrix, {
      excludedRows: [2],
      excludedColumns: [3],
    });
    expect(locked.rows).toBe(3);
    expect(locked.columns).toBe(3);
    // Row 2 fully 0.
    expect(locked.values.slice(3, 6)).toEqual([0, 0, 0]);
    // Column 3 fully 0 (rows 1 and 3).
    expect(locked.values[2]).toBe(0);
    expect(locked.values[8]).toBe(0);
    // Everything else stays 1.
    expect(locked.values.filter((value) => value === 1).length).toBe(4);
  });
});

describe('lockTissueSelectionSlice', () => {
  it('returns the slice unchanged when nothing is excluded', () => {
    const slice = makeSlice(makeMatrix(2, 2, 1));
    expect(lockTissueSelectionSlice(slice, makeSpots(2, 2), {
      excludedRows: [],
      excludedColumns: [],
    })).toBe(slice);
  });

  it('locks matrix cells, filters ids, and rebuilds the parity summary', () => {
    const slice = makeSlice(makeMatrix(2, 2, 1));
    const locked = lockTissueSelectionSlice(slice, makeSpots(2, 2), {
      excludedRows: [1],
      excludedColumns: [],
    });

    expect(locked.matrix?.values).toEqual([0, 0, 1, 1]);
    expect(locked.selectedSpotIds).toEqual(['2:2']);
    expect(locked.autoSelectedSpotIds).toEqual([]);
    expect(locked.paritySummary).toEqual({
      selectedCount: 1,
      selectedPercent: 25,
      maskCoverage: 25,
    });
  });

  it('keeps null selectedSpotIds null and null matrix null', () => {
    const slice = {
      ...makeSlice(makeMatrix(2, 2, 1)),
      matrix: null,
      selectedSpotIds: null,
    };
    const locked = lockTissueSelectionSlice(slice, makeSpots(2, 2), {
      excludedRows: [1],
      excludedColumns: [],
    });
    expect(locked.matrix).toBeNull();
    expect(locked.selectedSpotIds).toBeNull();
    expect(locked.autoSelectedSpotIds).toEqual([]);
  });
});
