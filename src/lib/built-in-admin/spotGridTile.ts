import { heatmapColor } from './expressionColors';
import { isSpotExcluded, type ExclusionConfig } from './exclusion';

/**
 * Offscreen-tile builder for the Step 2 capture-area grid overlay.
 *
 * The grid renders the full chip matrix (rows × columns) inside the capture
 * box using the same relative layout as the downstream chip projection
 * (`projectSpotsForCrop` in spotProjection.ts): extent = cols·d + (cols+1)·g,
 * cells centered at `gap + i·(spotPx + gap) + spotPx/2`. Because the box is a
 * normalized square (screen-rectangular for non-square images), the caller
 * draws the square tile into the min-dimension sub-rect of the box — exactly
 * how the projection fits the square grid into the crop with centered margins.
 *
 * Exclusion semantics (user note 2.4): excluded rows/columns stay in place and
 * are only dimmed — the box size and the grid extent are never changed.
 */

export type SpotGridConfig = {
  rows: number;
  columns: number;
  spotDiameter: number;
  spotGap: number;
  /** Min-max normalized expression keyed by in-memory `${arrayRow}:${arrayCol}` (image-top convention). */
  normalizedByPosition: Record<string, number>;
  excludedRows: number[];
  excludedColumns: number[];
};

/** Heatmap alpha on the eosin background — raise/lower if cells read too opaque or too faint. */
export const HEATMAP_ALPHA_HEX = 'b3';

/** Slate fill for cells without an expression value (eosin shows through). */
export const NEUTRAL_CELL_FILL = '#cbd5e026';

/** Dark translucent fill for excluded cells. */
export const EXCLUDED_CELL_FILL = 'rgba(15, 23, 42, 0.55)';

/** Robust-scale percentiles: values outside this band are clipped to the
 *  endpoints so a handful of extreme cells cannot crush the mid-range into a
 *  single color (tune these to change the heatmap's sensitivity). */
export const HEATMAP_LOW_PERCENTILE = 0.02;
export const HEATMAP_HIGH_PERCENTILE = 0.98;

const isExcluded = (
  config: Pick<SpotGridConfig, 'excludedRows' | 'excludedColumns'>,
  arrayRow: number,
  arrayCol: number,
) => config.excludedRows.includes(arrayRow) || config.excludedColumns.includes(arrayCol);

/**
 * Normalize `Log2_nGene_Spatial` values to [0, 1] over the cells actually
 * rendered (positions within 1..rows × 1..columns, image-top convention,
 * minus excluded rows/columns). Scaling is percentile-based (winsorized
 * min-max over `HEATMAP_LOW_PERCENTILE`..`HEATMAP_HIGH_PERCENTILE`) so a few
 * extreme low or high cells do not compress the visible mid-range; values
 * outside the band are clipped to 0/1. Cells without a value are omitted; a
 * degenerate range maps every value to the midpoint. The result is used by
 * the tile builder only.
 */
export function buildNormalizedExpressionByPosition(
  log2nGeneByPosition: Record<string, number>,
  rows: number,
  columns: number,
  exclusion?: ExclusionConfig,
): Record<string, number> {
  const entries = Object.entries(log2nGeneByPosition).filter(([key, value]) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    const [row, col] = key.split(':').map(Number);
    if (
      !Number.isInteger(row) || !Number.isInteger(col)
      || row < 1 || row > rows || col < 1 || col > columns
    ) {
      return false;
    }
    return !(exclusion && isSpotExcluded(exclusion, row, col));
  });

  if (entries.length === 0) return {};

  const sorted = entries.map(([, value]) => value).sort((left, right) => left - right);
  const percentile = (p: number) => (
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]
  );
  const low = percentile(HEATMAP_LOW_PERCENTILE);
  const high = percentile(HEATMAP_HIGH_PERCENTILE);
  const range = high - low;

  const normalized: Record<string, number> = {};
  for (const [key, value] of entries) {
    normalized[key] = range > 0
      ? Math.min(1, Math.max(0, (value - low) / range))
      : 0.5;
  }
  return normalized;
}

export type GridCellLayout = {
  scale: number;
  spotPx: number;
  gapPx: number;
  /** Cell centers in tile pixels, in row-major order (arrayRow 1 = first, image-top). */
  centers: Array<{ arrayRow: number; arrayCol: number; x: number; y: number }>;
};

/**
 * Compute the cell layout for a targetPx square tile. Mirrors
 * `projectSpotsForCrop` (`src/lib/built-in-admin/spotProjection.ts`): the
 * extent includes one gap margin on every side and the pitch is constant.
 */
export function computeGridCellLayout(
  rows: number,
  columns: number,
  spotDiameter: number,
  spotGap: number,
  targetPx: number,
): GridCellLayout {
  const extent = columns * spotDiameter + (columns + 1) * spotGap;
  const scale = targetPx / extent;
  const spotPx = spotDiameter * scale;
  const gapPx = spotGap * scale;

  const centers: GridCellLayout['centers'] = [];
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    for (let colIndex = 0; colIndex < columns; colIndex += 1) {
      centers.push({
        arrayRow: rowIndex + 1,
        arrayCol: colIndex + 1,
        x: gapPx + colIndex * (spotPx + gapPx) + spotPx / 2,
        y: gapPx + rowIndex * (spotPx + gapPx) + spotPx / 2,
      });
    }
  }

  return { scale, spotPx, gapPx, centers };
}

/**
 * Display-only compaction: drop the excluded rows/columns from the grid and
 * re-fit the remaining cells so the tile still fills the capture box (fewer
 * cells at a larger spot scale). Expression keys are remapped to the
 * compacted indices and the returned config has no exclusions left, so the
 * tile builder never draws the dark excluded fill. Nothing here touches the
 * export path — the caller decides whether to display the compacted grid.
 * Returns the same config object when there is nothing to remove.
 */
export function compactSpotGridForDisplay(config: SpotGridConfig): SpotGridConfig {
  if (config.excludedRows.length === 0 && config.excludedColumns.length === 0) {
    return config;
  }
  const excludedRows = new Set(config.excludedRows);
  const excludedColumns = new Set(config.excludedColumns);
  const rows: number[] = [];
  const columns: number[] = [];
  for (let arrayRow = 1; arrayRow <= config.rows; arrayRow += 1) {
    if (!excludedRows.has(arrayRow)) rows.push(arrayRow);
  }
  for (let arrayCol = 1; arrayCol <= config.columns; arrayCol += 1) {
    if (!excludedColumns.has(arrayCol)) columns.push(arrayCol);
  }
  const compactRow = new Map(rows.map((arrayRow, index) => [arrayRow, index + 1]));
  const compactCol = new Map(columns.map((arrayCol, index) => [arrayCol, index + 1]));

  const normalizedByPosition: Record<string, number> = {};
  for (const [key, value] of Object.entries(config.normalizedByPosition)) {
    const [arrayRow, arrayCol] = key.split(':').map(Number);
    const row = compactRow.get(arrayRow);
    const col = compactCol.get(arrayCol);
    if (row && col) {
      normalizedByPosition[`${row}:${col}`] = value;
    }
  }

  return {
    ...config,
    rows: rows.length,
    columns: columns.length,
    excludedRows: [],
    excludedColumns: [],
    normalizedByPosition,
  };
}

/**
 * Deterministic cache key for a grid config. Computed by the caller when the
 * config changes (not per frame), so CanvasStage only pays a string compare.
 */
export function gridSignature(config: SpotGridConfig): string {
  const cells = Object.entries(config.normalizedByPosition)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, value]) => `${key}:${value}`)
    .join(',');
  return [
    config.rows,
    config.columns,
    config.spotDiameter,
    config.spotGap,
    config.excludedRows.join(','),
    config.excludedColumns.join(','),
    cells,
  ].join('|');
}

/**
 * Build a targetPx × targetPx offscreen canvas with one square cell per spot:
 * excluded cells are dimmed, cells with an expression value use the heatmap
 * color, everything else falls back to the neutral fill.
 */
export function buildSpotGridTile(
  config: SpotGridConfig,
  targetPx: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = targetPx;
  canvas.height = targetPx;
  const context = canvas.getContext('2d');
  if (!context) {
    return canvas;
  }

  const { spotPx, centers } = computeGridCellLayout(
    config.rows,
    config.columns,
    config.spotDiameter,
    config.spotGap,
    targetPx,
  );
  const half = spotPx / 2;

  for (const { arrayRow, arrayCol, x, y } of centers) {
    if (isExcluded(config, arrayRow, arrayCol)) {
      context.fillStyle = EXCLUDED_CELL_FILL;
    } else {
      const normalized = config.normalizedByPosition[`${arrayRow}:${arrayCol}`];
      context.fillStyle = typeof normalized === 'number'
        ? heatmapColor(normalized, HEATMAP_ALPHA_HEX)
        : NEUTRAL_CELL_FILL;
    }
    context.fillRect(x - half, y - half, spotPx, spotPx);
  }

  return canvas;
}
