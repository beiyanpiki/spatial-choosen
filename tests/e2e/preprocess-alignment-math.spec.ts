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

async function readImportedProject(zipFilename = '123-preprocess (1).zip'): Promise<PreprocessProject> {
  const zipPath = path.join(process.cwd(), 'ref', zipFilename);
  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  const projectEntry = zip.file('project.json');
  if (!projectEntry) {
    throw new Error('Missing project.json in imported preprocess zip');
  }

  const pkg = JSON.parse(await projectEntry.async('text')) as { project: PreprocessProject };
  return pkg.project;
}

function getFocusedMovingImageSize(importedProject: PreprocessProject) {
  const movingImage = importedProject.sourceAssets.images[importedProject.heFocus.targetImage];

  if (!movingImage || !importedProject.heFocus.chipBounds) {
    throw new Error('Imported preprocess project is missing focused HE prerequisites');
  }

  const focusedCropWidth = Math.round(importedProject.heFocus.chipBounds.width * movingImage.width);
  const focusedCropHeight = Math.round(importedProject.heFocus.chipBounds.height * movingImage.height);
  const focusedCropSize = Math.max(1, Math.min(focusedCropWidth, focusedCropHeight));

  return {
    movingImage,
    movingImageSize: {
      width: focusedCropSize,
      height: focusedCropSize,
    },
  };
}

function expectedCropScaleFromImportedProject(
  importedProject: PreprocessProject,
  movingImageSize: { width: number; height: number },
) {
  return (
    (importedProject.localization.chipBounds.width *
      importedProject.sourceAssets.images[importedProject.alignment.referenceImage].width +
      importedProject.localization.chipBounds.height *
        importedProject.sourceAssets.images[importedProject.alignment.referenceImage].height) /
    (movingImageSize.width + movingImageSize.height)
  );
}

function computeReprojectionErrors(
  controlPoints: AlignmentControlPoint[],
  referenceImageSize: { width: number; height: number },
  movingImageSize: { width: number; height: number },
  affineMatrix: AlignmentAffineMatrix,
) {
  return controlPoints.map((pair) => {
    const sourceX = pair.source.x * referenceImageSize.width;
    const sourceY = pair.source.y * referenceImageSize.height;
    const movingX = pair.target.x * movingImageSize.width;
    const movingY = pair.target.y * movingImageSize.height;
    const projectedX =
      affineMatrix[0] * movingX +
      affineMatrix[1] * movingY +
      affineMatrix[2];
    const projectedY =
      affineMatrix[3] * movingX +
      affineMatrix[4] * movingY +
      affineMatrix[5];
    return Math.hypot(projectedX - sourceX, projectedY - sourceY);
  });
}

function getInlierErrors(errors: number[], inlierMask: boolean[]) {
  const filtered = errors.filter((_, index) => inlierMask[index]);
  return filtered.length > 0 ? filtered : errors;
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

test('imported crop-box solve remains accepted with low reprojection error for the packaged landmark set', async () => {
  const importedProject = await readImportedProject();
  const referenceImage = importedProject.sourceAssets.images[importedProject.alignment.referenceImage];
  const { movingImage, movingImageSize } = getFocusedMovingImageSize(importedProject);

  if (!referenceImage || !movingImage || !importedProject.heFocus.chipBounds || !importedProject.alignment.affineMatrix) {
    throw new Error('Imported preprocess project is missing alignment prerequisites');
  }

  const referenceImageSize = { width: referenceImage.width, height: referenceImage.height };
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
  expect(result.qualityFlags.rmse).toBe(true);
  expect(result.reprojectionRmse).not.toBeNull();

  if (!result.affineMatrix) {
    throw new Error('Expected imported packaged solve to return an affine matrix');
  }

  const errors = computeReprojectionErrors(
    importedProject.alignment.controlPoints as AlignmentControlPoint[],
    referenceImageSize,
    movingImageSize,
    result.affineMatrix,
  );
  const inlierErrors = getInlierErrors(errors, result.inlierMask);
  const scaleX = Math.hypot(result.affineMatrix[0], result.affineMatrix[3]);
  const scaleY = Math.hypot(result.affineMatrix[1], result.affineMatrix[4]);

  expect(scaleX).toBeCloseTo(scaleY, 3);
  expect(result.reprojectionRmse ?? Number.POSITIVE_INFINITY).toBeLessThan(20);
  expect(Math.max(...inlierErrors)).toBeLessThan(25);
});

test('1233 imported crop-box solve prefers landmark fit over the packaged crop-box scale', async () => {
  const importedProject = await readImportedProject('1233-preprocess.zip');
  const referenceImage = importedProject.sourceAssets.images[importedProject.alignment.referenceImage];
  const { movingImage, movingImageSize } = getFocusedMovingImageSize(importedProject);

  if (
    !referenceImage ||
    !movingImage ||
    !importedProject.heFocus.chipBounds ||
    !importedProject.alignment.affineMatrix
  ) {
    throw new Error('1233 imported preprocess project is missing alignment prerequisites');
  }

  const referenceImageSize = {
    width: referenceImage.width,
    height: referenceImage.height,
  };
  const expectedCropScale = expectedCropScaleFromImportedProject(
    importedProject,
    movingImageSize,
  );
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
  expect(result.qualityFlags.rmse).toBe(true);
  expect(result.reprojectionRmse).not.toBeNull();

  if (!result.affineMatrix) {
    throw new Error('Expected 1233 solve to return an affine matrix');
  }

  const errors = computeReprojectionErrors(
    importedProject.alignment.controlPoints as AlignmentControlPoint[],
    referenceImageSize,
    movingImageSize,
    result.affineMatrix,
  );
  const inlierErrors = getInlierErrors(errors, result.inlierMask);
  const scaleX = Math.hypot(result.affineMatrix[0], result.affineMatrix[3]);
  const scaleY = Math.hypot(result.affineMatrix[1], result.affineMatrix[4]);
  const resolvedScale = (scaleX + scaleY) / 2;

  expect(scaleX).toBeCloseTo(scaleY, 3);
  expect(result.reprojectionRmse ?? Number.POSITIVE_INFINITY).toBeLessThan(20);
  expect(Math.max(...inlierErrors)).toBeLessThan(20);
  expect(resolvedScale).toBeGreaterThan(expectedCropScale * 1.15);
});

test('1233 imported all-points and inlier-subset paths keep the landmark-driven similarity fit', async () => {
  const importedProject = await readImportedProject('1233-preprocess.zip');
  const referenceImage = importedProject.sourceAssets.images[importedProject.alignment.referenceImage];
  const { movingImage, movingImageSize } = getFocusedMovingImageSize(importedProject);

  if (!referenceImage || !movingImage || !importedProject.heFocus.chipBounds) {
    throw new Error('1233 imported preprocess project is missing recompute prerequisites');
  }

  const referenceImageSize = {
    width: referenceImage.width,
    height: referenceImage.height,
  };
  const expectedCropScale = expectedCropScaleFromImportedProject(
    importedProject,
    movingImageSize,
  );
  const subset = (importedProject.alignment.controlPoints as AlignmentControlPoint[]).slice(0, 10);

  const allPointsResult = solveAffineAlignment({
    cv: createMockCv([1, 0, 0, 0, 1, 0]),
    controlPoints: importedProject.alignment.controlPoints as AlignmentControlPoint[],
    chipBounds: importedProject.localization.chipBounds,
    referenceImageSize,
    movingImageSize,
    solveMode: 'allPoints',
  });

  const inlierSubsetResult = solveAffineAlignment({
    cv: createMockCv([1, 0, 0, 0, 1, 0]),
    controlPoints: subset,
    chipBounds: importedProject.localization.chipBounds,
    referenceImageSize,
    movingImageSize,
    solveMode: 'inlierSubset',
  });

  for (const result of [allPointsResult, inlierSubsetResult] as const) {
    expect(result.solveAccepted).toBe(true);
    expect(result.failureReason).toBeNull();
    expect(result.reprojectionRmse).not.toBeNull();

    if (!result.affineMatrix) {
      throw new Error('Expected dangerous solve mode to return an affine matrix');
    }

    const errors = computeReprojectionErrors(
      subset,
      referenceImageSize,
      movingImageSize,
      result.affineMatrix,
    );
    const inlierErrors = getInlierErrors(errors, result.inlierMask);
    const scaleX = Math.hypot(result.affineMatrix[0], result.affineMatrix[3]);
    const scaleY = Math.hypot(result.affineMatrix[1], result.affineMatrix[4]);
    const resolvedScale = (scaleX + scaleY) / 2;

    expect(scaleX).toBeCloseTo(scaleY, 3);
    expect(result.reprojectionRmse ?? Number.POSITIVE_INFINITY).toBeLessThan(20);
    expect(Math.max(...inlierErrors)).toBeLessThan(20);
    expect(resolvedScale).toBeGreaterThan(expectedCropScale * 1.15);
  }
});

test('all-points dangerous recompute keeps low reprojection error for square crops', async () => {
  const importedProject = await readImportedProject();
  const referenceImage = importedProject.sourceAssets.images[importedProject.alignment.referenceImage];
  const { movingImage, movingImageSize } = getFocusedMovingImageSize(importedProject);

  if (!referenceImage || !movingImage || !importedProject.heFocus.chipBounds) {
    throw new Error('Imported preprocess project is missing dangerous recompute prerequisites');
  }

  const referenceImageSize = { width: referenceImage.width, height: referenceImage.height };

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
  expect(result.reprojectionRmse).not.toBeNull();

  if (!result.affineMatrix) {
    throw new Error('Expected all-points dangerous recompute to return an affine matrix');
  }

  const errors = computeReprojectionErrors(
    importedProject.alignment.controlPoints as AlignmentControlPoint[],
    referenceImageSize,
    movingImageSize,
    result.affineMatrix,
  );
  const inlierErrors = getInlierErrors(errors, result.inlierMask);
  const scaleX = Math.hypot(result.affineMatrix[0], result.affineMatrix[3]);
  const scaleY = Math.hypot(result.affineMatrix[1], result.affineMatrix[4]);

  expect(scaleX).toBeCloseTo(scaleY, 3);
  expect(result.reprojectionRmse ?? Number.POSITIVE_INFINITY).toBeLessThan(20);
  expect(Math.max(...inlierErrors)).toBeLessThan(25);
});

test('dangerous continue can refit from current inliers with low reprojection error', async () => {
  const importedProject = await readImportedProject();
  const referenceImage = importedProject.sourceAssets.images[importedProject.alignment.referenceImage];
  const { movingImage, movingImageSize } = getFocusedMovingImageSize(importedProject);

  if (!referenceImage || !movingImage || !importedProject.heFocus.chipBounds) {
    throw new Error('Imported preprocess project is missing dangerous continue prerequisites');
  }

  const referenceImageSize = { width: referenceImage.width, height: referenceImage.height };
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
  expect(result.reprojectionRmse).not.toBeNull();

  if (!result.affineMatrix) {
    throw new Error('Expected dangerous continue inlier refit to return an affine matrix');
  }

  const errors = computeReprojectionErrors(
    subset,
    referenceImageSize,
    movingImageSize,
    result.affineMatrix,
  );
  const inlierErrors = getInlierErrors(errors, result.inlierMask);
  const scaleX = Math.hypot(result.affineMatrix[0], result.affineMatrix[3]);
  const scaleY = Math.hypot(result.affineMatrix[1], result.affineMatrix[4]);

  expect(scaleX).toBeCloseTo(scaleY, 3);
  expect(result.reprojectionRmse ?? Number.POSITIVE_INFINITY).toBeLessThan(20);
  expect(Math.max(...inlierErrors)).toBeLessThan(25);
});

test('square focused-HE solves keep low reprojection error for the 1233 fixture', async () => {
  const importedProject = await readImportedProject('1233-preprocess.zip');
  const referenceImage = importedProject.sourceAssets.images[importedProject.alignment.referenceImage];
  const { movingImage, movingImageSize } = getFocusedMovingImageSize(importedProject);

  if (!referenceImage || !movingImage || !importedProject.heFocus.chipBounds) {
    throw new Error('1233 fixture is missing alignment prerequisites');
  }

  const referenceImageSize = { width: referenceImage.width, height: referenceImage.height };
  const expectedCropScale = expectedCropScaleFromImportedProject(importedProject, movingImageSize);

  const result = solveAffineAlignment({
    cv: createMockCv([1, 0, 0, 0, 1, 0]),
    controlPoints: importedProject.alignment.controlPoints as AlignmentControlPoint[],
    chipBounds: importedProject.localization.chipBounds,
    referenceImageSize,
    movingImageSize,
  });

  expect(result.solveAccepted).toBe(true);
  expect(result.failureReason).toBeNull();
  expect(result.qualityFlags.rmse).toBe(true);
  expect(result.reprojectionRmse).not.toBeNull();
  expect(result.reprojectionRmse ?? Number.POSITIVE_INFINITY).toBeLessThan(20);

  if (!result.affineMatrix) {
    throw new Error('Expected 1233 fixture to return an affine matrix');
  }

  const errors = (importedProject.alignment.controlPoints as AlignmentControlPoint[]).map((pair) => {
    const sourceX = pair.source.x * referenceImageSize.width;
    const sourceY = pair.source.y * referenceImageSize.height;
    const movingX = pair.target.x * movingImageSize.width;
    const movingY = pair.target.y * movingImageSize.height;
    const projectedX =
      result.affineMatrix[0] * movingX +
      result.affineMatrix[1] * movingY +
      result.affineMatrix[2];
    const projectedY =
      result.affineMatrix[3] * movingX +
      result.affineMatrix[4] * movingY +
      result.affineMatrix[5];
    return Math.hypot(projectedX - sourceX, projectedY - sourceY);
  });
  const inlierErrors = getInlierErrors(errors, result.inlierMask);

  expect(Math.max(...inlierErrors)).toBeLessThan(20);

  const scaleX = Math.hypot(result.affineMatrix[0], result.affineMatrix[3]);
  const scaleY = Math.hypot(result.affineMatrix[1], result.affineMatrix[4]);
  const resolvedScale = (scaleX + scaleY) / 2;

  expect(scaleX).toBeCloseTo(scaleY, 3);
  expect(resolvedScale).toBeGreaterThan(expectedCropScale * 1.15);
});

test('similarity transform: should produce uniform scale (scaleX equals scaleY)', () => {
  const angle = 30 * (Math.PI / 180);
  const scale = 2.0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const normalizedAffine: AlignmentAffineMatrix = [
    scale * cos, -scale * sin, 0.5,
    scale * sin, scale * cos, -0.3
  ];

  const controlPoints: AlignmentControlPoint[] = [
    { id: '1', target: { x: 0.1, y: 0.1 }, source: { x: 0.2, y: 0.2 } },
    { id: '2', target: { x: 0.9, y: 0.1 }, source: { x: 0.8, y: 0.2 } },
    { id: '3', target: { x: 0.1, y: 0.9 }, source: { x: 0.2, y: 0.8 } },
    { id: '4', target: { x: 0.9, y: 0.9 }, source: { x: 0.8, y: 0.8 } },
    { id: '5', target: { x: 0.5, y: 0.2 }, source: { x: 0.6, y: 0.3 } },
    { id: '6', target: { x: 0.2, y: 0.5 }, source: { x: 0.3, y: 0.6 } },
    { id: '7', target: { x: 0.8, y: 0.5 }, source: { x: 0.7, y: 0.6 } }
  ];

  const result = solveAffineAlignment({
    cv: createMockCv(normalizedAffine),
    controlPoints,
    chipBounds: { x: 0, y: 0, width: 1, height: 1 },
    referenceImageSize: { width: 1000, height: 1000 },
    movingImageSize: { width: 1000, height: 1000 }
  });

  expect(result.solveAccepted).toBe(true);
  expect(result.affineMatrix).not.toBeNull();

  const scaleX = Math.hypot(result.affineMatrix![0], result.affineMatrix![3]);
  const scaleY = Math.hypot(result.affineMatrix![1], result.affineMatrix![4]);
  const scaleRatio = scaleX / scaleY;
  expect(scaleRatio).toBeCloseTo(1.0, 2);

  expect(result.transform).not.toBeNull();
  expect(result.transform!.isUniformScale).toBe(true);
});

test('similarity transform: should not produce shear (rotation consistency check)', () => {
  const angle = 45 * (Math.PI / 180);
  const scale = 1.5;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const normalizedAffine: AlignmentAffineMatrix = [
    scale * cos, -scale * sin, 0.1,
    scale * sin, scale * cos, -0.1
  ];

  const controlPoints: AlignmentControlPoint[] = [
    { id: '1', target: { x: 0.1, y: 0.1 }, source: { x: 0.2, y: 0.2 } },
    { id: '2', target: { x: 0.9, y: 0.1 }, source: { x: 0.8, y: 0.2 } },
    { id: '3', target: { x: 0.1, y: 0.9 }, source: { x: 0.2, y: 0.8 } },
    { id: '4', target: { x: 0.9, y: 0.9 }, source: { x: 0.8, y: 0.8 } },
    { id: '5', target: { x: 0.5, y: 0.5 }, source: { x: 0.6, y: 0.6 } },
    { id: '6', target: { x: 0.3, y: 0.7 }, source: { x: 0.4, y: 0.7 } },
    { id: '7', target: { x: 0.7, y: 0.3 }, source: { x: 0.7, y: 0.4 } }
  ];

  const result = solveAffineAlignment({
    cv: createMockCv(normalizedAffine),
    controlPoints,
    chipBounds: { x: 0, y: 0, width: 1, height: 1 },
    referenceImageSize: { width: 1000, height: 1000 },
    movingImageSize: { width: 1000, height: 1000 }
  });

  expect(result.solveAccepted).toBe(true);

  if (result.solveAccepted && result.affineMatrix) {
    const [m00, m01, , m10, m11] = result.affineMatrix;
    const scaleX = Math.hypot(m00, m10);
    const scaleY = Math.hypot(m01, m11);

    const rotation1 = Math.atan2(m10 / scaleX, m00 / scaleX);
    const rotation2 = Math.atan2(-m01 / scaleY, m11 / scaleY);

    expect(Math.abs(rotation1 - rotation2)).toBeLessThan(0.01);
  }
});

test('similarity transform: isUniformScale flag is set correctly', () => {
  const controlPoints: AlignmentControlPoint[] = [
    { id: '1', target: { x: 0.1, y: 0.1 }, source: { x: 0.2, y: 0.2 } },
    { id: '2', target: { x: 0.9, y: 0.1 }, source: { x: 0.8, y: 0.2 } },
    { id: '3', target: { x: 0.1, y: 0.9 }, source: { x: 0.2, y: 0.8 } },
    { id: '4', target: { x: 0.9, y: 0.9 }, source: { x: 0.8, y: 0.8 } },
    { id: '5', target: { x: 0.5, y: 0.2 }, source: { x: 0.6, y: 0.3 } },
    { id: '6', target: { x: 0.2, y: 0.5 }, source: { x: 0.3, y: 0.6 } },
    { id: '7', target: { x: 0.8, y: 0.5 }, source: { x: 0.7, y: 0.6 } }
  ];

  const angle = 15 * (Math.PI / 180);
  const scale = 1.8;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const normalizedAffine: AlignmentAffineMatrix = [
    scale * cos, -scale * sin, 0.2,
    scale * sin, scale * cos, 0.1
  ];

  const result = solveAffineAlignment({
    cv: createMockCv(normalizedAffine),
    controlPoints,
    chipBounds: { x: 0, y: 0, width: 1, height: 1 },
    referenceImageSize: { width: 1000, height: 1000 },
    movingImageSize: { width: 1000, height: 1000 }
  });

  expect(result.solveAccepted).toBe(true);
  expect(result.transform).not.toBeNull();
  expect(result.transform!.isUniformScale).toBe(true);
});

test('similarity transform: has positive determinant (no reflection)', () => {
  const angle = 60 * (Math.PI / 180);
  const scale = 1.2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const normalizedAffine: AlignmentAffineMatrix = [
    scale * cos, -scale * sin, 0.0,
    scale * sin, scale * cos, 0.0
  ];

  const controlPoints: AlignmentControlPoint[] = [
    { id: '1', target: { x: 0.1, y: 0.1 }, source: { x: 0.15, y: 0.12 } },
    { id: '2', target: { x: 0.9, y: 0.1 }, source: { x: 0.88, y: 0.15 } },
    { id: '3', target: { x: 0.1, y: 0.9 }, source: { x: 0.12, y: 0.88 } },
    { id: '4', target: { x: 0.9, y: 0.9 }, source: { x: 0.88, y: 0.88 } },
    { id: '5', target: { x: 0.5, y: 0.1 }, source: { x: 0.52, y: 0.13 } },
    { id: '6', target: { x: 0.1, y: 0.5 }, source: { x: 0.12, y: 0.52 } },
    { id: '7', target: { x: 0.9, y: 0.5 }, source: { x: 0.88, y: 0.52 } }
  ];

  const result = solveAffineAlignment({
    cv: createMockCv(normalizedAffine),
    controlPoints,
    chipBounds: { x: 0, y: 0, width: 1, height: 1 },
    referenceImageSize: { width: 1000, height: 1000 },
    movingImageSize: { width: 1000, height: 1000 }
  });

  expect(result.solveAccepted).toBe(true);
  expect(result.affineMatrix).not.toBeNull();

  const [m00, m01, , m10, m11] = result.affineMatrix!;
  const determinant = m00 * m11 - m01 * m10;
  expect(determinant).toBeGreaterThan(0);
});

test('similarity transform: handles insufficient control points', () => {
  const controlPoints: AlignmentControlPoint[] = [
    { id: '1', target: { x: 0.1, y: 0.1 }, source: { x: 0.2, y: 0.2 } },
    { id: '2', target: { x: 0.9, y: 0.1 }, source: { x: 0.8, y: 0.2 } }
  ];

  const result = solveAffineAlignment({
    cv: createMockCv([1, 0, 0, 0, 1, 0]),
    controlPoints,
    chipBounds: { x: 0, y: 0, width: 1, height: 1 },
    referenceImageSize: { width: 1000, height: 1000 },
    movingImageSize: { width: 1000, height: 1000 }
  });

  expect(result.solveAccepted).toBe(false);
  expect(result.failureReason).toBe('insufficient-pairs');
  expect(result.transform).toBeNull();
});
