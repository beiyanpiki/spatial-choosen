import type { ChipConfigManifest } from './chipConfigs';
import type { TissueActivationMatrix, TissueActivationValue } from '@/types/built-in';

import { createEmptyMatrix, validateTissueActivationMatrix } from './tissueMatrix';

export type ParsedTissueActivation = {
  chipType: ChipConfigManifest['id'];
  rows: number;
  columns: number;
  matrix: TissueActivationMatrix;
};

/**
 * Grid extents for the two supported capture chips. These mirror the on-disk
 * manifests (`/public/built-in-chip-configs/{50um,15um}/manifest.json`) and
 * `SUPPORTED_TISSUE_GRIDS` in `tissueSupport.ts`. The parser is synchronous, so
 * it cannot call the async manifest loader; keep these in sync if a chip is
 * ever added.
 */
const CHIP_GRID_BY_TYPE = {
  '50um': { rows: 64, columns: 64 },
  '15um': { rows: 96, columns: 96 },
} as const satisfies Record<ChipConfigManifest['id'], { rows: number; columns: number }>;

const inferChipType = (
  rows: number,
  columns: number,
): ChipConfigManifest['id'] => {
  for (const chipType of Object.keys(CHIP_GRID_BY_TYPE) as ChipConfigManifest['id'][]) {
    const grid = CHIP_GRID_BY_TYPE[chipType];
    if (grid.rows === rows && grid.columns === columns) {
      return chipType;
    }
  }
  throw new Error(
    `Cannot infer chip type from a ${rows}x${columns} grid. Expected 64x64 (50um) or 96x96 (15um).`,
  );
};

const findColumnIndex = (header: string[], candidateNames: string[]): number => {
  for (const name of candidateNames) {
    const index = header.indexOf(name);
    if (index >= 0) {
      return index;
    }
  }
  return -1;
};

type ParsedRow = {
  csvRow: number;
  csvCol: number;
  tissue: TissueActivationValue;
};

const parseTissueValue = (raw: string | undefined): TissueActivationValue => {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') {
    throw new Error('Tissue activation CSV has an empty tissue value.');
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || (value !== 0 && value !== 1)) {
    throw new Error(`Tissue activation CSV has a non-binary tissue value "${trimmed}".`);
  }
  return value;
};

/**
 * Parse a tissue-activation CSV exported by `/preprocess` (and lightly processed
 * externally). Expected columns (matched by header name, case-insensitive, with
 * the standard export names as fallbacks):
 *   - activation: `tissue` (or `in_tissue`) — `0`/`1`
 *   - chip row:    `row` (or `array_row`) — 1-based
 *   - chip col:    `col` (or `array_col`) — 1-based
 * Other columns (e.g. `barcode`, `Log2_nGene_Spatial`) are ignored.
 *
 * Chip type is inferred from the grid extent (max row × max col): 64×64 → 50um,
 * 96×96 → 15um. Grid cells absent from the CSV are treated as inactive (`0`).
 */
export const parseTissueActivationCsv = (csvText: string): ParsedTissueActivation => {
  const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    throw new Error('Tissue activation CSV is empty.');
  }

  const header = lines[0].split(',').map((value) => value.trim().toLowerCase());
  const tissueIndex = findColumnIndex(header, ['tissue', 'in_tissue']);
  const rowIndex = findColumnIndex(header, ['row', 'array_row']);
  const colIndex = findColumnIndex(header, ['col', 'array_col']);
  if (tissueIndex < 0 || rowIndex < 0 || colIndex < 0) {
    throw new Error(
      'Tissue activation CSV is missing required columns (tissue, row, col).',
    );
  }

  const parsedRows: ParsedRow[] = [];
  let maxRow = 0;
  let maxCol = 0;
  for (const line of lines.slice(1)) {
    const columns = line.split(',');
    const csvRow = Number(columns[rowIndex]?.trim() ?? '');
    const csvCol = Number(columns[colIndex]?.trim() ?? '');
    if (!Number.isInteger(csvRow) || !Number.isInteger(csvCol)) {
      throw new Error('Tissue activation CSV has a non-integer row/col coordinate.');
    }
    const tissue = parseTissueValue(columns[tissueIndex]);
    parsedRows.push({ csvRow, csvCol, tissue });
    if (csvRow > maxRow) maxRow = csvRow;
    if (csvCol > maxCol) maxCol = csvCol;
  }

  if (parsedRows.length === 0) {
    throw new Error('Tissue activation CSV has no data rows.');
  }
  if (maxRow <= 0 || maxCol <= 0) {
    throw new Error('Tissue activation CSV has invalid grid dimensions.');
  }

  const chipType = inferChipType(maxRow, maxCol);
  const rows = maxRow;
  const columns = maxCol;

  const matrix = createEmptyMatrix(rows, columns);
  for (const { csvRow, csvCol, tissue } of parsedRows) {
    if (csvRow < 1 || csvRow > rows || csvCol < 1 || csvCol > columns) {
      continue;
    }

    // The exported CSV stores `row` in top-left/image origin, while the
    // in-memory `TissueActivationMatrix` is bottom-left origin. Flip the row so
    // importing is the inverse of exporting (see exportBundle.ts). `col` is not
    // flipped.
    const matrixArrayRow = rows + 1 - csvRow;
    const index = (matrixArrayRow - 1) * columns + (csvCol - 1);
    matrix.values[index] = tissue;
  }

  validateTissueActivationMatrix(matrix);

  return { chipType, rows, columns, matrix };
};
