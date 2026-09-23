import type { BatchPositionsTable, BatchSpot } from '@/types/batch';

import { parseCsv, readColumnIndex, stringifyCsv } from './csv';

export const POSITIONS_FILE_PATTERN = /^tissue_positions?\.csv$/i;
export const IN_SELECTED_COLUMN = 'in_selected';
export const SELECTED_CLASS_COLUMN = 'selected_class';
export const SELECTED_COLOR_COLUMN = 'selected_color';
export const FULLRES_IMAGE_FILE_PATTERN = /^tissue_fullres_image\.(png|tif|tiff|jpe?g)$/i;
export const SCALEFACTORS_FILE_PATTERN = /^scalefactors_json\.json$/i;

const REQUIRED_COLUMNS = [
  'barcode',
  'pxl_row_in_fullres',
  'pxl_col_in_fullres',
] as const;

const toNumber = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
};

export function parsePositionsTable(text: string): BatchPositionsTable | null {
  const rows = parseCsv(text);
  if (rows.length < 2) return null;

  const header = rows[0].map((cell) => cell.trim());
  const columnIndex = readColumnIndex(header);

  for (const column of REQUIRED_COLUMNS) {
    if (columnIndex[column] === undefined) {
      return null;
    }
  }

  return {
    header,
    rows: rows.slice(1).map((row) => {
      const cells = header.map((_, index) => row[index] ?? '');
      return cells;
    }),
    columnIndex,
  };
}

export function readSpotsFromPositions(table: BatchPositionsTable): BatchSpot[] {
  const { columnIndex } = table;
  const barcodeIndex = columnIndex.barcode;
  const rowIndex = columnIndex.pxl_row_in_fullres;
  const columnPosition = columnIndex.pxl_col_in_fullres;
  const arrayRowIndex = columnIndex.array_row;
  const arrayColIndex = columnIndex.array_col;
  const inTissueIndex = columnIndex.in_tissue;

  if (barcodeIndex === undefined || rowIndex === undefined || columnPosition === undefined) {
    return [];
  }

  const spots: BatchSpot[] = [];

  table.rows.forEach((row, index) => {
    const barcode = (row[barcodeIndex] ?? '').trim();
    const pxlRow = toNumber(row[rowIndex]);
    const pxlCol = toNumber(row[columnPosition]);

    if (barcode === '' || pxlRow === null || pxlCol === null) {
      return;
    }

    spots.push({
      barcode,
      inTissue: (row[inTissueIndex ?? -1] ?? '').trim() === '1',
      arrayRow: arrayRowIndex === undefined ? index + 1 : toNumber(row[arrayRowIndex]) ?? index + 1,
      arrayCol: arrayColIndex === undefined ? index + 1 : toNumber(row[arrayColIndex]) ?? index + 1,
      pxlRowInFullres: pxlRow,
      pxlColInFullres: pxlCol,
    });
  });

  return spots;
}

/**
 * Serializes `tissue_positions.csv` with an `in_selected` column.
 *
 * Every original column is preserved byte-for-byte (as parsed cells) and any
 * pre-existing `in_selected` column is overwritten in place, so exported
 * packages stay compatible with the files the pipeline emitted earlier.
 */
export function writePositionsWithSelection(
  table: BatchPositionsTable,
  selectedBarcodes: ReadonlySet<string>,
  classByBarcode?: ReadonlyMap<string, number>,
  colorByBarcode?: ReadonlyMap<string, string>,
): string {
  const selectedIndex = table.columnIndex[IN_SELECTED_COLUMN];
  const classIndex = table.columnIndex[SELECTED_CLASS_COLUMN];
  const colorIndex = table.columnIndex[SELECTED_COLOR_COLUMN];
  const header = [...table.header];

  if (selectedIndex === undefined) header.push(IN_SELECTED_COLUMN);
  if (classIndex === undefined) header.push(SELECTED_CLASS_COLUMN);
  if (colorIndex === undefined) header.push(SELECTED_COLOR_COLUMN);

  const effectiveSelectedIndex = selectedIndex ?? header.indexOf(IN_SELECTED_COLUMN);
  const effectiveClassIndex = classIndex ?? header.indexOf(SELECTED_CLASS_COLUMN);
  const effectiveColorIndex = colorIndex ?? header.indexOf(SELECTED_COLOR_COLUMN);
  const barcodeIndex = table.columnIndex.barcode ?? 0;

  const rows = table.rows.map((row) => {
    const cells = header.map((_, index) => row[index] ?? '');
    const barcode = (row[barcodeIndex] ?? '').trim();
    const selected = selectedBarcodes.has(barcode);

    cells[effectiveSelectedIndex] = selected ? '1' : '0';
    // The class is what makes different coloured regions distinguishable in a
    // spreadsheet; 0 means "not selected".
    cells[effectiveClassIndex] = selected
      ? String(classByBarcode?.get(barcode) ?? 1)
      : '0';
    // The colour itself, so a re-import can bring the palette back.
    cells[effectiveColorIndex] = selected
      ? colorByBarcode?.get(barcode) ?? ''
      : '';
    return cells;
  });

  return stringifyCsv([header, ...rows]);
}

export function readSpotDiameter(scalefactorsText: string | null): number | null {
  if (!scalefactorsText) return null;

  try {
    const parsed: unknown = JSON.parse(scalefactorsText);
    if (!parsed || typeof parsed !== 'object') return null;
    const value = (parsed as Record<string, unknown>).spot_diameter_fullres;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}
