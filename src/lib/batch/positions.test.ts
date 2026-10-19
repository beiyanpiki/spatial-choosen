import { describe, expect, it } from 'vitest';

import type { BatchSpot } from '@/types/batch';

import {
  parsePositionsTable,
  recomputeTablePixelsFromArray,
  recomputeSpotPixelsFromArray,
  readSpotDiameter,
  readSpotsFromPositions,
  withComputedSpotPixels,
  writePositionsWithSelection,
} from './positions';

const POSITIONS_CSV = [
  'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
  'AAA,0,1,1,10,20',
  'BBB,1,1,2,30,40',
  'CCC,1,2,1,50,60',
  '',
].join('\n');

describe('parsePositionsTable', () => {
  it('reads the NATA positions header and rows', () => {
    const table = parsePositionsTable(POSITIONS_CSV);
    expect(table).not.toBeNull();
    expect(table?.header).toEqual([
      'barcode',
      'in_tissue',
      'array_row',
      'array_col',
      'pxl_row_in_fullres',
      'pxl_col_in_fullres',
    ]);
    expect(table?.rows).toHaveLength(3);
    expect(table?.columnIndex.pxl_col_in_fullres).toBe(5);
  });

  it('rejects files without the required coordinate columns', () => {
    expect(parsePositionsTable('barcode,in_tissue\nAAA,0\n')).toBeNull();
  });
});

describe('readSpotsFromPositions', () => {
  it('parses barcodes, in_tissue flags and pixel coordinates', () => {
    const table = parsePositionsTable(POSITIONS_CSV);
    const spots = readSpotsFromPositions(table!);

    expect(spots).toEqual([
      { barcode: 'AAA', inTissue: false, arrayRow: 1, arrayCol: 1, pxlRowInFullres: 10, pxlColInFullres: 20 },
      { barcode: 'BBB', inTissue: true, arrayRow: 1, arrayCol: 2, pxlRowInFullres: 30, pxlColInFullres: 40 },
      { barcode: 'CCC', inTissue: true, arrayRow: 2, arrayCol: 1, pxlRowInFullres: 50, pxlColInFullres: 60 },
    ]);
  });
});

describe('writePositionsWithSelection', () => {
  it('appends in_selected while preserving every original column', () => {
    const table = parsePositionsTable(POSITIONS_CSV);
    const csv = writePositionsWithSelection(table!, new Set(['BBB']));
    const lines = csv.trim().split('\n');

    expect(lines[0]).toBe('barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres,in_selected,selected_class,selected_color,Colours');
    expect(lines[1]).toBe('AAA,0,1,1,10,20,0,0,,');
    expect(lines[2]).toBe('BBB,1,1,2,30,40,1,1,,');
    expect(lines[3]).toBe('CCC,1,2,1,50,60,0,0,,');
  });

  it('writes the region class and colour so a spreadsheet can tell them apart', () => {
    const table = parsePositionsTable(POSITIONS_CSV);
    const csv = writePositionsWithSelection(
      table!,
      new Set(['AAA', 'BBB']),
      new Map([['AAA', 3], ['BBB', 2]]),
      new Map([['AAA', '#38A169'], ['BBB', '#3182CE']]),
    );
    const lines = csv.trim().split('\n');

    expect(lines[0].endsWith('in_selected,selected_class,selected_color,Colours')).toBe(true);
    expect(lines[1]).toBe('AAA,0,1,1,10,20,1,3,#38A169,');
    expect(lines[2]).toBe('BBB,1,1,2,30,40,1,2,#3182CE,');
  });

  it('overwrites a pre-existing in_selected column in place', () => {
    const csv = [
      'barcode,in_selected,in_tissue,pxl_row_in_fullres,pxl_col_in_fullres',
      'AAA,1,0,10,20',
      'BBB,1,1,30,40',
      '',
    ].join('\n');
    const table = parsePositionsTable(csv);
    const result = writePositionsWithSelection(table!, new Set(['AAA']));
    const lines = result.trim().split('\n');

    expect(lines[0]).toBe('barcode,in_selected,in_tissue,pxl_row_in_fullres,pxl_col_in_fullres,selected_class,selected_color,Colours');
    expect(lines[1]).toBe('AAA,1,0,10,20,1,,');
    expect(lines[2]).toBe('BBB,0,1,30,40,0,,');
  });

  it('marks every barcode as excluded when the selection is empty', () => {
    const table = parsePositionsTable(POSITIONS_CSV);
    const csv = writePositionsWithSelection(table!, new Set());

    expect(csv.trim().split('\n').slice(1).every((line) => line.endsWith(',0,0,,'))).toBe(true);
  });

  it('writes the region name into a trailing Colours column', () => {
    const table = parsePositionsTable(POSITIONS_CSV);
    const csv = writePositionsWithSelection(
      table!,
      new Set(['AAA', 'BBB']),
      new Map([['AAA', 3], ['BBB', 6]]),
      new Map([['AAA', '#38A169'], ['BBB', '#3366FF']]),
      new Map([['AAA', 'Group 3'], ['BBB', '肿瘤']]),
    );
    const lines = csv.trim().split('\n');

    // Last column, so the region name is what a spreadsheet shows at the far right.
    expect(lines[0]).toBe(
      'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres,in_selected,selected_class,selected_color,Colours',
    );
    expect(lines[1]).toBe('AAA,0,1,1,10,20,1,3,#38A169,Group 3');
    expect(lines[2]).toBe('BBB,1,1,2,30,40,1,6,#3366FF,肿瘤');
    // A barcode outside every region keeps the column empty.
    expect(lines[3]).toBe('CCC,1,2,1,50,60,0,0,,');
  });
});

describe('readSpotDiameter', () => {
  it('reads spot_diameter_fullres from scalefactors', () => {
    expect(readSpotDiameter('{"spot_diameter_fullres":18.973684210526315}')).toBeCloseTo(18.9737, 4);
  });

  it('returns null for missing or malformed payloads', () => {
    expect(readSpotDiameter(null)).toBeNull();
    expect(readSpotDiameter('not json')).toBeNull();
    expect(readSpotDiameter('{"spot_diameter_fullres":"18"}')).toBeNull();
    expect(readSpotDiameter('{"spot_diameter_fullres":0}')).toBeNull();
  });
});

describe('recomputing E/F from the array columns', () => {
  /** 5x5 lattice with a pitch, an offset and a small shear/rotation. */
  const buildGrid = (): BatchSpot[] => {
    const spots: BatchSpot[] = [];
    for (let row = 1; row <= 5; row += 1) {
      for (let col = 1; col <= 5; col += 1) {
        spots.push({
          barcode: `r${row}c${col}`,
          inTissue: true,
          arrayRow: row,
          arrayCol: col,
          pxlColInFullres: 100 + col * 10 + row * 2,
          pxlRowInFullres: 500 - row * 10 + col,
        });
      }
    }
    return spots;
  };

  it('recovers every pixel coordinate from C/D', () => {
    const grid = buildGrid();
    const { spots, mapping } = recomputeSpotPixelsFromArray(grid);

    expect(mapping).not.toBeNull();
    spots.forEach((spot, index) => {
      expect(spot.pxlColInFullres).toBe(grid[index].pxlColInFullres);
      expect(spot.pxlRowInFullres).toBe(grid[index].pxlRowInFullres);
    });
  });

  it('writes the recomputed E/F into the table used for export', () => {
    const grid = buildGrid();
    const csv = [
      'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
      ...grid.map((spot) => [
        spot.barcode,
        1,
        spot.arrayRow,
        spot.arrayCol,
        spot.pxlRowInFullres,
        spot.pxlColInFullres,
      ].join(',')),
    ].join('\n');
    const table = parsePositionsTable(csv);
    expect(table).not.toBeNull();

    const shifted = grid.map((spot) => ({
      ...spot,
      pxlRowInFullres: spot.pxlRowInFullres + 7,
      pxlColInFullres: spot.pxlColInFullres + 7,
    }));
    const updated = withComputedSpotPixels(table!, shifted);
    const exported = writePositionsWithSelection(updated, new Set());
    const firstDataRow = exported.trim().split('\n')[1].split(',');
    const header = exported.trim().split('\n')[0].split(',');

    expect(firstDataRow[header.indexOf('pxl_row_in_fullres')]).toBe(
      String(shifted[0].pxlRowInFullres),
    );
    expect(firstDataRow[header.indexOf('pxl_col_in_fullres')]).toBe(
      String(shifted[0].pxlColInFullres),
    );
  });

  it('keeps the original values when the lattice cannot be fitted', () => {
    const spots: BatchSpot[] = [
      { barcode: 'a', inTissue: true, arrayRow: 1, arrayCol: 1, pxlRowInFullres: 10, pxlColInFullres: 10 },
      { barcode: 'b', inTissue: true, arrayRow: 1, arrayCol: 1, pxlRowInFullres: 20, pxlColInFullres: 20 },
    ];

    const { spots: kept, mapping } = recomputeSpotPixelsFromArray(spots);
    expect(mapping).toBeNull();
    expect(kept.map((spot) => [spot.pxlRowInFullres, spot.pxlColInFullres]))
      .toEqual([[10, 10], [20, 20]]);
  });

  it('fills rows whose measured E/F are blank instead of dropping them', () => {
    const grid = buildGrid();
    const csv = [
      'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
      ...grid.map((spot, index) => [
        spot.barcode,
        1,
        spot.arrayRow,
        spot.arrayCol,
        index < 10 ? '' : spot.pxlRowInFullres,
        index < 10 ? '' : spot.pxlColInFullres,
      ].join(',')),
    ].join('\n');
    const table = parsePositionsTable(csv);
    expect(table).not.toBeNull();

    const { table: computed, mapping } = recomputeTablePixelsFromArray(table!);
    expect(mapping).not.toBeNull();

    const spots = readSpotsFromPositions(computed);
    // Every array row survives, including the two rows with no measured pixels.
    expect(spots).toHaveLength(grid.length);
    expect(spots[0].pxlRowInFullres).toBe(grid[0].pxlRowInFullres);
    expect(spots[0].pxlColInFullres).toBe(grid[0].pxlColInFullres);
  });
});
