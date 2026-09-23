import { describe, expect, it } from 'vitest';

import type { BatchSpot, BatchSimilarityParams } from '@/types/batch';

import { normalizeSimilarityParams, resolvePackageMatrix } from './affine';
import { computeSelection } from './pipeline';
import {
  parseTransformMatrixCsv,
  regionsFromSelectedBarcodes,
  similarityParamsFromOwnFrameMatrix,
} from './resume';

const SIZE = { width: 6005, height: 6005 };
const DIAMETER = 20;

/** 6x6 spot grid, 40px pitch, ids `r{row}c{col}`. */
const buildSpots = (): BatchSpot[] => {
  const spots: BatchSpot[] = [];

  for (let row = 1; row <= 6; row += 1) {
    for (let col = 1; col <= 6; col += 1) {
      spots.push({
        barcode: `r${row}c${col}`,
        inTissue: true,
        arrayRow: row,
        arrayCol: col,
        pxlRowInFullres: row * 40,
        pxlColInFullres: col * 40,
      });
    }
  }

  return spots;
};

describe('parseTransformMatrixCsv', () => {
  it('reads the two rows written by step 5', () => {
    expect(parseTransformMatrixCsv('1,0,0\n0,1,0\n')).toEqual([1, 0, 0, 0, 1, 0]);
  });

  it('ignores the homogeneous row of a 3x3 payload', () => {
    expect(parseTransformMatrixCsv('2,0,-10\n0,2,-20\n0,0,1\n')).toEqual([2, 0, -10, 0, 2, -20]);
  });

  it('rejects payloads that are not a matrix', () => {
    expect(parseTransformMatrixCsv('')).toBeNull();
    expect(parseTransformMatrixCsv('1,0,0')).toBeNull();
    expect(parseTransformMatrixCsv('a,b,c\nd,e,f')).toBeNull();
  });
});

describe('similarityParamsFromOwnFrameMatrix', () => {
  const cases: Array<[string, Partial<BatchSimilarityParams>]> = [
    ['identity', {}],
    ['scale only', { scale: 1.35 }],
    ['rotation only', { rotationDegrees: -42 }],
    ['rotation and scale', { rotationDegrees: 17.5, scale: 0.82 }],
    ['translated', { rotationDegrees: 8, scale: 1.2, offsetX: 0.07, offsetY: -0.11 }],
    ['flipped vertically', { rotationDegrees: 12, scale: 1.1, flipVertical: true }],
    ['flipped horizontally', { rotationDegrees: -25, scale: 0.9, flipHorizontal: true }],
  ];

  it.each(cases)('round trips the %s matrix', (_label, overrides) => {
    const params = normalizeSimilarityParams(overrides);
    const written = resolvePackageMatrix({
      convention: 'source-frame',
      params,
      sourceSize: SIZE,
      referenceSize: SIZE,
    });

    const recovered = similarityParamsFromOwnFrameMatrix(written, SIZE);
    expect(recovered).not.toBeNull();

    // The recovered parameters must reproduce the same matrix, which is what
    // continuing a resumed batch depends on.
    const rewritten = resolvePackageMatrix({
      convention: 'source-frame',
      params: recovered as BatchSimilarityParams,
      sourceSize: SIZE,
      referenceSize: SIZE,
    });

    rewritten.forEach((value, index) => {
      expect(value).toBeCloseTo(written[index], 8);
    });
  });

  it('round trips a non-square package frame', () => {
    const sourceSize = { width: 8000, height: 6000 };
    const params = normalizeSimilarityParams({ rotationDegrees: 33, scale: 1.4, offsetY: 0.05 });
    const written = resolvePackageMatrix({
      convention: 'source-frame',
      params,
      sourceSize,
      referenceSize: { width: 6005, height: 6005 },
    });

    const recovered = similarityParamsFromOwnFrameMatrix(written, sourceSize);
    expect(recovered).not.toBeNull();

    const rewritten = resolvePackageMatrix({
      convention: 'source-frame',
      params: recovered as BatchSimilarityParams,
      sourceSize,
      referenceSize: { width: 6005, height: 6005 },
    });

    rewritten.forEach((value, index) => {
      expect(value).toBeCloseTo(written[index], 8);
    });
  });

  it('refuses a degenerate scale', () => {
    expect(similarityParamsFromOwnFrameMatrix([0, 0, 0, 0, 0, 0], SIZE)).toBeNull();
  });
});

describe('regionsFromSelectedBarcodes', () => {
  const spots = buildSpots();
  const selected = spots
    .filter((spot) => spot.arrayRow <= 3 && spot.arrayCol <= 4)
    .map((spot) => spot.barcode);

  it('rebuilds a region that reproduces exactly the same barcodes', () => {
    const regions = regionsFromSelectedBarcodes({
      spots,
      selectedBarcodes: selected,
      size: SIZE,
      anchorMode: 'top-left',
      spotDiameterFullres: DIAMETER,
    });

    expect(regions.length).toBeGreaterThan(0);

    // Go through the same entry point the workspace uses, so the normalized
    // regions are converted into package pixels exactly like during a session.
    const reselected = computeSelection({
      spots,
      regions,
      size: SIZE,
      settings: { anchorMode: 'top-left', hitMode: 'overlap' },
      spotDiameterFullres: DIAMETER,
    });

    expect([...reselected.selectedBarcodes].sort()).toEqual([...selected].sort());
  });

  it('rebuilds a region in normalized coordinates', () => {
    const regions = regionsFromSelectedBarcodes({
      spots,
      selectedBarcodes: selected,
      size: SIZE,
      anchorMode: 'top-left',
      spotDiameterFullres: DIAMETER,
    });

    const points = regions.flatMap((region) => region.points);
    expect(points.length).toBeGreaterThan(3);
    points.forEach((point) => {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(1);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(1);
    });
  });

  it('returns nothing when the previous export selected no barcode', () => {
    expect(regionsFromSelectedBarcodes({
      spots,
      selectedBarcodes: [],
      size: SIZE,
      anchorMode: 'top-left',
      spotDiameterFullres: DIAMETER,
    })).toEqual([]);
  });
});

describe('regionsFromSelectedBarcodes on an irregular selection', () => {
  /**
   * A freehand-style blob: rows with different run lengths plus a notch, which
   * is the shape that used to drop whole runs of selected spots when the
   * reconstruction merged rectangles by grid arithmetic.
   */
  const buildIrregular = () => {
    const spots: BatchSpot[] = [];
    const selected: string[] = [];

    for (let row = 1; row <= 40; row += 1) {
      for (let col = 1; col <= 40; col += 1) {
        const barcode = `r${row}c${col}`;
        spots.push({
          barcode,
          inTissue: true,
          arrayRow: row,
          arrayCol: col,
          pxlRowInFullres: row * 30,
          pxlColInFullres: col * 30,
        });

        const wobble = Math.round(3 * Math.sin(row / 2));
        const inBlob = Math.abs(row - 20) + Math.abs(col - 20 + wobble) <= 11;
        const notch = row === 15 && col >= 20 && col <= 26;
        if (inBlob && !notch) selected.push(barcode);
      }
    }

    return { spots, selected };
  };

  it('reproduces every selected barcode', () => {
    const { spots, selected } = buildIrregular();
    const size = { width: 40 * 30, height: 40 * 30 };

    const regions = regionsFromSelectedBarcodes({
      spots,
      selectedBarcodes: selected,
      size,
      anchorMode: 'top-left',
      spotDiameterFullres: DIAMETER,
    });

    expect(regions.length).toBeGreaterThan(1);

    const replayed = computeSelection({
      spots,
      regions,
      size,
      settings: { anchorMode: 'top-left', hitMode: 'overlap' },
      spotDiameterFullres: DIAMETER,
    });

    expect(replayed.selectedBarcodes).toHaveLength(selected.length);
    expect([...replayed.selectedBarcodes].sort()).toEqual([...selected].sort());
  });

  it('rebuilds one outline per region class', () => {
    const { spots, selected } = buildIrregular();
    const size = { width: 40 * 30, height: 40 * 30 };
    const [firstHalf, secondHalf] = [selected.slice(0, 40), selected.slice(40, 80)];
    const classByBarcode = new Map<string, number>([
      ...firstHalf.map((barcode): [string, number] => [barcode, 2]),
      ...secondHalf.map((barcode): [string, number] => [barcode, 5]),
    ]);

    const regions = regionsFromSelectedBarcodes({
      spots,
      selectedBarcodes: [...firstHalf, ...secondHalf],
      classByBarcode,
      size,
      anchorMode: 'top-left',
      spotDiameterFullres: DIAMETER,
    });

    const classes = new Set(regions.map((region) => region.colorId));
    expect([...classes].sort()).toEqual([2, 5]);

    const replayed = computeSelection({
      spots,
      regions,
      size,
      settings: { anchorMode: 'top-left', hitMode: 'overlap' },
      spotDiameterFullres: DIAMETER,
    });

    expect([...replayed.selectedBarcodes].sort()).toEqual([...[...firstHalf, ...secondHalf]].sort());
  });
});
