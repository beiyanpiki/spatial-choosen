import { describe, expect, it } from 'vitest';

import type { BatchAffineMatrix, BatchSimilarityParams } from '@/types/batch';

import {
  IDENTITY_AFFINE,
  applyAffine,
  composeAffine,
  decomposeNormalizedSimilarity,
  formatMatrixCsv,
  invertAffine,
  normalizeSimilarityParams,
  resolvePackageMatrix,
  rebaseSimilarityParams,
  similarityNormalizedMatrix,
  similarityPixelMatrix,
  toSourceFrameMatrix,
} from './affine';

const params = (overrides: Partial<BatchSimilarityParams> = {}): BatchSimilarityParams =>
  normalizeSimilarityParams({ ...overrides });

const closePoint = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
};

describe('similarityNormalizedMatrix', () => {
  it('keeps the moving image centre fixed for every rotation and scale', () => {
    const matrix = similarityNormalizedMatrix(params({
      rotationDegrees: 37,
      scale: 3.4,
      offsetX: 0.12,
      offsetY: -0.08,
    }));

    closePoint(applyAffine(matrix, { x: 0.5, y: 0.5 }), { x: 0.62, y: 0.42 });
  });

  it('scales about the centre in normalized space', () => {
    const matrix = similarityNormalizedMatrix(params({ scale: 2 }));

    closePoint(applyAffine(matrix, { x: 0.75, y: 0.5 }), { x: 1, y: 0.5 });
    closePoint(applyAffine(matrix, { x: 0.5, y: 0.75 }), { x: 0.5, y: 1 });
  });

  it('rotates by the requested degrees', () => {
    const matrix = similarityNormalizedMatrix(params({ rotationDegrees: 90, scale: 2 }));

    closePoint(applyAffine(matrix, { x: 0.5, y: 0.75 }), { x: 0, y: 0.5 });
  });

  it('applies flips after rotation', () => {
    const matrix = similarityNormalizedMatrix(params({ scale: 2, flipHorizontal: true }));

    closePoint(applyAffine(matrix, { x: 0.75, y: 0.5 }), { x: 0, y: 0.5 });
  });
});

describe('affine helpers', () => {
  it('inverts a matrix so the round trip is the identity', () => {
    const matrix = similarityNormalizedMatrix(params({ rotationDegrees: 23, scale: 1.7, offsetX: 0.05 }));
    const inverse = invertAffine(matrix);
    expect(inverse).not.toBeNull();

    const point = { x: 0.31, y: 0.82 };
    closePoint(applyAffine(inverse as typeof matrix, applyAffine(matrix, point)), point);
  });

  it('composes second-after-first', () => {
    const first = similarityNormalizedMatrix(params({ offsetX: 0.25 }));
    const second = similarityNormalizedMatrix(params({ scale: 2 }));

    closePoint(
      applyAffine(composeAffine(second, first), { x: 0.5, y: 0.5 }),
      { x: 1, y: 0.5 },
    );
  });

  it('reports a non-invertible matrix', () => {
    expect(invertAffine([0, 0, 1, 0, 0, 1])).toBeNull();
  });
});

describe('similarityPixelMatrix', () => {
  it('maps package pixels into reference pixels', () => {
    const matrix = similarityPixelMatrix(
      params({ scale: 2 }),
      { width: 100, height: 100 },
      { width: 200, height: 200 },
    );

    // u0 = 2u - 0.5 in normalized space -> 4x - 100 in pixel space.
    expect(matrix).toEqual([4, 0, -100, 0, 4, -100]);
    closePoint(applyAffine(matrix, { x: 50, y: 50 }), { x: 100, y: 100 });
  });

  it('respects anisotropic frame sizes', () => {
    const matrix = similarityPixelMatrix(
      params(),
      { width: 100, height: 50 },
      { width: 300, height: 200 },
    );

    closePoint(applyAffine(matrix, { x: 0, y: 0 }), { x: 0, y: 0 });
    closePoint(applyAffine(matrix, { x: 100, y: 50 }), { x: 300, y: 200 });
  });
});

describe('formatMatrixCsv', () => {
  it('writes two affine rows by default', () => {
    expect(formatMatrixCsv([1, 0, 5, 0, 1, -2], '2x3')).toBe('1,0,5\n0,1,-2\n');
  });

  it('appends the homogeneous row for 3x3 output', () => {
    expect(formatMatrixCsv([1, 0, 5, 0, 1, -2], '3x3')).toBe('1,0,5\n0,1,-2\n0,0,1\n');
  });

  it('trims floating point noise without losing precision', () => {
    expect(formatMatrixCsv([0.1 + 0.2, 0, 0, 0, 1, 0], '2x3')).toBe('0.3,0,0\n0,1,0\n');
  });
});

describe('matrix frames', () => {
  it('keeps the operation factors when the output frame matches the source image', () => {
    const params = normalizeSimilarityParams({ rotationDegrees: 30, scale: 1.4 });
    const sourceSize = { width: 6005, height: 6005 };
    const referenceSize = { width: 2884, height: 2884 };

    const referenceFrame = resolvePackageMatrix({
      convention: 'reference-frame',
      params,
      sourceSize,
      referenceSize,
    });
    const sourceFrame = resolvePackageMatrix({
      convention: 'source-frame',
      params,
      sourceSize,
      referenceSize,
    });

    // The reference frame folds in the 2884/6005 sampling ratio.
    expect(Math.hypot(referenceFrame[0], referenceFrame[3])).toBeCloseTo(1.4 * (2884 / 6005), 10);
    // The source frame exposes the rotate/scale that was dialled in.
    expect(Math.hypot(sourceFrame[0], sourceFrame[3])).toBeCloseTo(1.4, 10);
    expect(Math.atan2(sourceFrame[3], sourceFrame[0]) * (180 / Math.PI)).toBeCloseTo(30, 8);
  });

  it('maps the source-sized canvas onto itself for an untouched alignment', () => {
    const matrix = resolvePackageMatrix({
      convention: 'source-frame',
      params: normalizeSimilarityParams({}),
      sourceSize: { width: 6005, height: 6005 },
      referenceSize: { width: 2884, height: 2884 },
    });

    // Float round-tripping through the size ratio leaves 1 + 1e-16; the CSV
    // writer rounds that back to 1.
    matrix.forEach((value, index) => {
      expect(value).toBeCloseTo(index === 0 || index === 4 ? 1 : 0, 12);
    });
  });

  it('scales both output rows by the frame ratio', () => {
    const matrix = toSourceFrameMatrix(
      [4, 0, -100, 0, 2, 50],
      { width: 100, height: 200 },
      { width: 50, height: 100 },
    );

    expect(matrix).toEqual([8, 0, -200, 0, 4, 100]);
  });
});

describe('decomposeNormalizedSimilarity', () => {
  const cases: Array<[string, Partial<BatchSimilarityParams>]> = [
    ['identity', {}],
    ['rotation', { rotationDegrees: 41 }],
    ['scale and offset', { scale: 1.7, offsetX: -0.08, offsetY: 0.12 }],
    ['mirrored', { rotationDegrees: -17, scale: 0.8, flipHorizontal: true }],
  ];

  it.each(cases)('round trips the %s transform', (_label, overrides) => {
    const params = normalizeSimilarityParams(overrides);
    const matrix = similarityNormalizedMatrix(params);

    const recovered = decomposeNormalizedSimilarity(matrix);
    expect(recovered).not.toBeNull();

    const rewritten = similarityNormalizedMatrix(recovered as BatchSimilarityParams);
    rewritten.forEach((value, index) => {
      expect(value).toBeCloseTo(matrix[index], 10);
    });
  });

  it('rejects a degenerate matrix', () => {
    expect(decomposeNormalizedSimilarity([0, 0, 0, 0, 0, 0])).toBeNull();
  });
});

describe('rebaseSimilarityParams', () => {
  it('keeps every package in place when the reference changes', () => {
    const referenceB = normalizeSimilarityParams({ rotationDegrees: 32, scale: 1.4, offsetX: 0.05 });
    const packageC = normalizeSimilarityParams({ rotationDegrees: -12, scale: 0.75, offsetY: 0.1 });

    // Everything is expressed against A; now move the frame to B.
    const rebasedB = rebaseSimilarityParams(referenceB, referenceB);
    const rebasedC = rebaseSimilarityParams(packageC, referenceB);
    const toB = invertAffine(similarityNormalizedMatrix(referenceB));
    expect(toB).not.toBeNull();

    // B itself lands on the identity, and C's pixels keep their place on screen.
    const identity = similarityNormalizedMatrix(rebasedB);
    identity.forEach((value, index) => {
      expect(value).toBeCloseTo(IDENTITY_AFFINE[index], 8);
    });

    const throughB = similarityNormalizedMatrix(rebasedC);
    const expected = composeAffine(toB as BatchAffineMatrix, similarityNormalizedMatrix(packageC));
    throughB.forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index], 8);
    });
  });

  it('returns the original transform when rebased onto the identity', () => {
    const params = normalizeSimilarityParams({ rotationDegrees: 25, scale: 1.2, offsetX: 0.03 });
    const rebased = rebaseSimilarityParams(params, normalizeSimilarityParams({}));
    const matrix = similarityNormalizedMatrix(rebased);
    const original = similarityNormalizedMatrix(params);

    matrix.forEach((value, index) => {
      expect(value).toBeCloseTo(original[index], 8);
    });
  });
});

describe('normalizeSimilarityParams', () => {
  it('clamps rotation and scale into supported ranges', () => {
    const normalized = normalizeSimilarityParams({ rotationDegrees: 400, scale: 1000 });

    expect(normalized.rotationDegrees).toBe(180);
    expect(normalized.scale).toBe(10);
  });

  it('falls back to identity values for non-finite input', () => {
    const normalized = normalizeSimilarityParams({
      rotationDegrees: Number.NaN,
      scale: Number.NaN,
      offsetX: Number.POSITIVE_INFINITY,
    });

    expect(normalized).toEqual({
      rotationDegrees: 0,
      scale: 1,
      flipHorizontal: false,
      flipVertical: false,
      offsetX: 0,
      offsetY: 0,
    });
  });
});
