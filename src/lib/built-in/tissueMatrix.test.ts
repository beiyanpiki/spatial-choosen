import { describe, expect, it } from 'vitest';

import type { ProjectedSpot } from '@/types/built-in';

import {
  createEmptyMatrix,
  matrixFromSelectedSpotIds,
  selectedSpotIdsFromMatrix,
  validateTissueActivationMatrix,
} from './tissueMatrix';

const PROJECTED_SPOTS: ProjectedSpot[] = [
  {
    id: 'spot-a',
    barcode: 'spot-a',
    arrayRow: 1,
    arrayCol: 1,
    x: 0.25,
    y: 0.25,
    width: 0.2,
    height: 0.2,
    diameterX: 0.2,
    diameterY: 0.2,
  },
  {
    id: 'spot-b',
    barcode: 'spot-b',
    arrayRow: 1,
    arrayCol: 2,
    x: 0.5,
    y: 0.25,
    width: 0.2,
    height: 0.2,
    diameterX: 0.2,
    diameterY: 0.2,
  },
  {
    id: 'spot-c',
    barcode: 'spot-c',
    arrayRow: 2,
    arrayCol: 1,
    x: 0.25,
    y: 0.5,
    width: 0.2,
    height: 0.2,
    diameterX: 0.2,
    diameterY: 0.2,
  },
];

describe('tissueMatrix helpers', () => {
  it('creates 9216 zeroes for an empty 96x96 matrix', () => {
    const matrix = createEmptyMatrix(96, 96);

    expect(matrix.rows).toBe(96);
    expect(matrix.columns).toBe(96);
    expect(matrix.values).toHaveLength(9216);
    expect(matrix.values.every((value) => value === 0)).toBe(true);
  });

  it('creates 4096 zeroes for an empty 64x64 matrix', () => {
    const matrix = createEmptyMatrix(64, 64);

    expect(matrix.values).toHaveLength(4096);
    expect(matrix.values.every((value) => value === 0)).toBe(true);
  });

  it('rejects invalid matrix lengths and non-binary values', () => {
    expect(() => validateTissueActivationMatrix({
      rows: 2,
      columns: 2,
      values: [0, 1, 0],
    })).toThrow(/length/i);

    expect(() => validateTissueActivationMatrix({
      rows: 2,
      columns: 2,
      values: [0, 1, 2, 0],
    })).toThrow(/binary/i);
  });

  it('derives selected spot ids from projected spots and matrix state', () => {
    const matrix = {
      rows: 2,
      columns: 2,
      values: [1, 0, 1, 0],
    };

    expect(selectedSpotIdsFromMatrix(matrix, PROJECTED_SPOTS)).toEqual(['spot-a', 'spot-c']);
  });

  it('creates a matrix with ones only at matching arrayRow and arrayCol positions', () => {
    const matrix = matrixFromSelectedSpotIds({
      rows: 2,
      columns: 2,
      projectedSpots: PROJECTED_SPOTS,
      selectedSpotIds: ['spot-b'],
    });

    expect(matrix).toEqual({
      rows: 2,
      columns: 2,
      values: [0, 1, 0, 0],
    });
  });
});
