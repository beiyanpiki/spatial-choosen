import { heatmapColor } from './expressionColors';

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

const isExcluded = (
  config: Pick<SpotGridConfig, 'excludedRows' | 'excludedColumns'>,
  arrayRow: number,
  arrayCol: number,
) => config.excludedRows.includes(arrayRow) || config.excludedColumns.includes(arrayCol);

/**
 * Min-max normalize `Log2_nGene_Spatial` values to [0, 1] over the values
 * present on the grid (positions within 1..rows × 1..columns, image-top
 * convention). Cells without a value are omitted; a degenerate range maps
 * every value to the midpoint. The result is used by the tile builder only.
 */
export function buildNormalizedExpressionByPosition(
  log2nGeneByPosition: Record<string, number>,
  rows: number,
  columns: number,
): Record<string, number> {
  const entries = Object.entries(log2nGeneByPosition).filter(([key, value]) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    const [row, col] = key.split(':').map(Number);
    return (
      Number.isInteger(row) && Number.isInteger(col)
      && row >= 1 && row <= rows && col >= 1 && col <= columns
    );
  });

  if (entries.length === 0) return {};

  let min = Infinity;
  let max = -Infinity;
  for (const [, value] of entries) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min;

  const normalized: Record<string, number> = {};
  for (const [key, value] of entries) {
    normalized[key] = range > 0 ? (value - min) / range : 0.5;
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
