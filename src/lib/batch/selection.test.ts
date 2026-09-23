import { describe, expect, it } from 'vitest';

import type { BatchRegion, BatchSpot } from '@/types/batch';

import { selectBarcodes, spotCenter, spotRect } from './selection';
import { classifyBarcodes } from './selection';

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
  colorId: 1,
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

describe('classifyBarcodes', () => {
  const spots = [
    spot('only-red', 100, 100),
    spot('overlap', 100, 120),
    spot('outside', 900, 900),
  ];
  const red = { ...square(50, 50, 140, 140), id: 'red', colorId: 1 };
  const blue = { ...square(50, 50, 200, 200), id: 'blue', colorId: 2 };

  it('reports the class of every selected barcode', () => {
    const result = classifyBarcodes({
      spots,
      regions: [red],
      anchorMode: 'center',
      hitMode: 'center',
      spotDiameterFullres: 20,
    });

    expect(result.classByBarcode.get('only-red')).toBe(1);
    expect(result.classByBarcode.get('overlap')).toBe(1);
    expect(result.classByBarcode.has('outside')).toBe(false);
  });

  it('lets the later region win where regions overlap', () => {
    const result = classifyBarcodes({
      spots,
      regions: [red, blue],
      anchorMode: 'center',
      hitMode: 'center',
      spotDiameterFullres: 20,
    });

    // Blue is drawn last, so it decides the value of the overlapping barcode.
    expect(result.classByBarcode.get('overlap')).toBe(2);
    expect(result.classByBarcode.get('only-red')).toBe(2);
  });
});
