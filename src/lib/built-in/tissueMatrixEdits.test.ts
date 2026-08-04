import { describe, expect, it } from 'vitest';

import type { PreprocessPoint, ProjectedSpot, TissueActivationMatrix } from '@/types/built-in';

import { applyTissueMatrixEdit } from './tissueMatrixEdits';

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
    x: 0.75,
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
    y: 0.75,
    width: 0.2,
    height: 0.2,
    diameterX: 0.2,
    diameterY: 0.2,
  },
  {
    id: 'spot-d',
    barcode: 'spot-d',
    arrayRow: 2,
    arrayCol: 2,
    x: 0.75,
    y: 0.75,
    width: 0.2,
    height: 0.2,
    diameterX: 0.2,
    diameterY: 0.2,
  },
];

const rect = (left: number, top: number, right: number, bottom: number): PreprocessPoint[] => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
];

const matrix = (values: TissueActivationMatrix['values']): TissueActivationMatrix => ({
  rows: 2,
  columns: 2,
  values,
});

describe('tissueMatrixEdits', () => {
  it('sets overlapped cells to 1 for activate edits', () => {
    const next = applyTissueMatrixEdit({
      matrix: matrix([0, 0, 0, 0]),
      projectedSpots: PROJECTED_SPOTS,
      editArea: rect(0.1, 0.1, 0.9, 0.3),
      nextValue: 1,
    });

    expect(next).toEqual(matrix([1, 1, 0, 0]));
  });

  it('sets overlapped cells to 0 for deactivate edits', () => {
    const next = applyTissueMatrixEdit({
      matrix: matrix([1, 1, 1, 1]),
      projectedSpots: PROJECTED_SPOTS,
      editArea: rect(0.65, 0.15, 0.85, 0.35),
      nextValue: 0,
    });

    expect(next).toEqual(matrix([1, 0, 1, 1]));
  });

  it('leaves the matrix unchanged when the edit area overlaps no spot footprints', () => {
    const current = matrix([1, 0, 1, 0]);
    const next = applyTissueMatrixEdit({
      matrix: current,
      projectedSpots: PROJECTED_SPOTS,
      editArea: rect(0.4, 0.4, 0.6, 0.6),
      nextValue: 1,
    });

    expect(next).toBe(current);
  });

  it('does not treat boundary-only contact as overlap', () => {
    const current = matrix([0, 0, 0, 0]);
    const next = applyTissueMatrixEdit({
      matrix: current,
      projectedSpots: PROJECTED_SPOTS,
      editArea: rect(0.35, 0.15, 0.45, 0.35),
      nextValue: 1,
    });

    expect(next).toBe(current);
  });

  it('changes only overlapped spots and keeps untouched cells intact', () => {
    const next = applyTissueMatrixEdit({
      matrix: matrix([0, 1, 1, 0]),
      projectedSpots: PROJECTED_SPOTS,
      editArea: rect(0.15, 0.15, 0.3, 0.3),
      nextValue: 1,
    });

    expect(next).toEqual(matrix([1, 1, 1, 0]));
  });
});
