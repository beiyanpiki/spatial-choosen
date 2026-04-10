import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { solveAffineAlignment } from '@/lib/preprocess/alignment';
import type { CvMat, OpenCvRuntime } from '@/lib/preprocess/loadOpenCv';
import type { AlignmentAffineMatrix, AlignmentControlPoint, PreprocessProject } from '@/types/preprocess';

class MockMat implements CvMat {
  rows: number;
  cols: number;
  data64F: Float64Array;
  data32F: Float32Array;
  data: Uint8Array;

  constructor(rows = 0, cols = 0, values: ArrayLike<number> = []) {
    this.rows = rows;
    this.cols = cols;
    this.data64F = Float64Array.from(values);
    this.data32F = Float32Array.from(values);
    this.data = Uint8Array.from(values, (value) => Number(value));
  }

  empty() {
    return this.data64F.length === 0 && this.data32F.length === 0;
  }

  delete() {
    // No-op for the test double.
  }
}

class MockSize {
  constructor(public width: number, public height: number) {}
}

class MockScalar {
  constructor(
    public v0: number,
    public v1 = 0,
    public v2 = 0,
    public v3 = 0,
  ) {}
}

function createMockCv(affineMatrix: AlignmentAffineMatrix): OpenCvRuntime {
  return {
    Mat: MockMat,
    matFromArray: (rows, cols, _type, data) => new MockMat(rows, cols, data),
    estimateAffine2D: (from, _to, inliers) => {
      inliers.rows = from.rows;
      inliers.cols = 1;
      inliers.data = Uint8Array.from({ length: from.rows }, () => 1);
      return new MockMat(2, 3, affineMatrix);
    },
    warpAffine: () => {
      throw new Error('warpAffine should not be called in solveAffineAlignment tests');
    },
    matFromImageData: () => {
      throw new Error('matFromImageData should not be called in solveAffineAlignment tests');
    },
    Size: MockSize,
    Scalar: MockScalar,
    RANSAC: 8,
    CV_64F: 0,
    CV_8U: 1,
    INTER_LINEAR: 1,
    BORDER_CONSTANT: 0,
  };
}

function expectAffineClose(actual: AlignmentAffineMatrix | null, expected: AlignmentAffineMatrix) {
  expect(actual).not.toBeNull();

  actual?.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index], 6);
  });
}

async function readImportedProject(): Promise<PreprocessProject> {
  const zipPath = path.join(process.cwd(), 'ref/123-preprocess (1).zip');
  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  const projectEntry = zip.file('project.json');
  if (!projectEntry) {
    throw new Error('Missing project.json in imported preprocess zip');
  }

  const pkg = JSON.parse(await projectEntry.async('text')) as { project: PreprocessProject };
  return pkg.project;
}

function normalizeAffineMatrixForMock(
  matrix: AlignmentAffineMatrix,
  referenceImageSize: { width: number; height: number },
  movingImageSize: { width: number; height: number },
): AlignmentAffineMatrix {
  const referenceScale = Math.max(1, Math.min(referenceImageSize.width, referenceImageSize.height));
  const movingScale = Math.max(1, Math.min(movingImageSize.width, movingImageSize.height));
  const referenceCenterX = referenceImageSize.width / 2;
  const referenceCenterY = referenceImageSize.height / 2;
  const movingCenterX = movingImageSize.width / 2;
  const movingCenterY = movingImageSize.height / 2;
  const scaleRatio = movingScale / referenceScale;
  const [m00, m01, tx, m10, m11, ty] = matrix;

  return [
    m00 * scaleRatio,
    m01 * scaleRatio,
    (tx - referenceCenterX + m00 * movingCenterX + m01 * movingCenterY) / referenceScale,
    m10 * scaleRatio,
    m11 * scaleRatio,
    (ty - referenceCenterY + m10 * movingCenterX + m11 * movingCenterY) / referenceScale,
  ];
}

test('solveAffineAlignment returns a pixel-space affine for focused HE crops', async () => {
  const expectedPixelAffine: AlignmentAffineMatrix = [2.5, 0.3, 120, -0.2, 1.7, 180];
  const normalizedAffine: AlignmentAffineMatrix = [0.375, 0.045, -0.14, -0.03, 0.255, -0.1725];
  const controlPoints: AlignmentControlPoint[] = [
    {
      id: 'pair-1',
      target: { x: 0.05, y: 0.125 },
      source: { x: 0.1495, y: 0.254375 },
    },
    {
      id: 'pair-2',
      target: { x: 0.1, y: 0.8333333333333334 },
      source: { x: 0.2, y: 0.4325 },
    },
    {
      id: 'pair-3',
      target: { x: 0.3, y: 0.16666666666666666 },
      source: { x: 0.276, y: 0.2525 },
    },
    {
      id: 'pair-4',
      target: { x: 0.45, y: 0.9166666666666666 },
      source: { x: 0.378, y: 0.43625 },
    },
    {
      id: 'pair-5',
      target: { x: 0.65, y: 0.125 },
      source: { x: 0.4495, y: 0.224375 },
    },
    {
      id: 'pair-6',
      target: { x: 0.85, y: 0.5833333333333334 },
      source: { x: 0.566, y: 0.33125 },
    },
    {
      id: 'pair-7',
      target: { x: 0.95, y: 0.9166666666666666 },
      source: { x: 0.628, y: 0.41125 },
    },
  ];

  const result = solveAffineAlignment({
    cv: createMockCv(normalizedAffine),
    controlPoints,
    chipBounds: {
      x: 0.1,
      y: 0.15,
      width: 0.7,
      height: 0.2,
    },
    referenceImageSize: { width: 1000, height: 800 },
    movingImageSize: { width: 200, height: 120 },
  });

  expect(result.solveAccepted).toBe(true);
  expect(result.failureReason).toBeNull();
  expectAffineClose(result.affineMatrix, expectedPixelAffine);
  expect(result.reprojectionRmse).not.toBeNull();
  expect(result.reprojectionRmse ?? Number.POSITIVE_INFINITY).toBeLessThan(1e-6);
  expect(result.inlierMask).toEqual([true, true, true, true, true, true, true]);
});

test('imported crop-box solve remains accepted for the packaged landmark set', async () => {
  const importedProject = await readImportedProject();
  const referenceImage = importedProject.sourceAssets.images[importedProject.alignment.referenceImage];
  const movingImage = importedProject.sourceAssets.images[importedProject.heFocus.targetImage];

  if (!referenceImage || !movingImage || !importedProject.heFocus.chipBounds || !importedProject.alignment.affineMatrix) {
    throw new Error('Imported preprocess project is missing alignment prerequisites');
  }

  const focusedCropSize = Math.round(importedProject.heFocus.chipBounds.width * movingImage.width);
  const movingImageSize = { width: focusedCropSize, height: focusedCropSize };
  const referenceImageSize = { width: referenceImage.width, height: referenceImage.height };
  const expectedCropScale = (
    importedProject.localization.chipBounds.width * referenceImage.width +
    importedProject.localization.chipBounds.height * referenceImage.height
  ) / (movingImageSize.width + movingImageSize.height);
  const normalizedAffine = normalizeAffineMatrixForMock(
    importedProject.alignment.affineMatrix,
    referenceImageSize,
    movingImageSize,
  );

  const result = solveAffineAlignment({
    cv: createMockCv(normalizedAffine),
    controlPoints: importedProject.alignment.controlPoints as AlignmentControlPoint[],
    chipBounds: importedProject.localization.chipBounds,
    referenceImageSize,
    movingImageSize,
  });

  expect(result.solveAccepted).toBe(true);
  expect(result.failureReason).toBeNull();

  if (!result.affineMatrix) {
    throw new Error('Expected imported packaged solve to return an affine matrix');
  }

  const scaleX = Math.hypot(result.affineMatrix[0], result.affineMatrix[3]);
  const scaleY = Math.hypot(result.affineMatrix[1], result.affineMatrix[4]);
  const resolvedScale = (scaleX + scaleY) / 2;

  expect(scaleX).toBeCloseTo(scaleY, 3);
  expect(resolvedScale).toBeCloseTo(expectedCropScale, 2);
});

test('all-points dangerous recompute preserves fixed crop scale for square crops', async () => {
  const importedProject = await readImportedProject();
  const referenceImage = importedProject.sourceAssets.images[importedProject.alignment.referenceImage];
  const movingImage = importedProject.sourceAssets.images[importedProject.heFocus.targetImage];

  if (!referenceImage || !movingImage || !importedProject.heFocus.chipBounds) {
    throw new Error('Imported preprocess project is missing dangerous recompute prerequisites');
  }

  const focusedCropSize = Math.round(importedProject.heFocus.chipBounds.width * movingImage.width);
  const movingImageSize = { width: focusedCropSize, height: focusedCropSize };
  const referenceImageSize = { width: referenceImage.width, height: referenceImage.height };
  const expectedCropScale = (
    importedProject.localization.chipBounds.width * referenceImage.width +
    importedProject.localization.chipBounds.height * referenceImage.height
  ) / (movingImageSize.width + movingImageSize.height);

  const result = solveAffineAlignment({
    cv: createMockCv([1, 0, 0, 0, 1, 0]),
    controlPoints: importedProject.alignment.controlPoints as AlignmentControlPoint[],
    chipBounds: importedProject.localization.chipBounds,
    referenceImageSize,
    movingImageSize,
    solveMode: 'allPoints',
  });

  expect(result.solveAccepted).toBe(true);
  expect(result.failureReason).toBeNull();

  if (!result.affineMatrix) {
    throw new Error('Expected all-points dangerous recompute to return an affine matrix');
  }

  const scaleX = Math.hypot(result.affineMatrix[0], result.affineMatrix[3]);
  const scaleY = Math.hypot(result.affineMatrix[1], result.affineMatrix[4]);
  const resolvedScale = (scaleX + scaleY) / 2;

  expect(scaleX).toBeCloseTo(scaleY, 3);
  expect(resolvedScale).toBeCloseTo(expectedCropScale, 2);
});

test('dangerous continue can refit from current inliers while preserving fixed crop scale', async () => {
  const importedProject = await readImportedProject();
  const referenceImage = importedProject.sourceAssets.images[importedProject.alignment.referenceImage];
  const movingImage = importedProject.sourceAssets.images[importedProject.heFocus.targetImage];

  if (!referenceImage || !movingImage || !importedProject.heFocus.chipBounds) {
    throw new Error('Imported preprocess project is missing dangerous continue prerequisites');
  }

  const focusedCropSize = Math.round(importedProject.heFocus.chipBounds.width * movingImage.width);
  const movingImageSize = { width: focusedCropSize, height: focusedCropSize };
  const referenceImageSize = { width: referenceImage.width, height: referenceImage.height };
  const expectedCropScale = (
    importedProject.localization.chipBounds.width * referenceImage.width +
    importedProject.localization.chipBounds.height * referenceImage.height
  ) / (movingImageSize.width + movingImageSize.height);
  const subset = (importedProject.alignment.controlPoints as AlignmentControlPoint[]).slice(0, 10);

  const result = solveAffineAlignment({
    cv: createMockCv([1, 0, 0, 0, 1, 0]),
    controlPoints: subset,
    chipBounds: importedProject.localization.chipBounds,
    referenceImageSize,
    movingImageSize,
    solveMode: 'allPoints',
  });

  expect(result.solveAccepted).toBe(true);
  expect(result.failureReason).toBeNull();

  if (!result.affineMatrix) {
    throw new Error('Expected dangerous continue inlier refit to return an affine matrix');
  }

  const scaleX = Math.hypot(result.affineMatrix[0], result.affineMatrix[3]);
  const scaleY = Math.hypot(result.affineMatrix[1], result.affineMatrix[4]);
  const resolvedScale = (scaleX + scaleY) / 2;

  expect(scaleX).toBeCloseTo(scaleY, 3);
  expect(resolvedScale).toBeCloseTo(expectedCropScale, 2);
});
