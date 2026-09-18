import polygonClipping from 'polygon-clipping';
import type {
  BatchAffineMatrix,
  BatchImageSize,
  BatchRegion,
  BatchSimilarityParams,
  BatchSpot,
  BatchSpotAnchorMode,
} from '@/types/batch';

import { normalizeSimilarityParams } from './affine';
import { createRegionId } from './regions';
import { spotRect } from './selection';

export const TRANSFORM_MATRIX_FILE_PATTERN = /^transform-matrix\.csv$/i;
export const IN_SELECTED_VALUE = '1';

/**
 * Reads the two affine rows written by step 5 (`a,b,c` / `d,e,f`).
 *
 * A 3x3 homogeneous payload is accepted as well; the trailing row is ignored.
 */
export function parseTransformMatrixCsv(text: string): BatchAffineMatrix | null {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.split(',').map((cell) => Number(cell.trim())));

  if (rows.length < 2) return null;

  const [first, second] = rows;
  if (first.length < 3 || second.length < 3) return null;

  const matrix: BatchAffineMatrix = [
    first[0], first[1], first[2],
    second[0], second[1], second[2],
  ];

  return matrix.every((value) => Number.isFinite(value)) ? matrix : null;
}

/**
 * Recovers the manual alignment parameters from an own-size-frame matrix.
 *
 * Step 5 writes the operation in the package's own pixel grid, so the linear
 * part carries the rotation and scale directly and `c` / `f` carry where the
 * image centre landed. Flips are recovered from the direction of the second
 * row; a mirrored matrix always resolves to an equivalent parameter set.
 */
export function similarityParamsFromOwnFrameMatrix(
  matrix: BatchAffineMatrix,
  sourceSize: BatchImageSize,
): BatchSimilarityParams | null {
  const [a, b, c, d, e, f] = matrix;
  if (sourceSize.width <= 0 || sourceSize.height <= 0) return null;

  // The own-size matrix keeps the pixel aspect of the package frame, so the
  // off-diagonal term has to be brought back to normalized units first.
  const aspect = sourceSize.width / sourceSize.height;
  const rotationRadians = Math.atan2(-b / aspect, a);
  const scale = Math.hypot(a, b / aspect);

  if (!Number.isFinite(rotationRadians) || !Number.isFinite(scale) || scale <= 0) {
    return null;
  }

  const cos = Math.cos(rotationRadians);
  const sin = Math.sin(rotationRadians);
  const expectedD = scale * sin / aspect;
  const expectedE = scale * cos;
  const reflected = d * expectedD + e * expectedE < 0;
  const flipY = reflected ? -1 : 1;

  const offsetX = c / sourceSize.width - 0.5 + scale * (0.5 * cos - 0.5 * sin);
  const offsetY = f / sourceSize.height
    - 0.5
    + flipY * scale * (0.5 * sin + 0.5 * cos);

  return normalizeSimilarityParams({
    rotationDegrees: (rotationRadians * 180) / Math.PI,
    scale,
    flipHorizontal: false,
    flipVertical: reflected,
    offsetX,
    offsetY,
  });
}

type Square = {
  x: number;
  y: number;
  width: number;
  height: number;
  arrayRow: number;
  arrayCol: number;
};

type Ring = [number, number][];

/**
 * Collapses consecutive spots of one grid row into a single rectangle.
 *
 * The bounds are taken from the spot squares themselves rather than from grid
 * arithmetic, so the result always covers every square it replaced. Vertical
 * merging is deliberately skipped: it bought little and the previous
 * implementation silently dropped or mis-sized rectangles for real selections.
 */
function mergeRowRuns(squares: readonly Square[]): Square[] {
  const byRow = new Map<number, Square[]>();

  for (const square of squares) {
    const row = byRow.get(square.arrayRow);
    if (row) {
      row.push(square);
    } else {
      byRow.set(square.arrayRow, [square]);
    }
  }

  const merged: Square[] = [];

  for (const row of byRow.values()) {
    row.sort((left, right) => left.arrayCol - right.arrayCol);

    let run = { ...row[0] };
    let runMaxX = run.x + run.width;
    let runMaxY = run.y + run.height;

    for (const square of row.slice(1)) {
      if (square.arrayCol === run.arrayCol + 1) {
        run.arrayCol = square.arrayCol;
        runMaxX = Math.max(runMaxX, square.x + square.width);
        runMaxY = Math.max(runMaxY, square.y + square.height);
        run.x = Math.min(run.x, square.x);
        run.y = Math.min(run.y, square.y);
        continue;
      }

      merged.push({ ...run, width: runMaxX - run.x, height: runMaxY - run.y });
      run = { ...square };
      runMaxX = run.x + run.width;
      runMaxY = run.y + run.height;
    }

    merged.push({ ...run, width: runMaxX - run.x, height: runMaxY - run.y });
  }

  return merged;
}

const toRing = (square: Square): Ring => [
  [square.x, square.y],
  [square.x + square.width, square.y],
  [square.x + square.width, square.y + square.height],
  [square.x, square.y + square.height],
];

const ringToPoints = (ring: Ring) => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const isClosed = ring.length > 1 && first[0] === last[0] && first[1] === last[1];

  return (isClosed ? ring.slice(0, -1) : ring).map(([x, y]) => ({ x, y }));
};

/**
 * Rebuilds editable regions from an `in_selected` column.
 *
 * The previous export only stores per-barcode flags, so the region is rebuilt
 * as the union of the selected spot squares. Re-running the same centre test
 * over that union returns exactly the same barcodes, which is what makes a
 * resumed batch continue from the previous result.
 */
export function regionsFromSelectedBarcodes(args: {
  spots: readonly BatchSpot[];
  selectedBarcodes: Iterable<string>;
  size: BatchImageSize;
  anchorMode: BatchSpotAnchorMode;
  spotDiameterFullres: number | null;
}): BatchRegion[] {
  const selected = new Set(args.selectedBarcodes);
  if (selected.size === 0 || args.spots.length === 0) return [];
  if (args.size.width <= 0 || args.size.height <= 0) return [];

  const selectedSquares = args.spots
    .filter((spot) => selected.has(spot.barcode))
    .map((spot): Square => {
      const rect = spotRect(spot, args.anchorMode, args.spotDiameterFullres);
      return { ...rect, arrayRow: spot.arrayRow, arrayCol: spot.arrayCol };
    });

  if (selectedSquares.length === 0) return [];

  const runs = mergeRowRuns(selectedSquares);
  let union: [Ring][] = [[toRing(runs[0])]];
  for (const run of runs.slice(1)) {
    union = polygonClipping.union(union as never, [toRing(run)] as never) as unknown as [Ring][];
  }

  return union
    .flat()
    .map((ring) => ringToPoints(ring as Ring))
    .filter((points) => points.length >= 3)
    .map((points) => ({
      id: createRegionId('resumed'),
      points: points.map((point) => ({
        x: point.x / args.size.width,
        y: point.y / args.size.height,
      })),
    }));
}
