import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AlignmentAffineMatrix,
  AlignmentControlPoint,
  HeFocusAutoProposalQuad,
  LocalizationImageTransform,
  PreprocessRect,
} from '@/types/preprocess';
import { CropQcBlockedError, runCropQc } from './cropQc';
import type { CvMat, OpenCvRuntime } from './loadOpenCv';

type CanvasOperation =
  | { type: 'arc'; x: number; y: number; radius: number }
  | { type: 'fillRect'; x: number; y: number; width: number; height: number }
  | { type: 'lineTo'; x: number; y: number }
  | { type: 'moveTo'; x: number; y: number }
  | { type: 'stroke'; lineWidth: number }
  | { type: 'putImageData'; width: number; height: number };

type PreviewSummary = {
  arcCount: number;
  arcPoints: Array<{ x: number; y: number }>;
  arcRadii: number[];
  lineSegments: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>;
  lineToCount: number;
  moveToCount: number;
  putImageDataCount: number;
  strokeLineWidths: number[];
};

const IMAGE_SIZE = { width: 100, height: 100 };
const CHIP_BOUNDS: PreprocessRect = { x: 0, y: 0, width: 1, height: 1 };
const IDENTITY_TRANSFORM: LocalizationImageTransform = {
  rotationDegrees: 0,
  flipHorizontal: false,
  flipVertical: false,
  scale: 1,
};

class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

class MockCanvasRenderingContext2D {
  canvas: MockCanvasElement;
  operations: CanvasOperation[] = [];
  imageSmoothingEnabled = false;
  imageSmoothingQuality: 'low' | 'medium' | 'high' = 'low';
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;

  constructor(canvas: MockCanvasElement) {
    this.canvas = canvas;
  }

  drawImage = vi.fn(() => undefined);

  beginPath = vi.fn(() => undefined);

  arc = vi.fn((x: number, y: number, radius: number) => {
    this.operations.push({ type: 'arc', x, y, radius });
  });

  fill = vi.fn(() => undefined);

  stroke = vi.fn(() => {
    this.operations.push({ type: 'stroke', lineWidth: this.lineWidth });
  });

  moveTo = vi.fn((x: number, y: number) => {
    this.operations.push({ type: 'moveTo', x, y });
  });

  lineTo = vi.fn((x: number, y: number) => {
    this.operations.push({ type: 'lineTo', x, y });
  });

  fillRect = vi.fn((x: number, y: number, width: number, height: number) => {
    this.operations.push({ type: 'fillRect', x, y, width, height });
  });

  getImageData = vi.fn((x: number, y: number, width: number, height: number) => (
    (() => {
      void x;
      void y;
      return new MockImageData(new Uint8ClampedArray(width * height * 4), width, height);
    })()
  ));

  putImageData = vi.fn((imageData: MockImageData) => {
    this.operations.push({ type: 'putImageData', width: imageData.width, height: imageData.height });
  });
}

class MockCanvasElement {
  width = 0;
  height = 0;
  readonly context = new MockCanvasRenderingContext2D(this);

  getContext(type: string) {
    return type === '2d' ? this.context : null;
  }

  toDataURL() {
    const summary: PreviewSummary = {
      arcCount: this.context.operations.filter((operation) => operation.type === 'arc').length,
      arcPoints: this.context.operations
        .filter((operation): operation is Extract<CanvasOperation, { type: 'arc' }> => operation.type === 'arc')
        .map((operation) => ({ x: operation.x, y: operation.y })),
      arcRadii: this.context.operations
        .filter((operation): operation is Extract<CanvasOperation, { type: 'arc' }> => operation.type === 'arc')
        .map((operation) => operation.radius),
      lineSegments: this.context.operations.reduce<Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>>(
        (segments, operation, index, operations) => {
          if (operation.type !== 'moveTo') {
            return segments;
          }

          const nextOperation = operations[index + 1];
          if (!nextOperation || nextOperation.type !== 'lineTo') {
            return segments;
          }

          segments.push({
            from: { x: operation.x, y: operation.y },
            to: { x: nextOperation.x, y: nextOperation.y },
          });
          return segments;
        },
        [],
      ),
      lineToCount: this.context.operations.filter((operation) => operation.type === 'lineTo').length,
      moveToCount: this.context.operations.filter((operation) => operation.type === 'moveTo').length,
      putImageDataCount: this.context.operations.filter((operation) => operation.type === 'putImageData').length,
      strokeLineWidths: this.context.operations
        .filter((operation): operation is Extract<CanvasOperation, { type: 'stroke' }> => operation.type === 'stroke')
        .map((operation) => operation.lineWidth),
    };

    return `mock:${JSON.stringify(summary)}`;
  }
}

class MockImage {
  naturalWidth = IMAGE_SIZE.width;
  naturalHeight = IMAGE_SIZE.height;
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

class FakeCvMat implements CvMat {
  rows: number;
  cols: number;
  data64F: Float64Array;
  data32F: Float32Array;
  data: Uint8Array;

  constructor(...args: unknown[]) {
    const [config] = args;
    const normalized = isFakeCvMatInit(config) ? config : undefined;

    this.rows = normalized?.rows ?? 0;
    this.cols = normalized?.cols ?? 0;
    this.data64F = normalized?.data64F ?? new Float64Array(0);
    this.data32F = new Float32Array(0);
    this.data = normalized?.data ?? new Uint8Array(0);
  }

  empty() {
    return false;
  }

  delete() {
    return undefined;
  }
}

type FakeCvMatInit = {
  rows?: number;
  cols?: number;
  data64F?: Float64Array;
  data?: Uint8Array;
};

const isFakeCvMatInit = (value: unknown): value is FakeCvMatInit => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return true;
};

class FakeCvSize {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

class FakeCvScalar {
  v0: number;
  v1: number;
  v2: number;
  v3: number;

  constructor(v0: number, v1 = 0, v2 = 0, v3 = 0) {
    this.v0 = v0;
    this.v1 = v1;
    this.v2 = v2;
    this.v3 = v3;
  }
}

const createOpenCvRuntime = (): OpenCvRuntime => ({
  Mat: FakeCvMat,
  matFromArray: (rows, cols, _type, data) => new FakeCvMat({ rows, cols, data64F: Float64Array.from(data) }),
  estimateAffine2D: () => new FakeCvMat(),
  warpAffine: (_src, dst, _matrix, size) => {
    if (dst instanceof FakeCvMat && size instanceof FakeCvSize) {
      dst.rows = size.height;
      dst.cols = size.width;
      dst.data = new Uint8Array(size.width * size.height * 4);
    }
  },
  matFromImageData: (imageData) => new FakeCvMat({
    rows: imageData.height,
    cols: imageData.width,
    data: new Uint8Array(imageData.data),
  }),
  Size: FakeCvSize,
  Scalar: FakeCvScalar,
  RANSAC: 0,
  CV_64F: 0,
  CV_8U: 0,
  INTER_LINEAR: 0,
  BORDER_CONSTANT: 0,
});

const installBrowserStubs = () => {
  vi.stubGlobal('window', { Image: MockImage });
  vi.stubGlobal('document', {
    createElement: vi.fn((tagName: string) => {
      if (tagName !== 'canvas') {
        throw new Error(`Unsupported element: ${tagName}`);
      }
      return new MockCanvasElement();
    }),
  });
  vi.stubGlobal('ImageData', MockImageData);
};

const parsePreviewSummary = (dataUrl: string): PreviewSummary => {
  const encoded = dataUrl.replace(/^mock:/, '');
  return JSON.parse(encoded) as PreviewSummary;
};

const expectGeometryToBeCloseTo = (
  actual: {
    rect: { x: number; y: number; width: number; height: number };
    width: number;
    height: number;
  } | null,
  expected: {
    rect: { x: number; y: number; width: number; height: number };
    width: number;
    height: number;
  },
) => {
  expect(actual).not.toBeNull();
  expect(actual?.rect.x).toBeCloseTo(expected.rect.x);
  expect(actual?.rect.y).toBeCloseTo(expected.rect.y);
  expect(actual?.rect.width).toBeCloseTo(expected.rect.width);
  expect(actual?.rect.height).toBeCloseTo(expected.rect.height);
  expect(actual?.width).toBeCloseTo(expected.width);
  expect(actual?.height).toBeCloseTo(expected.height);
};

const runCropQcWithArgs = async (args: {
  affineMatrix: AlignmentAffineMatrix;
  alignmentAccepted?: boolean;
  acceptedChipQuad?: HeFocusAutoProposalQuad | null;
  acceptedChipBounds?: PreprocessRect | null;
  solveAccepted?: boolean;
  coarseChipBounds?: PreprocessRect | null;
  controlPoints: AlignmentControlPoint[];
  inlierMask: boolean[] | null;
  chipBounds?: PreprocessRect;
  imageTransform?: LocalizationImageTransform;
}) => {
  const request = {
    cv: createOpenCvRuntime(),
    eosinDataUrl: 'data:image/png;base64,eosin',
    heDataUrl: 'data:image/png;base64,he',
    chipBounds: args.chipBounds ?? CHIP_BOUNDS,
    acceptedChipQuad: args.acceptedChipQuad,
    acceptedChipBounds: args.acceptedChipBounds,
    coarseChipBounds: args.coarseChipBounds,
    imageTransform: args.imageTransform ?? IDENTITY_TRANSFORM,
    affineMatrix: args.affineMatrix,
    alignmentAccepted: args.alignmentAccepted ?? true,
    solveAccepted: args.solveAccepted,
    controlPoints: args.controlPoints,
    inlierMask: args.inlierMask,
  };

  return runCropQc(request);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runCropQc feature match preview', () => {
  it('limits feature-match markers to inlier control points', async () => {
    installBrowserStubs();

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      controlPoints: [
        { id: 'point-a', source: { x: 0.2, y: 0.2 }, target: { x: 0.2, y: 0.2 } },
        { id: 'point-b', source: { x: 0.8, y: 0.8 }, target: { x: 0.8, y: 0.8 } },
      ],
      inlierMask: [true, false],
    });

    const summary = parsePreviewSummary(result.featureMatchesDataUrl);

    expect(summary.arcCount).toBe(2);
    expect(summary.arcRadii).toEqual([4, 4]);
    expect(Math.max(...summary.strokeLineWidths)).toBe(2);
  });

  it('square-normalizes non-square localization chip bounds before generating the crop rect', async () => {
    installBrowserStubs();

    const chipBounds: PreprocessRect = {
      x: 0.14297589359933494,
      y: 0.0780158730158731,
      width: 0.7431733167082293,
      height: 0.7095535714285713,
    };

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      chipBounds,
      imageTransform: {
        rotationDegrees: 90,
        flipHorizontal: true,
        flipVertical: false,
        scale: 1,
      },
      controlPoints: [
        { id: 'point-a', source: { x: 0.2, y: 0.3 }, target: { x: 0.2, y: 0.3 } },
      ],
      inlierMask: [true],
    });

    expect(result.cropRect.x).toBeCloseTo(chipBounds.x);
    expect(result.cropRect.y).toBeCloseTo(chipBounds.y);
    expect(result.cropRect.width).toBeCloseTo(chipBounds.width);
    expect(result.cropRect.height).toBeCloseTo(chipBounds.width);
    expect(result.cropWidth).toBe(result.cropHeight);
    expect(result.cropWidth).toBe(74);
  });

  it('keeps localization chip geometry as the authoritative eosin crop domain', async () => {
    installBrowserStubs();

    const chipBounds: PreprocessRect = {
      x: 0.12,
      y: 0.18,
      width: 0.6,
      height: 0.6,
    };
    const coarseChipBounds: PreprocessRect = {
      x: 0.05,
      y: 0.1,
      width: 0.8,
      height: 0.75,
    };
    const acceptedChipBounds: PreprocessRect = {
      x: 0.3,
      y: 0.35,
      width: 0.2,
      height: 0.15,
    };

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      chipBounds,
      acceptedChipBounds,
      coarseChipBounds,
      solveAccepted: true,
      controlPoints: [
        { id: 'point-a', source: { x: 0.35, y: 0.4 }, target: { x: 0.35, y: 0.4 } },
      ],
      inlierMask: [true],
    });

    expect(result.eosinReferenceGeometry.rect.x).toBeCloseTo(chipBounds.x);
    expect(result.eosinReferenceGeometry.rect.y).toBeCloseTo(chipBounds.y);
    expect(result.eosinReferenceGeometry.rect.width).toBeCloseTo(chipBounds.width);
    expect(result.eosinReferenceGeometry.rect.height).toBeCloseTo(chipBounds.height);
    expect(result.eosinReferenceGeometry.width).toBe(60);
    expect(result.eosinReferenceGeometry.height).toBe(60);
    expectGeometryToBeCloseTo(result.heQcGeometry, {
      rect: {
        x: 0.3,
        y: 17 / 60,
        width: 1 / 3,
        height: 0.25,
      },
      width: 20,
      height: 15,
    });
    expect(result.cropRect.x).toBeCloseTo(chipBounds.x);
    expect(result.cropRect.y).toBeCloseTo(chipBounds.y);
    expect(result.cropRect.width).toBeCloseTo(chipBounds.width);
    expect(result.cropRect.height).toBeCloseTo(chipBounds.height);
    expect(result.cropWidth).toBe(60);
    expect(result.cropHeight).toBe(60);
  });

  it('produces the same downstream crop contract for automatic and manual accepted alignment inputs', async () => {
    installBrowserStubs();

    const chipBounds: PreprocessRect = {
      x: 0.18,
      y: 0.22,
      width: 0.36,
      height: 0.36,
    };
    const acceptedChipBounds: PreprocessRect = {
      x: 0.22,
      y: 0.28,
      width: 0.24,
      height: 0.18,
    };
    const coarseChipBounds: PreprocessRect = {
      x: 0.05,
      y: 0.08,
      width: 0.76,
      height: 0.7,
    };

    const automaticAccepted = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      chipBounds,
      acceptedChipBounds,
      coarseChipBounds,
      solveAccepted: true,
      controlPoints: [],
      inlierMask: null,
    });

    const manualAccepted = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      chipBounds,
      acceptedChipBounds,
      alignmentAccepted: true,
      controlPoints: [],
      inlierMask: null,
    });

    expect(automaticAccepted.eosinReferenceGeometry).toEqual(manualAccepted.eosinReferenceGeometry);
    expectGeometryToBeCloseTo(automaticAccepted.heQcGeometry, {
      rect: {
        x: 1 / 9,
        y: 1 / 6,
        width: 2 / 3,
        height: 0.5,
      },
      width: 24,
      height: 18,
    });
    expectGeometryToBeCloseTo(manualAccepted.heQcGeometry, {
      rect: {
        x: 1 / 9,
        y: 1 / 6,
        width: 2 / 3,
        height: 0.5,
      },
      width: 24,
      height: 18,
    });
    expect(automaticAccepted.cropRect).toEqual(manualAccepted.cropRect);
    expect(automaticAccepted.cropWidth).toBe(manualAccepted.cropWidth);
    expect(automaticAccepted.cropHeight).toBe(manualAccepted.cropHeight);
    expect(automaticAccepted.cropRect.x).toBeCloseTo(chipBounds.x);
    expect(automaticAccepted.cropRect.y).toBeCloseTo(chipBounds.y);
    expect(automaticAccepted.cropRect.width).toBeCloseTo(chipBounds.width);
    expect(automaticAccepted.cropRect.height).toBeCloseTo(chipBounds.height);
    expect(automaticAccepted.cropWidth).toBe(36);
    expect(automaticAccepted.cropHeight).toBe(36);
  });

  it('prefers refined H&E quad geometry over fallback bounds for derived QC metadata', async () => {
    installBrowserStubs();

    const chipBounds: PreprocessRect = {
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
    };
    const acceptedChipBounds: PreprocessRect = {
      x: 0.3,
      y: 0.3,
      width: 0.3,
      height: 0.3,
    };
    const acceptedChipQuad: HeFocusAutoProposalQuad = [
      { x: 0.32, y: 0.31 },
      { x: 0.58, y: 0.28 },
      { x: 0.54, y: 0.57 },
      { x: 0.29, y: 0.52 },
    ];

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      chipBounds,
      acceptedChipQuad,
      acceptedChipBounds,
      solveAccepted: true,
      controlPoints: [],
      inlierMask: null,
    });

    expectGeometryToBeCloseTo(result.heQcGeometry, {
      rect: {
        x: 0.08,
        y: 0.06,
        width: 0.58,
        height: 0.58,
      },
      width: 29,
      height: 29,
    });
    expect(result.heQcGeometry?.rect).not.toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.6,
      height: 0.6,
    });
    expect(result.cropRect).toEqual(chipBounds);
    expect(result.cropWidth).toBe(50);
    expect(result.cropHeight).toBe(50);
  });

  it('fails cleanly when no accepted transform exists', async () => {
    installBrowserStubs();

    const blockedError = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      alignmentAccepted: false,
      solveAccepted: false,
      chipBounds: {
        x: 0.05,
        y: 0.1,
        width: 0.8,
        height: 0.75,
      },
      acceptedChipBounds: null,
      coarseChipBounds: {
        x: 0.05,
        y: 0.1,
        width: 0.8,
        height: 0.75,
      },
      controlPoints: [],
      inlierMask: null,
    }).catch((error: unknown) => error);

    expect(blockedError).toBeInstanceOf(CropQcBlockedError);
    expect(blockedError).toMatchObject({
      code: 'missing-accepted-transform',
      message: 'Crop/QC is blocked until an accepted alignment transform is available.',
    });
  });

  it('includes points even when the warped match falls outside the crop bounds', async () => {
    installBrowserStubs();

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 60, 0, 1, 0],
      controlPoints: [
        { id: 'point-a', source: { x: 0.5, y: 0.5 }, target: { x: 0.5, y: 0.5 } },
      ],
      inlierMask: null,
    });

    const summary = parsePreviewSummary(result.featureMatchesDataUrl);

    expect(summary.arcCount).toBe(2);
  });

  it('keeps rejected alignments on the non-accepted full-frame preview path when both acceptance flags are false', async () => {
    installBrowserStubs();

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      alignmentAccepted: false,
      solveAccepted: false,
      chipBounds: {
        x: 0.25,
        y: 0.25,
        width: 0.5,
        height: 0.5,
      },
      controlPoints: [
        { id: 'point-a', source: { x: 0.5, y: 0.5 }, target: { x: 0.5, y: 0.5 } },
      ],
      inlierMask: [true],
    });

    const summary = parsePreviewSummary(result.featureMatchesDataUrl);

    expect(summary.arcPoints).toEqual([
      { x: 50, y: 50 },
      { x: 174, y: 50 },
    ]);
    expect(summary.lineSegments).toContainEqual({
      from: { x: 50, y: 50 },
      to: { x: 174, y: 50 },
    });
  });

  it('prefers solve acceptance when quality acceptance disagrees', async () => {
    installBrowserStubs();

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      alignmentAccepted: false,
      solveAccepted: true,
      chipBounds: {
        x: 0.25,
        y: 0.25,
        width: 0.5,
        height: 0.5,
      },
      controlPoints: [
        { id: 'point-a', source: { x: 0.5, y: 0.5 }, target: { x: 0.5, y: 0.5 } },
      ],
      inlierMask: [true],
    });

    const summary = parsePreviewSummary(result.featureMatchesDataUrl);

    expect(summary.arcPoints).toEqual([
      { x: 25, y: 25 },
      { x: 99, y: 25 },
    ]);
    expect(summary.lineSegments).toContainEqual({
      from: { x: 25, y: 25 },
      to: { x: 99, y: 25 },
    });
  });

  it('keeps accepted feature matches as a side-by-side montage wider than the crop', async () => {
    installBrowserStubs();

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      alignmentAccepted: true,
      solveAccepted: true,
      chipBounds: {
        x: 0.25,
        y: 0.25,
        width: 0.5,
        height: 0.5,
      },
      controlPoints: [
        { id: 'point-a', source: { x: 0.5, y: 0.5 }, target: { x: 0.5, y: 0.5 } },
      ],
      inlierMask: [true],
    });

    expect(result.cropWidth).toBe(50);
    expect(result.cropHeight).toBe(50);

    expect(result.featureMatchesDataUrl).toContain('mock:');

    const summary = parsePreviewSummary(result.featureMatchesDataUrl);
    expect(summary.arcCount).toBeGreaterThan(0);
    expect(summary.arcPoints[1]?.x).toBeGreaterThan(result.cropWidth);
  });
});
