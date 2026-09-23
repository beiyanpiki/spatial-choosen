import type {
  BatchAffineMatrix,
  BatchImageSize,
  BatchMatrixConvention,
  BatchPoint,
  BatchSimilarityParams,
} from '@/types/batch';

export const IDENTITY_AFFINE: BatchAffineMatrix = [1, 0, 0, 0, 1, 0];

export const DEFAULT_SIMILARITY_PARAMS: BatchSimilarityParams = {
  rotationDegrees: 0,
  scale: 1,
  flipHorizontal: false,
  flipVertical: false,
  offsetX: 0,
  offsetY: 0,
};

export const SIMILARITY_SCALE_MIN = 0.1;
export const SIMILARITY_SCALE_MAX = 10;

/**
 * Frame written to `transform-matrix.csv` unless the operator picks another.
 *
 * The export describes the alignment operation itself: package pixels map to
 * the same image's canvas after the rotate/scale/translate was applied, so the
 * linear part equals the factors that were dialled in.
 */
export const DEFAULT_MATRIX_CONVENTION: BatchMatrixConvention = 'source-frame';

const DEGREES_TO_RADIANS = Math.PI / 180;

export type StageRect = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function normalizeSimilarityParams(
  params: Partial<BatchSimilarityParams> | null | undefined,
): BatchSimilarityParams {
  const rotation = params?.rotationDegrees ?? DEFAULT_SIMILARITY_PARAMS.rotationDegrees;
  const scale = params?.scale ?? DEFAULT_SIMILARITY_PARAMS.scale;
  const offsetX = params?.offsetX ?? 0;
  const offsetY = params?.offsetY ?? 0;

  return {
    rotationDegrees: clamp(Number.isFinite(rotation) ? rotation : 0, -180, 180),
    scale: clamp(Number.isFinite(scale) ? scale : 1, SIMILARITY_SCALE_MIN, SIMILARITY_SCALE_MAX),
    flipHorizontal: Boolean(params?.flipHorizontal),
    flipVertical: Boolean(params?.flipVertical),
    offsetX: Number.isFinite(offsetX) ? offsetX : 0,
    offsetY: Number.isFinite(offsetY) ? offsetY : 0,
  };
}

export function applyAffine(matrix: BatchAffineMatrix, point: BatchPoint): BatchPoint {
  const [a, b, c, d, e, f] = matrix;

  return {
    x: a * point.x + b * point.y + c,
    y: d * point.x + e * point.y + f,
  };
}

/** `composeAffine(second, first)` applies `first` and then `second`. */
export function composeAffine(
  second: BatchAffineMatrix,
  first: BatchAffineMatrix,
): BatchAffineMatrix {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;

  return [
    a2 * a1 + b2 * d1,
    a2 * b1 + b2 * e1,
    a2 * c1 + b2 * f1 + c2,
    d2 * a1 + e2 * d1,
    d2 * b1 + e2 * e1,
    d2 * c1 + e2 * f1 + f2,
  ];
}

export function invertAffine(matrix: BatchAffineMatrix): BatchAffineMatrix | null {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * e - b * d;

  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    return null;
  }

  return [
    e / determinant,
    -b / determinant,
    (b * f - c * e) / determinant,
    -d / determinant,
    a / determinant,
    (c * d - a * f) / determinant,
  ];
}

/** Scales the input coordinates of `matrix` before it is applied. */
export function scaleAffineInput(
  matrix: BatchAffineMatrix,
  scaleX: number,
  scaleY: number,
): BatchAffineMatrix {
  return [
    matrix[0] * scaleX,
    matrix[1] * scaleY,
    matrix[2],
    matrix[3] * scaleX,
    matrix[4] * scaleY,
    matrix[5],
  ];
}

/** Scales the output coordinates produced by `matrix`. */
export function scaleAffineOutput(
  matrix: BatchAffineMatrix,
  scaleX: number,
  scaleY: number,
): BatchAffineMatrix {
  return [
    matrix[0] * scaleX,
    matrix[1] * scaleX,
    matrix[2] * scaleX,
    matrix[3] * scaleY,
    matrix[4] * scaleY,
    matrix[5] * scaleY,
  ];
}

export function isFiniteMatrix(matrix: BatchAffineMatrix): boolean {
  return matrix.every((value) => Number.isFinite(value));
}

export function similarityNormalizedMatrix(
  params: BatchSimilarityParams,
): BatchAffineMatrix {
  const normalized = normalizeSimilarityParams(params);
  const radians = normalized.rotationDegrees * DEGREES_TO_RADIANS;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const flipX = normalized.flipHorizontal ? -1 : 1;
  const flipY = normalized.flipVertical ? -1 : 1;
  const scale = normalized.scale;

  return [
    flipX * scale * cos,
    -flipX * scale * sin,
    0.5 + normalized.offsetX - flipX * scale * (cos * 0.5 - sin * 0.5),
    flipY * scale * sin,
    flipY * scale * cos,
    0.5 + normalized.offsetY - flipY * scale * (sin * 0.5 + cos * 0.5),
  ];
}

/**
 * Pixel-space matrix mapping a moving image onto the reference image.
 *
 * The manual alignment UI stores normalized similarity parameters; downstream
 * artifacts (`transform-matrix.csv`, barcode tests) need a pixel-space 2x3
 * matrix, which is what this produces.
 */
export function similarityPixelMatrix(
  params: BatchSimilarityParams,
  sourceSize: BatchImageSize,
  destinationSize: BatchImageSize,
): BatchAffineMatrix {
  const normalized = similarityNormalizedMatrix(params);
  const sourcePixelsToNormalized: BatchAffineMatrix = [
    1 / sourceSize.width,
    0,
    0,
    0,
    1 / sourceSize.height,
    0,
  ];
  const normalizedToDestinationPixels: BatchAffineMatrix = [
    destinationSize.width,
    0,
    0,
    0,
    destinationSize.height,
    0,
  ];

  return composeAffine(
    normalizedToDestinationPixels,
    composeAffine(normalized, sourcePixelsToNormalized),
  );
}

/**
 * Re-expresses a reference-frame matrix against a canvas the size of the source
 * image.
 *
 * The alignment itself is unchanged; only the frame the result is written in
 * differs. For square images this makes the linear part of the matrix equal to
 * the rotate/scale factors that were dialled in during alignment, instead of
 * the factors scaled by the reference/source size ratio.
 */
export function toSourceFrameMatrix(
  referenceFrameMatrix: BatchAffineMatrix,
  sourceSize: BatchImageSize,
  referenceSize: BatchImageSize,
): BatchAffineMatrix {
  return scaleAffineOutput(
    referenceFrameMatrix,
    sourceSize.width / referenceSize.width,
    sourceSize.height / referenceSize.height,
  );
}

/**
 * Resolves the matrix written to `transform-matrix.csv` for one package.
 */
export function resolvePackageMatrix(args: {
  convention: 'reference-frame' | 'source-frame';
  params: BatchSimilarityParams;
  sourceSize: BatchImageSize;
  referenceSize: BatchImageSize;
}): BatchAffineMatrix {
  const referenceFrame = similarityPixelMatrix(args.params, args.sourceSize, args.referenceSize);

  if (args.convention === 'source-frame') {
    return toSourceFrameMatrix(referenceFrame, args.sourceSize, args.referenceSize);
  }

  return referenceFrame;
}

/**
 * Turns a normalized similarity matrix back into parameters.
 *
 * Mirroring is folded into `flipVertical` and the rotation, which always yields
 * an equivalent transform without needing to know how it was originally dialled
 * in.
 */
export function decomposeNormalizedSimilarity(
  matrix: BatchAffineMatrix,
): BatchSimilarityParams | null {
  const [a, b, c, d, e, f] = matrix;
  const scale = Math.hypot(a, b);

  if (!Number.isFinite(scale) || scale <= 1e-9) return null;

  const rotationRadians = Math.atan2(-b, a);
  const cos = Math.cos(rotationRadians);
  const sin = Math.sin(rotationRadians);
  const reflected = d * (scale * sin) + e * (scale * cos) < 0;
  const flipY = reflected ? -1 : 1;

  return normalizeSimilarityParams({
    rotationDegrees: (rotationRadians * 180) / Math.PI,
    scale,
    flipHorizontal: false,
    flipVertical: reflected,
    offsetX: c - 0.5 + scale * (0.5 * cos - 0.5 * sin),
    offsetY: f - 0.5 + flipY * scale * (0.5 * sin + 0.5 * cos),
  });
}

/**
 * Re-expresses a `package -> reference` alignment against a different reference.
 *
 * Switching the reference image must not move anything: the old reference
 * becomes an ordinary package, so every transform (and the region drawn on it)
 * is re-based with `inverse(newReference) * oldTransform`.
 */
export function rebaseSimilarityParams(
  params: BatchSimilarityParams,
  newReferenceParams: BatchSimilarityParams,
): BatchSimilarityParams {
  const fallback = normalizeSimilarityParams(params);
  const toNewReference = invertAffine(similarityNormalizedMatrix(newReferenceParams));
  if (!toNewReference) return fallback;

  const rebased = composeAffine(toNewReference, similarityNormalizedMatrix(params));
  return decomposeNormalizedSimilarity(rebased) ?? fallback;
}

export function normalizedToPixelPoints(
  points: readonly BatchPoint[],
  size: BatchImageSize,
): BatchPoint[] {
  return points.map((point) => ({ x: point.x * size.width, y: point.y * size.height }));
}

/**
 * Matrix mapping the reference image's full-resolution pixels onto the stage
 * viewport. Both the stage rect and the reference frame are pixel-space here,
 * so callers can compose it with package transforms directly.
 */
export function referencePixelToStageMatrix(
  referenceSize: BatchImageSize,
  stage: StageRect,
): BatchAffineMatrix {
  return [
    stage.width / referenceSize.width,
    0,
    stage.originX,
    0,
    stage.height / referenceSize.height,
    stage.originY,
  ];
}

/**
 * Stage rect that fits an image with the given pixel size inside a viewport
 * while preserving aspect ratio.
 */
export function fitStageRect(
  viewport: BatchImageSize,
  imageSize: BatchImageSize,
): StageRect {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return { originX: 0, originY: 0, width: 0, height: 0 };
  }

  const ratio = imageSize.height > 0 ? imageSize.width / imageSize.height : 1;
  let width = viewport.width;
  let height = width / ratio;

  if (height > viewport.height) {
    height = viewport.height;
    width = height * ratio;
  }

  return {
    originX: (viewport.width - width) / 2,
    originY: (viewport.height - height) / 2,
    width,
    height,
  };
}

export function formatMatrixCsv(
  matrix: BatchAffineMatrix,
  layout: '2x3' | '3x3',
): string {
  const [a, b, c, d, e, f] = matrix;
  const format = (value: number) => (
    Number.isFinite(value) ? String(Number(value.toPrecision(12))) : '0'
  );
  const firstRow = [a, b, c].map(format).join(',');
  const secondRow = [d, e, f].map(format).join(',');

  if (layout === '3x3') {
    return `${firstRow}\n${secondRow}\n0,0,1\n`;
  }

  return `${firstRow}\n${secondRow}\n`;
}
