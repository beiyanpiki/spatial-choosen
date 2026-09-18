import { describe, expect, it } from 'vitest';

import type { BatchRegion, BatchSpot } from '@/types/batch';

import { selectBarcodes, spotCenter, spotRect } from './selection';

const spot = (barcode: string, pxlRowInFullres: number, pxlColInFullres: number): BatchSpot => ({
  barcode,
  inTissue: true,
  arrayRow: 1,
  arrayCol: 1,
  pxlRowInFullres,
  pxlColInFullres,
});

const square = (x: number, y: number, width: number, height: number): BatchRegion => ({
  id: `region-${x}-${y}`,
  points: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ],
});

describe('spot geometry', () => {
  it('offsets the top-left anchor by half the spot diameter', () => {
    const target = spot('A', 100, 200);

    expect(spotCenter(target, 'top-left', 20)).toEqual({ x: 210, y: 110 });
    expect(spotRect(target, 'top-left', 20)).toEqual({ x: 200, y: 100, width: 20, height: 20 });
  });

  it('treats pxl_* as the centre when the anchor mode says so', () => {
    const target = spot('A', 100, 200);

    expect(spotCenter(target, 'center', 20)).toEqual({ x: 200, y: 100 });
    expect(spotRect(target, 'center', 20)).toEqual({ x: 190, y: 90, width: 20, height: 20 });
  });

  it('falls back to the raw coordinate when the diameter is unknown', () => {
    expect(spotCenter(spot('A', 100, 200), 'top-left', null)).toEqual({ x: 200, y: 100 });
  });
});

describe('selectBarcodes', () => {
  const spots = [
    spot('inside', 100, 100),
    // Centre sits just outside the region at x=195 while its square overlaps.
    spot('edge', 100, 195),
    spot('outside', 400, 400),
  ];

  it('selects spots whose centre falls inside the region', () => {
    const selected = selectBarcodes({
      spots,
      regions: [square(50, 50, 140, 140)],
      anchorMode: 'center',
      hitMode: 'center',
      spotDiameterFullres: 20,
    });

    expect(selected).toEqual(['inside']);
  });

  it('selects overlapping spot squares when the overlap mode is used', () => {
    const selected = selectBarcodes({
      spots,
      regions: [square(50, 50, 140, 140)],
      anchorMode: 'center',
      hitMode: 'overlap',
      spotDiameterFullres: 20,
    });

    expect(selected).toEqual(['inside', 'edge']);
  });

  it('returns nothing without a region', () => {
    expect(selectBarcodes({
      spots,
      regions: [],
      anchorMode: 'top-left',
      hitMode: 'center',
      spotDiameterFullres: 20,
    })).toEqual([]);
  });

  it('unions multiple regions', () => {
    const selected = selectBarcodes({
      spots,
      regions: [square(50, 50, 140, 140), square(380, 380, 60, 60)],
      anchorMode: 'center',
      hitMode: 'center',
      spotDiameterFullres: 20,
    });

    expect(selected).toEqual(['inside', 'outside']);
  });
});
