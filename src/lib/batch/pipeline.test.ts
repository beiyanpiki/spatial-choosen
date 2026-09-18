import { describe, expect, it } from 'vitest';

import type { BatchPackage, BatchRegion, BatchSimilarityParams } from '@/types/batch';

import { normalizeSimilarityParams } from './affine';
import { parsePositionsTable, readSpotsFromPositions } from './positions';
import { buildExportInputs, buildTransformMatrixCsv, computeSelection } from './pipeline';

const POSITIONS_CSV = [
  'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
  'INSIDE,1,1,1,100,100',
  'OUTSIDE,1,1,2,900,900',
  '',
].join('\n');

const packageFixture = (overrides: Partial<BatchPackage> = {}): BatchPackage => {
  const positions = parsePositionsTable(POSITIONS_CSV);

  return {
    id: 'pkg-1',
    name: '250926-SPA-GW1',
    files: [],
    fullresFileName: 'spatial/tissue_fullres_image.png',
    positionsFileName: 'spatial/tissue_positions.csv',
    scalefactorsFileName: 'spatial/scalefactors_json.json',
    fullresSize: { width: 1000, height: 1000 },
    previewUrl: null,
    previewSize: { width: 500, height: 500 },
    spotDiameterFullres: 20,
    spots: positions ? readSpotsFromPositions(positions) : null,
    positions,
    resume: null,
    status: 'ready',
    error: null,
    ...overrides,
  };
};

const square = (x: number, y: number, width: number, height: number): BatchRegion => ({
  id: `region-${x}`,
  points: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ],
});

const identity: BatchSimilarityParams = normalizeSimilarityParams({});

describe('computeSelection', () => {
  it('converts normalized regions into package pixel space before testing spots', () => {
    const entry = packageFixture();
    const result = computeSelection({
      spots: entry.spots!,
      regions: [square(0.05, 0.05, 0.2, 0.2)],
      size: entry.fullresSize!,
      settings: { anchorMode: 'center', hitMode: 'center' },
      spotDiameterFullres: entry.spotDiameterFullres,
    });

    expect(result.selectedBarcodes).toEqual(['INSIDE']);
    expect(result.totalSpots).toBe(2);
  });

  it('returns an empty selection when the region list is empty', () => {
    const entry = packageFixture();
    const result = computeSelection({
      spots: entry.spots!,
      regions: [],
      size: entry.fullresSize!,
      settings: { anchorMode: 'center', hitMode: 'center' },
      spotDiameterFullres: entry.spotDiameterFullres,
    });

    expect(result.selectedBarcodes).toEqual([]);
  });
});

describe('buildTransformMatrixCsv', () => {
  it('keeps a same-size identity alignment at identity', () => {
    const csv = buildTransformMatrixCsv({
      params: identity,
      packageSize: { width: 1000, height: 1000 },
      referenceSize: { width: 1000, height: 1000 },
      layout: '2x3',
    });

    expect(csv).toBe('1,0,0\n0,1,0\n');
  });

  it('defaults to the own-size frame, so an untouched alignment stays identity', () => {
    const csv = buildTransformMatrixCsv({
      params: identity,
      packageSize: { width: 500, height: 500 },
      referenceSize: { width: 1000, height: 1000 },
      layout: '2x3',
    });

    expect(csv).toBe('1,0,0\n0,1,0\n');
  });

  it('scales between package and reference frames when that frame is requested', () => {
    const csv = buildTransformMatrixCsv({
      params: identity,
      packageSize: { width: 500, height: 500 },
      referenceSize: { width: 1000, height: 1000 },
      layout: '2x3',
      convention: 'reference-frame',
    });

    expect(csv).toBe('2,0,0\n0,2,0\n');
  });

  it('writes the raw operation when the source frame convention is selected', () => {
    const csv = buildTransformMatrixCsv({
      params: normalizeSimilarityParams({ rotationDegrees: 90, scale: 3 }),
      packageSize: { width: 6005, height: 6005 },
      referenceSize: { width: 2884, height: 2884 },
      layout: '2x3',
      convention: 'source-frame',
    });
    const [firstRow] = csv.trim().split('\n').map((row) => row.split(',').map(Number));

    // Rotate 90 degrees and scale 3x about the image centre, no size ratio.
    expect(Math.hypot(firstRow[0], firstRow[1])).toBeCloseTo(3, 10);
    expect(Math.atan2(firstRow[1], firstRow[0]) * (180 / Math.PI)).toBeCloseTo(-90, 8);
  });
});

describe('buildExportInputs', () => {
  it('emits the in_selected column and the transform matrix per package', () => {
    const reference = packageFixture({ id: 'ref', name: 'reference' });
    const moving = packageFixture({
      id: 'mov',
      name: '250926-SPA-GW3',
      fullresSize: { width: 500, height: 500 },
    });
    const regions: BatchRegion[] = [square(0.05, 0.05, 0.2, 0.2)];
    const settings = { anchorMode: 'center' as const, hitMode: 'center' as const };

    const selectionByPackage = {
      ref: computeSelection({
        spots: reference.spots!,
        regions,
        size: reference.fullresSize!,
        settings,
        spotDiameterFullres: reference.spotDiameterFullres,
      }),
      mov: computeSelection({
        spots: moving.spots!,
        regions,
        size: moving.fullresSize!,
        settings,
        spotDiameterFullres: moving.spotDiameterFullres,
      }),
    };

    const inputs = buildExportInputs({
      packages: [reference, moving],
      referencePackageId: 'ref',
      alignments: { ref: identity, mov: identity },
      selectionByPackage,
      matrixLayout: '2x3',
      matrixConvention: 'reference-frame',
    });

    expect(inputs).toHaveLength(2);
    expect(inputs[0].positionsFileName).toBe('spatial/tissue_positions.csv');
    expect(inputs[0].positionsCsv.split('\n')[0]).toContain('in_selected');
    expect(inputs[0].positionsCsv).toContain('INSIDE,1,1,1,100,100,1');
    expect(inputs[0].transformMatrixCsv).toBe('1,0,0\n0,1,0\n');
    // The 500px package is upscaled into the 1000px reference frame.
    expect(inputs[1].transformMatrixCsv).toBe('2,0,0\n0,2,0\n');
  });

  it('writes an empty matrix when the reference geometry is unknown', () => {
    const entry = packageFixture({ fullresSize: null, positions: null, spots: null });
    const [input] = buildExportInputs({
      packages: [entry],
      referencePackageId: entry.id,
      alignments: {},
      selectionByPackage: {},
      matrixLayout: '3x3',
      matrixConvention: 'reference-frame',
    });

    expect(input.transformMatrixCsv).toBe('');
    expect(input.positionsCsv).toBe('');
  });
});
