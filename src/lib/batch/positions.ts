import type { BatchPositionsTable, BatchSpot } from '@/types/batch';

import { parseCsv, readColumnIndex, stringifyCsv } from './csv';

export const POSITIONS_FILE_PATTERN = /^tissue_positions?\.csv$/i;
export const IN_SELECTED_COLUMN = 'in_selected';
export const SELECTED_CLASS_COLUMN = 'selected_class';
export const SELECTED_COLOR_COLUMN = 'selected_color';
/**
 * Operator-facing name of the colour group a barcode was drawn with, e.g.
 * `Group 1` or whatever the group was renamed to.
 */
export const SELECTED_COLOURS_COLUMN = 'Colours';
export const FULLRES_IMAGE_FILE_PATTERN = /^tissue_fullres_image\.(png|tif|tiff|jpe?g)$/i;
export const SCALEFACTORS_FILE_PATTERN = /^scalefactors_json\.json$/i;

const REQUIRED_COLUMNS = [
  'barcode',
  'pxl_row_in_fullres',
  'pxl_col_in_fullres',
] as const;

const toNumber = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const trimmed = value.trim();
  // `Number('')` is 0, which would silently move empty E/F cells to the image
  // corner; an empty cell means "not measured", not "pixel zero".
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Affine map from array coordinates (C/D) to full-resolution pixels (E/F):
 *
 *   pxl_col = a * array_col + b * array_row + c
 *   pxl_row = d * array_col + e * array_row + f
 */
export type SpotPixelMapping = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

const determinant3 = (matrix: readonly (readonly number[])[]): number => (
  matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
  - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
  + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
);

const solve3 = (
  matrix: readonly (readonly number[])[],
  vector: readonly number[],
): [number, number, number] | null => {
  const base = determinant3(matrix);
  if (!Number.isFinite(base) || Math.abs(base) < 1e-9) return null;

  const replaced = (column: number) => matrix.map((row, rowIndex) => (
    row.map((value, columnIndex) => (columnIndex === column ? vector[rowIndex] : value))
  ));

  return [
    determinant3(replaced(0)) / base,
    determinant3(replaced(1)) / base,
    determinant3(replaced(2)) / base,
  ];
};

/**
 * Fits the array -> pixel lattice from the table itself.
 *
 * C/D are the chip's regular row/column indices; E/F are the measured pixel
 * coordinates. A least-squares affine fit recovers the pitch, offset and any
 * rotation/shear without assuming an axis-aligned scan.
 */
export function fitSpotPixelMapping(
  spots: readonly BatchSpot[],
): SpotPixelMapping | null {
  const valid = spots.filter((spot) => (
    Number.isFinite(spot.arrayRow)
    && Number.isFinite(spot.arrayCol)
    && Number.isFinite(spot.pxlRowInFullres)
    && Number.isFinite(spot.pxlColInFullres)
  ));
  if (valid.length < 3) return null;

  let sumColCol = 0;
  let sumColRow = 0;
  let sumCol = 0;
  let sumRowRow = 0;
  let sumRow = 0;
  let sumColPxlCol = 0;
  let sumRowPxlCol = 0;
  let sumPxlCol = 0;
  let sumColPxlRow = 0;
  let sumRowPxlRow = 0;
  let sumPxlRow = 0;

  for (const spot of valid) {
    const col = spot.arrayCol;
    const row = spot.arrayRow;
    sumColCol += col * col;
    sumColRow += col * row;
    sumCol += col;
    sumRowRow += row * row;
    sumRow += row;
    sumColPxlCol += col * spot.pxlColInFullres;
    sumRowPxlCol += row * spot.pxlColInFullres;
    sumPxlCol += spot.pxlColInFullres;
    sumColPxlRow += col * spot.pxlRowInFullres;
    sumRowPxlRow += row * spot.pxlRowInFullres;
    sumPxlRow += spot.pxlRowInFullres;
  }

  const normal = [
    [sumColCol, sumColRow, sumCol],
    [sumColRow, sumRowRow, sumRow],
    [sumCol, sumRow, valid.length],
  ] as const;
  const pxCol = solve3(normal, [sumColPxlCol, sumRowPxlCol, sumPxlCol]);
  const pxRow = solve3(normal, [sumColPxlRow, sumRowPxlRow, sumPxlRow]);
  if (!pxCol || !pxRow) return null;

  const [a, b, c] = pxCol;
  const [d, e, f] = pxRow;
  // A zero determinant means every array point collapses onto one line; the
  // table cannot define a pixel lattice in that case.
  if (!Number.isFinite(a * e - b * d) || Math.abs(a * e - b * d) < 1e-9) {
    return null;
  }

  return { a, b, c, d, e, f };
}

/**
 * Recomputes E/F from C/D for every spot.
 *
 * The table's own array columns are the source of truth; the measured pixels
 * only calibrate the lattice. When the fit is impossible the original values
 * are kept so a malformed table still imports.
 */
export function recomputeSpotPixelsFromArray(
  spots: readonly BatchSpot[],
): { spots: BatchSpot[]; mapping: SpotPixelMapping | null } {
  const mapping = fitSpotPixelMapping(spots);
  if (!mapping) {
    return { spots: spots.map((spot) => ({ ...spot })), mapping: null };
  }

  return {
    mapping,
    spots: spots.map((spot) => ({
      ...spot,
      pxlColInFullres: Math.round(
        mapping.a * spot.arrayCol + mapping.b * spot.arrayRow + mapping.c,
      ),
      pxlRowInFullres: Math.round(
        mapping.d * spot.arrayCol + mapping.e * spot.arrayRow + mapping.f,
      ),
    })),
  };
}

/** Writes recomputed E/F values back into the parsed table for export. */
export function withComputedSpotPixels(
  table: BatchPositionsTable,
  spots: readonly BatchSpot[],
): BatchPositionsTable {
  const rowIndex = table.columnIndex.pxl_row_in_fullres;
  const colIndex = table.columnIndex.pxl_col_in_fullres;
  const barcodeIndex = table.columnIndex.barcode;
  if (rowIndex === undefined || colIndex === undefined || barcodeIndex === undefined) {
    return table;
  }

  const byBarcode = new Map(spots.map((spot) => [spot.barcode, spot] as const));
  return {
    ...table,
    rows: table.rows.map((row) => {
      const barcode = (row[barcodeIndex] ?? '').trim();
      const spot = byBarcode.get(barcode);
      if (!spot) return row;

      const cells = [...row];
      cells[rowIndex] = String(spot.pxlRowInFullres);
      cells[colIndex] = String(spot.pxlColInFullres);
      return cells;
    }),
  };
}

/**
 * Rebuilds E/F for every row that has array coordinates.
 *
 * Rows whose measured pixels are empty or malformed used to be dropped by
 * `readSpotsFromPositions`, which left whole rows of the spot grid blank. The
 * lattice is fitted from the rows that do have pixels, then written back to
 * every array row so those rows come back into the overlay and the export.
 */
export function recomputeTablePixelsFromArray(
  table: BatchPositionsTable,
): { table: BatchPositionsTable; mapping: SpotPixelMapping | null } {
  const barcodeIndex = table.columnIndex.barcode;
  const rowIndex = table.columnIndex.array_row;
  const colIndex = table.columnIndex.array_col;
  const pxlRowIndex = table.columnIndex.pxl_row_in_fullres;
  const pxlColIndex = table.columnIndex.pxl_col_in_fullres;
  if (
    barcodeIndex === undefined
    || rowIndex === undefined
    || colIndex === undefined
    || pxlRowIndex === undefined
    || pxlColIndex === undefined
  ) {
    return { table, mapping: null };
  }

  const samples: BatchSpot[] = [];
  for (const row of table.rows) {
    const barcode = (row[barcodeIndex] ?? '').trim();
    const arrayRow = toNumber(row[rowIndex]);
    const arrayCol = toNumber(row[colIndex]);
    const pxlRow = toNumber(row[pxlRowIndex]);
    const pxlCol = toNumber(row[pxlColIndex]);
    if (barcode === '' || arrayRow === null || arrayCol === null) continue;
    if (pxlRow === null || pxlCol === null) continue;

    samples.push({
      barcode,
      inTissue: false,
      arrayRow,
      arrayCol,
      pxlRowInFullres: pxlRow,
      pxlColInFullres: pxlCol,
    });
  }

  const mapping = fitSpotPixelMapping(samples);
  if (!mapping) return { table, mapping: null };

  return {
    mapping,
    table: {
      ...table,
      rows: table.rows.map((row) => {
        const arrayRow = toNumber(row[rowIndex]);
        const arrayCol = toNumber(row[colIndex]);
        if (arrayRow === null || arrayCol === null) return row;

        const cells = [...row];
        cells[pxlRowIndex] = String(Math.round(
          mapping.d * arrayCol + mapping.e * arrayRow + mapping.f,
        ));
        cells[pxlColIndex] = String(Math.round(
          mapping.a * arrayCol + mapping.b * arrayRow + mapping.c,
        ));
        return cells;
      }),
    },
  };
}

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
  /** Group name per barcode, written as the last column (`Colours`). */
  coloursByBarcode?: ReadonlyMap<string, string>,
): string {
  const selectedIndex = table.columnIndex[IN_SELECTED_COLUMN];
  const classIndex = table.columnIndex[SELECTED_CLASS_COLUMN];
  const colorIndex = table.columnIndex[SELECTED_COLOR_COLUMN];
  const coloursIndex = table.columnIndex[SELECTED_COLOURS_COLUMN];
  const header = [...table.header];

  if (selectedIndex === undefined) header.push(IN_SELECTED_COLUMN);
  if (classIndex === undefined) header.push(SELECTED_CLASS_COLUMN);
  if (colorIndex === undefined) header.push(SELECTED_COLOR_COLUMN);
  // Appended last on purpose: the region information is the column people read
  // in the spreadsheet, so it sits at the far right of the file.
  if (coloursIndex === undefined) header.push(SELECTED_COLOURS_COLUMN);

  const effectiveSelectedIndex = selectedIndex ?? header.indexOf(IN_SELECTED_COLUMN);
  const effectiveClassIndex = classIndex ?? header.indexOf(SELECTED_CLASS_COLUMN);
  const effectiveColorIndex = colorIndex ?? header.indexOf(SELECTED_COLOR_COLUMN);
  const effectiveColoursIndex = coloursIndex ?? header.indexOf(SELECTED_COLOURS_COLUMN);
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
    // Group 1 / Group 2 … or the name the operator gave the group.
    cells[effectiveColoursIndex] = selected
      ? coloursByBarcode?.get(barcode) ?? ''
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
