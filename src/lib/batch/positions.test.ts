import { describe, expect, it } from 'vitest';

import {
  parsePositionsTable,
  readSpotDiameter,
  readSpotsFromPositions,
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

    expect(lines[0]).toBe('barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres,in_selected,selected_class,selected_color');
    expect(lines[1]).toBe('AAA,0,1,1,10,20,0,0,');
    expect(lines[2]).toBe('BBB,1,1,2,30,40,1,1,');
    expect(lines[3]).toBe('CCC,1,2,1,50,60,0,0,');
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

    expect(lines[0].endsWith('in_selected,selected_class,selected_color')).toBe(true);
    expect(lines[1]).toBe('AAA,0,1,1,10,20,1,3,#38A169');
    expect(lines[2]).toBe('BBB,1,1,2,30,40,1,2,#3182CE');
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

    expect(lines[0]).toBe('barcode,in_selected,in_tissue,pxl_row_in_fullres,pxl_col_in_fullres,selected_class,selected_color');
    expect(lines[1]).toBe('AAA,1,0,10,20,1,');
    expect(lines[2]).toBe('BBB,0,1,30,40,0,');
  });

  it('marks every barcode as excluded when the selection is empty', () => {
    const table = parsePositionsTable(POSITIONS_CSV);
    const csv = writePositionsWithSelection(table!, new Set());

    expect(csv.trim().split('\n').slice(1).every((line) => line.endsWith(',0,0,'))).toBe(true);
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
