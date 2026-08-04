import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AlignmentAffineMatrix,
  AlignmentControlPoint,
  LocalizationImageTransform,
  PreprocessRect,
} from '@/types/built-in';
import { CropQcBlockedError, CropQcGenerationError, runCropQc } from './cropQc';
import type { CvMat, OpenCvRuntime } from './loadOpenCv';

type CanvasOperation =
  | { type: 'arc'; x: number; y: number; radius: number }
  | {
    type: 'drawImage';
    args: number[];
    sourceHeight: number | null;
    sourceWidth: number | null;
  }
  | { type: 'fillRect'; fillStyle: string; x: number; y: number; width: number; height: number }
  | { type: 'lineTo'; x: number; y: number }
  | { type: 'moveTo'; x: number; y: number }
  | {
    type: 'putImageData';
    allPixelsMatch: boolean;
    firstPixel: [number, number, number, number] | null;
    height: number;
    samplePixels: {
      bottomLeft: [number, number, number, number] | null;
      bottomRight: [number, number, number, number] | null;
      center: [number, number, number, number] | null;
      topLeft: [number, number, number, number] | null;
      topRight: [number, number, number, number] | null;
    };
    width: number;
  }
  | { type: 'rotate'; angle: number }
  | { type: 'scale'; x: number; y: number }
  | { type: 'stroke'; lineWidth: number }
  | { type: 'translate'; x: number; y: number };

type CanvasDrawImageSummary = {
  args: number[];
  sourceHeight: number | null;
  sourceWidth: number | null;
};

type CanvasFillRectSummary = {
  fillStyle: string;
  height: number;
  width: number;
  x: number;
  y: number;
};

type CanvasImageDataSummary = {
  allPixelsMatch: boolean;
  firstPixel: [number, number, number, number] | null;
  height: number;
  samplePixels: {
    bottomLeft: [number, number, number, number] | null;
    bottomRight: [number, number, number, number] | null;
    center: [number, number, number, number] | null;
    topLeft: [number, number, number, number] | null;
    topRight: [number, number, number, number] | null;
  };
  width: number;
};

type CanvasRotateSummary = {
  angle: number;
};

type CanvasScaleSummary = {
  x: number;
  y: number;
};

type CanvasTranslateSummary = {
  x: number;
  y: number;
};

type PreviewSummary = {
  arcCount: number;
  arcPoints: Array<{ x: number; y: number }>;
  arcRadii: number[];
  canvasHeight: number;
  canvasWidth: number;
  drawImageCalls: CanvasDrawImageSummary[];
  fillRects: CanvasFillRectSummary[];
  lineSegments: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>;
  lineToCount: number;
  moveToCount: number;
  putImageData: CanvasImageDataSummary[];
  putImageDataCount: number;
  rotateCalls: CanvasRotateSummary[];
  scaleCalls: CanvasScaleSummary[];
  strokeLineWidths: number[];
  translateCalls: CanvasTranslateSummary[];
};

type WarpAffineCall = {
  borderMode: number;
  fill: [number, number, number, number];
  matrix: number[];
  size: { height: number; width: number };
};

const IMAGE_SIZE = { width: 100, height: 100 };
const CHIP_BOUNDS: PreprocessRect = { x: 0, y: 0, width: 1, height: 1 };
const IDENTITY_TRANSFORM: LocalizationImageTransform = {
  rotationDegrees: 0,
  flipHorizontal: false,
  flipVertical: false,
  scale: 1,
};
const warpAffineCalls: WarpAffineCall[] = [];
let mockImageSize = { ...IMAGE_SIZE };

const expectPreviewPointCloseTo = (
  actual: { x: number; y: number } | undefined,
  expected: { x: number; y: number },
) => {
  expect(actual).toBeDefined();
  expect(actual?.x).toBeCloseTo(expected.x, 6);
  expect(actual?.y).toBeCloseTo(expected.y, 6);
};

const expectDrawImageCallCloseTo = (
  actual: CanvasDrawImageSummary | undefined,
  expected: CanvasDrawImageSummary,
) => {
  expect(actual).toBeDefined();
  expect(actual?.sourceWidth).toBe(expected.sourceWidth);
  expect(actual?.sourceHeight).toBe(expected.sourceHeight);
  expect(actual?.args).toHaveLength(expected.args.length);

  for (const [index, value] of expected.args.entries()) {
    expect(actual?.args[index]).toBeCloseTo(value, 6);
  }
};

const getCanvasSourceDimensions = (source: unknown) => {
  if (!source || typeof source !== 'object') {
    return { height: null, width: null };
  }

  if ('width' in source && 'height' in source) {
    return {
      width: typeof source.width === 'number' ? source.width : null,
      height: typeof source.height === 'number' ? source.height : null,
    };
  }

  if ('naturalWidth' in source && 'naturalHeight' in source) {
    return {
      width: typeof source.naturalWidth === 'number' ? source.naturalWidth : null,
      height: typeof source.naturalHeight === 'number' ? source.naturalHeight : null,
    };
  }

  return { height: null, width: null };
};

const readPixel = (
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] | null => {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return null;
  }

  const offset = (y * width + x) * 4;
  return [
    data[offset] ?? 0,
    data[offset + 1] ?? 0,
    data[offset + 2] ?? 0,
    data[offset + 3] ?? 0,
  ];
};

const toSyntheticSourcePixel = (x: number, y: number): [number, number, number, number] => [
  x,
  y,
  (x + y) % 256,
  255,
];

const createSyntheticImageData = (width: number, height: number) => {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [r, g, b, a] = toSyntheticSourcePixel(x, y);
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }

  return data;
};

const resolveAffineSourcePoint = (matrix: number[], x: number, y: number) => {
  if (matrix.length !== 6) {
    return null;
  }

  const [a, b, c, d, e, f] = matrix;
  const determinant = (a * e) - (b * d);

  if (!Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON) {
    return null;
  }

  const translatedX = x - c;
  const translatedY = y - f;

  return {
    x: Math.round(((e * translatedX) - (b * translatedY)) / determinant),
    y: Math.round(((-d * translatedX) + (a * translatedY)) / determinant),
  };
};

const summarizeSamplePixels = (imageData: MockImageData) => ({
  topLeft: readPixel(imageData.data, imageData.width, imageData.height, 0, 0),
  topRight: readPixel(imageData.data, imageData.width, imageData.height, imageData.width - 1, 0),
  bottomLeft: readPixel(imageData.data, imageData.width, imageData.height, 0, imageData.height - 1),
  bottomRight: readPixel(imageData.data, imageData.width, imageData.height, imageData.width - 1, imageData.height - 1),
  center: readPixel(
    imageData.data,
    imageData.width,
    imageData.height,
    Math.floor(imageData.width / 2),
    Math.floor(imageData.height / 2),
  ),
});

const summarizeImageData = (imageData: MockImageData): CanvasImageDataSummary => {
  if (imageData.data.length < 4) {
    return {
      width: imageData.width,
      height: imageData.height,
      firstPixel: null,
      allPixelsMatch: true,
      samplePixels: summarizeSamplePixels(imageData),
    };
  }

  const firstPixel: [number, number, number, number] = [
    imageData.data[0] ?? 0,
    imageData.data[1] ?? 0,
    imageData.data[2] ?? 0,
    imageData.data[3] ?? 0,
  ];
  let allPixelsMatch = true;

  for (let offset = 4; offset < imageData.data.length; offset += 4) {
    if (
      imageData.data[offset] !== firstPixel[0]
      || imageData.data[offset + 1] !== firstPixel[1]
      || imageData.data[offset + 2] !== firstPixel[2]
      || imageData.data[offset + 3] !== firstPixel[3]
    ) {
      allPixelsMatch = false;
      break;
    }
  }

  return {
    width: imageData.width,
    height: imageData.height,
    firstPixel,
    allPixelsMatch,
    samplePixels: summarizeSamplePixels(imageData),
  };
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

  drawImage = vi.fn((source: unknown, ...args: number[]) => {
    const dimensions = getCanvasSourceDimensions(source);
    this.operations.push({
      type: 'drawImage',
      args,
      sourceWidth: dimensions.width,
      sourceHeight: dimensions.height,
    });
  });

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
    this.operations.push({ type: 'fillRect', fillStyle: this.fillStyle, x, y, width, height });
  });

  rotate = vi.fn((angle: number) => {
    this.operations.push({ type: 'rotate', angle });
  });

  save = vi.fn(() => undefined);

  scale = vi.fn((x: number, y: number) => {
    this.operations.push({ type: 'scale', x, y });
  });

  restore = vi.fn(() => undefined);

  translate = vi.fn((x: number, y: number) => {
    this.operations.push({ type: 'translate', x, y });
  });

  getImageData = vi.fn((x: number, y: number, width: number, height: number) => (
    (() => {
      void x;
      void y;
      return new MockImageData(createSyntheticImageData(width, height), width, height);
    })()
  ));

  putImageData = vi.fn((imageData: MockImageData) => {
    this.operations.push({ type: 'putImageData', ...summarizeImageData(imageData) });
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
      canvasHeight: this.height,
      canvasWidth: this.width,
      drawImageCalls: this.context.operations
        .filter((operation): operation is Extract<CanvasOperation, { type: 'drawImage' }> => operation.type === 'drawImage')
        .map((operation) => ({
          args: operation.args,
          sourceWidth: operation.sourceWidth,
          sourceHeight: operation.sourceHeight,
        })),
      fillRects: this.context.operations
        .filter((operation): operation is Extract<CanvasOperation, { type: 'fillRect' }> => operation.type === 'fillRect')
        .map((operation) => ({
          fillStyle: operation.fillStyle,
          x: operation.x,
          y: operation.y,
          width: operation.width,
          height: operation.height,
        })),
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
      putImageData: this.context.operations
        .filter((operation): operation is Extract<CanvasOperation, { type: 'putImageData' }> => operation.type === 'putImageData')
        .map((operation) => ({
          width: operation.width,
          height: operation.height,
          firstPixel: operation.firstPixel,
          allPixelsMatch: operation.allPixelsMatch,
          samplePixels: operation.samplePixels,
        })),
      putImageDataCount: this.context.operations.filter((operation) => operation.type === 'putImageData').length,
      rotateCalls: this.context.operations
        .filter((operation): operation is Extract<CanvasOperation, { type: 'rotate' }> => operation.type === 'rotate')
        .map((operation) => ({ angle: operation.angle })),
      scaleCalls: this.context.operations
        .filter((operation): operation is Extract<CanvasOperation, { type: 'scale' }> => operation.type === 'scale')
        .map((operation) => ({ x: operation.x, y: operation.y })),
      strokeLineWidths: this.context.operations
        .filter((operation): operation is Extract<CanvasOperation, { type: 'stroke' }> => operation.type === 'stroke')
        .map((operation) => operation.lineWidth),
      translateCalls: this.context.operations
        .filter((operation): operation is Extract<CanvasOperation, { type: 'translate' }> => operation.type === 'translate')
        .map((operation) => ({ x: operation.x, y: operation.y })),
    };

    return `mock:${JSON.stringify(summary)}`;
  }
}

class MockImage {
  naturalWidth = mockImageSize.width;
  naturalHeight = mockImageSize.height;
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
  warpAffine: (src, dst, matrix, size, _flags, borderMode, fill) => {
    if (dst instanceof FakeCvMat && size instanceof FakeCvSize) {
      const fillValues: [number, number, number, number] = fill instanceof FakeCvScalar
        ? [fill.v0, fill.v1, fill.v2, fill.v3]
        : [0, 0, 0, 0];
      const matrixValues = matrix instanceof FakeCvMat ? Array.from(matrix.data64F) : [];

      warpAffineCalls.push({
        borderMode: typeof borderMode === 'number' ? borderMode : NaN,
        fill: fillValues,
        matrix: matrixValues,
        size: { width: size.width, height: size.height },
      });
      dst.rows = size.height;
      dst.cols = size.width;
      dst.data = new Uint8Array(size.width * size.height * 4);

      for (let y = 0; y < size.height; y += 1) {
        for (let x = 0; x < size.width; x += 1) {
          const offset = (y * size.width + x) * 4;
          const sourcePoint = resolveAffineSourcePoint(matrixValues, x, y);
          const sourcePixel = sourcePoint && src instanceof FakeCvMat
            ? readPixel(src.data, src.cols, src.rows, sourcePoint.x, sourcePoint.y)
            : null;
          const [r, g, b, a] = sourcePixel ?? fillValues;

          dst.data[offset] = r;
          dst.data[offset + 1] = g;
          dst.data[offset + 2] = b;
          dst.data[offset + 3] = a;
        }
      }
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

const installBrowserStubs = (imageSize = IMAGE_SIZE) => {
  mockImageSize = { ...imageSize };
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

const parseCanvasSummary = (dataUrl: string) => parsePreviewSummary(dataUrl);

const getLastWarpAffineCall = () => warpAffineCalls.at(-1) ?? null;

const expectAssetCanvasSize = (dataUrl: string, size: { width: number; height: number }) => {
  const summary = parseCanvasSummary(dataUrl);
  expect(summary.canvasWidth).toBe(size.width);
  expect(summary.canvasHeight).toBe(size.height);
  return summary;
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
  cv?: OpenCvRuntime;
  alignmentAccepted?: boolean;
  acceptedChipQuad?: readonly [
    PreprocessPoint,
    PreprocessPoint,
    PreprocessPoint,
    PreprocessPoint,
  ] | null;
  acceptedChipBounds?: PreprocessRect | null;
  coarseChipBounds?: PreprocessRect | null;
  solveAccepted?: boolean;
  controlPoints: AlignmentControlPoint[];
  inlierMask: boolean[] | null;
  chipBounds?: PreprocessRect;
  imageTransform?: LocalizationImageTransform;
}) => {
  const request = {
    cv: args.cv ?? createOpenCvRuntime(),
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
  warpAffineCalls.length = 0;
  mockImageSize = { ...IMAGE_SIZE };
  vi.unstubAllGlobals();
});

describe('runCropQc feature match preview', () => {
  it('preserves the failing stage, original cause, and processing dimensions', async () => {
    installBrowserStubs();
    const cv = createOpenCvRuntime();
    const rootCause = new RangeError('OpenCV could not allocate the destination matrix');
    cv.warpAffine = () => {
      throw rootCause;
    };

    const cropError = await runCropQcWithArgs({
      cv,
      affineMatrix: [0.5, 0, 0, 0, 0.5, 0],
      controlPoints: [],
      inlierMask: null,
    }).catch((error: unknown) => error);

    expect(cropError).toBeInstanceOf(CropQcGenerationError);
    expect(cropError).toMatchObject({
      name: 'CropQcGenerationError',
      stage: 'warp-moving-image',
      cause: rootCause,
      details: {
        referenceSize: IMAGE_SIZE,
        movingSize: IMAGE_SIZE,
        outputSize: { width: 200, height: 200 },
        outputPixels: 40000,
        affineMatrix: [0.5, 0, 0, 0, 0.5, 0],
      },
    });
    expect((cropError as Error).message).toContain(
      'OpenCV could not allocate the destination matrix',
    );
  });

  it('warps only the ROI when a right-angle full-frame allocation would exceed the memory limit', async () => {
    installBrowserStubs();

    const result = await runCropQcWithArgs({
      affineMatrix: [0.005, 0, 20, 0, 0.005, 30],
      chipBounds: {
        x: 0.2,
        y: 0.3,
        width: 0.04,
        height: 0.04,
      },
      imageTransform: {
        rotationDegrees: 90,
        flipHorizontal: false,
        flipVertical: false,
        scale: 1,
      },
      controlPoints: [],
      inlierMask: null,
    });

    expect(getLastWarpAffineCall()).toMatchObject({
      size: { width: 800, height: 800 },
    });
    expect(result.cropWidth).toBe(800);
    expect(result.cropHeight).toBe(800);
    expectAssetCanvasSize(result.cropAssets.eosin.fullres.dataUrl, {
      width: 800,
      height: 800,
    });
    expectAssetCanvasSize(result.cropAssets.he.fullres.dataUrl, {
      width: 800,
      height: 800,
    });
  });

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

  it('keeps rotated canvas-axis capture bounds unchanged in Registration Review', async () => {
    installBrowserStubs({ width: 256, height: 281 });
    const captureBounds = {
      x: 0.3682958199356913,
      y: 0.33427888608963446,
      width: 0.28290443666636905,
      height: 0.2577350027992544,
    };

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      chipBounds: captureBounds,
      imageTransform: {
        rotationDegrees: 90,
        flipHorizontal: false,
        flipVertical: false,
        scale: 1.01,
      },
      controlPoints: [],
      inlierMask: null,
    });

    expect(result.cropRect.x).toBeCloseTo(captureBounds.x);
    expect(result.cropRect.y).toBeCloseTo(captureBounds.y);
    expect(result.cropRect.width).toBeCloseTo(captureBounds.width);
    expect(result.cropRect.height).toBeCloseTo(captureBounds.height);
    expect(result.cropWidth).toBe(72);
    expect(result.cropHeight).toBe(72);
  });

  it('applies localization rotation and flips to emitted crop assets and accepted preview markers', async () => {
    installBrowserStubs();

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      chipBounds: {
        x: 0.2,
        y: 0.1,
        width: 0.4,
        height: 0.4,
      },
      imageTransform: {
        rotationDegrees: 90,
        flipHorizontal: true,
        flipVertical: false,
        scale: 1,
      },
      controlPoints: [
        { id: 'point-a', source: { x: 0.3, y: 0.2 }, target: { x: 0.3, y: 0.2 } },
      ],
      inlierMask: [true],
      solveAccepted: true,
    });

    const eosinSummary = expectAssetCanvasSize(result.cropAssets.eosin.fullres.dataUrl, { width: 40, height: 40 });
    const heSummary = expectAssetCanvasSize(result.cropAssets.he.fullres.dataUrl, { width: 40, height: 40 });
    const featureSummary = parsePreviewSummary(result.featureMatchesDataUrl);

    expectDrawImageCallCloseTo(eosinSummary.drawImageCalls[0], {
      sourceWidth: 100,
      sourceHeight: 100,
      args: [20, 10, 40, 40, 0, 0, 40, 40],
    });
    expectDrawImageCallCloseTo(heSummary.drawImageCalls[0], {
      sourceWidth: 100,
      sourceHeight: 100,
      args: [20, 10, 40, 40, 0, 0, 40, 40],
    });
    expect(featureSummary.arcPoints).toHaveLength(2);
    expectPreviewPointCloseTo(featureSummary.arcPoints[0], { x: 0, y: 20 });
    expectPreviewPointCloseTo(featureSummary.arcPoints[1], { x: 64, y: 20 });
  });

  it('swaps emitted dimensions and crop-local HE geometry for non-square right-angle rotations', async () => {
    installBrowserStubs({ width: 100, height: 100 });

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 0.5, 0],
      chipBounds: {
        x: 0.2,
        y: 0.1,
        width: 0.4,
        height: 0.4,
      },
      acceptedChipBounds: {
        x: 0.3,
        y: 0.2,
        width: 0.2,
        height: 0.1,
      },
      imageTransform: {
        rotationDegrees: 90,
        flipHorizontal: false,
        flipVertical: false,
        scale: 1,
      },
      controlPoints: [],
      inlierMask: null,
      solveAccepted: true,
    });

    const eosinSummary = expectAssetCanvasSize(result.cropAssets.eosin.fullres.dataUrl, { width: 40, height: 80 });
    const heSummary = expectAssetCanvasSize(result.cropAssets.he.fullres.dataUrl, { width: 40, height: 80 });

    expect(result.cropWidth).toBe(40);
    expect(result.cropHeight).toBe(80);
    expectDrawImageCallCloseTo(eosinSummary.drawImageCalls[0], {
      sourceWidth: 100,
      sourceHeight: 200,
      args: [20, 20, 40, 80, 0, 0, 40, 80],
    });
    expectDrawImageCallCloseTo(heSummary.drawImageCalls[0], {
      sourceWidth: 100,
      sourceHeight: 200,
      args: [20, 20, 40, 80, 0, 0, 40, 80],
    });
    expectGeometryToBeCloseTo(result.heQcGeometry, {
      rect: {
        x: 2.5,
        y: 0.75,
        width: 0.25,
        height: 0.25,
      },
      width: 10,
      height: 20,
    });
  });

  it('keeps Localize scale out of emitted Crop/QC dimensions and geometry', async () => {
    installBrowserStubs({ width: 100, height: 100 });

    const baseArgs = {
      affineMatrix: [1, 0, 0, 0, 0.5, 0] as AlignmentAffineMatrix,
      chipBounds: {
        x: 0.2,
        y: 0.1,
        width: 0.4,
        height: 0.4,
      },
      acceptedChipBounds: {
        x: 0.3,
        y: 0.2,
        width: 0.2,
        height: 0.1,
      },
      controlPoints: [],
      inlierMask: null,
      solveAccepted: true,
    };

    const base = await runCropQcWithArgs({
      ...baseArgs,
      imageTransform: {
        rotationDegrees: 90,
        flipHorizontal: false,
        flipVertical: false,
        scale: 1,
      },
    });
    const zoomed = await runCropQcWithArgs({
      ...baseArgs,
      imageTransform: {
        rotationDegrees: 90,
        flipHorizontal: false,
        flipVertical: false,
        scale: 3,
      },
    });

    expect(zoomed.cropWidth).toBe(base.cropWidth);
    expect(zoomed.cropHeight).toBe(base.cropHeight);
    expect(zoomed.heQcGeometry).toEqual(base.heQcGeometry);
  });

  it('white-pads partial crop overruns instead of shrinking the canonical crop canvas', async () => {
    installBrowserStubs();

    const chipBounds: PreprocessRect = {
      x: -0.1,
      y: 0.2,
      width: 0.4,
      height: 0.4,
    };

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      chipBounds,
      controlPoints: [],
      inlierMask: null,
    });

    const eosinSummary = expectAssetCanvasSize(result.cropAssets.eosin.fullres.dataUrl, { width: 40, height: 40 });
    const heSummary = expectAssetCanvasSize(result.cropAssets.he.fullres.dataUrl, { width: 40, height: 40 });

    expect(result.cropRect).toEqual(chipBounds);
    expect(result.cropWidth).toBe(40);
    expect(result.cropHeight).toBe(40);
    expect(eosinSummary.fillRects).toContainEqual({
      fillStyle: '#ffffff',
      x: 0,
      y: 0,
      width: 40,
      height: 40,
    });
    expect(eosinSummary.drawImageCalls).toEqual([
      {
        sourceWidth: 100,
        sourceHeight: 100,
        args: [0, 20, 30, 40, 10, 0, 30, 40],
      },
    ]);
    expect(heSummary.drawImageCalls).toEqual([{
      sourceWidth: 100,
      sourceHeight: 100,
      args: [0, 20, 30, 40, 10, 0, 30, 40],
    }]);
    expect(getLastWarpAffineCall()).toMatchObject({
      size: { width: 100, height: 100 },
      borderMode: 0,
      fill: [255, 255, 255, 255],
      matrix: [1, 0, 0, 0, 1, 0],
    });
  });

  it('derives HE fullres at original density and downsamples hires when the corrected frame exceeds 2000px', async () => {
    installBrowserStubs({ width: 1000, height: 1000 });

    const result = await runCropQcWithArgs({
      affineMatrix: [0.4, 0, 0, 0, 0.4, 0],
      controlPoints: [],
      inlierMask: null,
    });

    expectAssetCanvasSize(result.cropAssets.eosin.fullres.dataUrl, { width: 2500, height: 2500 });
    expectAssetCanvasSize(result.cropAssets.he.fullres.dataUrl, { width: 2500, height: 2500 });
    expectAssetCanvasSize(result.cropAssets.he.hires.dataUrl, { width: 2000, height: 2000 });
    expectAssetCanvasSize(result.cropAssets.he.lowres.dataUrl, { width: 800, height: 800 });
    expectAssetCanvasSize(result.checkerboardDataUrl, { width: 2000, height: 2000 });
    expectAssetCanvasSize(result.featureMatchesDataUrl, { width: 4024, height: 2000 });
    expect(result.eosinReferenceGeometry.width).toBe(2500);
    expect(result.eosinReferenceGeometry.height).toBe(2500);
    expect(result.cropWidth).toBe(2500);
    expect(result.cropHeight).toBe(2500);
    expect(result.tissue_hires_scalef).toBeCloseTo(0.8);
    expect(result.tissue_lowres_scalef).toBeCloseTo(0.32);
    expect(getLastWarpAffineCall()).toMatchObject({
      size: { width: 2500, height: 2500 },
      matrix: [1, 0, 0, 0, 1, 0],
    });
  });

  it('does not upscale hires when the corrected fullres frame is already within the limit', async () => {
    installBrowserStubs({ width: 1000, height: 1000 });

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      controlPoints: [],
      inlierMask: null,
    });

    expectAssetCanvasSize(result.cropAssets.he.fullres.dataUrl, { width: 1000, height: 1000 });
    expectAssetCanvasSize(result.cropAssets.he.hires.dataUrl, { width: 1000, height: 1000 });
    expectAssetCanvasSize(result.cropAssets.he.lowres.dataUrl, { width: 800, height: 800 });
    expect(result.tissue_hires_scalef).toBe(1);
    expect(result.tissue_lowres_scalef).toBeCloseTo(0.8);
  });

  it('keeps white-fill padding intact for out-of-bounds transformed regions on the larger HE fullres frame', async () => {
    installBrowserStubs();

    const chipBounds: PreprocessRect = {
      x: -0.1,
      y: 0.2,
      width: 0.4,
      height: 0.4,
    };

    const result = await runCropQcWithArgs({
      affineMatrix: [0.5, 0, 0, 0, 0.5, 0],
      chipBounds,
      controlPoints: [],
      inlierMask: null,
    });

    const heSummary = expectAssetCanvasSize(result.cropAssets.he.fullres.dataUrl, { width: 80, height: 80 });

    expect(heSummary.drawImageCalls).toEqual([{
      sourceWidth: 200,
      sourceHeight: 200,
      args: [0, 40, 60, 80, 20, 0, 60, 80],
    }]);
    expect(getLastWarpAffineCall()).toMatchObject({
      size: { width: 200, height: 200 },
      borderMode: 0,
      fill: [255, 255, 255, 255],
      matrix: [1, 0, 0, 0, 1, 0],
    });
  });

  it('uses white constant borders on both affected sides for corner overruns in the warped HE crop', async () => {
    installBrowserStubs();

    const chipBounds: PreprocessRect = {
      x: -0.1,
      y: -0.1,
      width: 0.4,
      height: 0.4,
    };

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      chipBounds,
      controlPoints: [],
      inlierMask: null,
    });

    const heSummary = expectAssetCanvasSize(result.cropAssets.he.fullres.dataUrl, { width: 40, height: 40 });

    expect(heSummary.drawImageCalls).toEqual([{
      sourceWidth: 100,
      sourceHeight: 100,
      args: [0, 0, 30, 30, 10, 10, 30, 30],
    }]);
    expect(getLastWarpAffineCall()).toMatchObject({
      size: { width: 100, height: 100 },
      borderMode: 0,
      fill: [255, 255, 255, 255],
      matrix: [1, 0, 0, 0, 1, 0],
    });
  });

  it('renders fully outside crops as all-white canonical assets at the requested size', async () => {
    installBrowserStubs();

    const chipBounds: PreprocessRect = {
      x: 1.2,
      y: 1.1,
      width: 0.3,
      height: 0.3,
    };

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      chipBounds,
      controlPoints: [],
      inlierMask: null,
    });

    const eosinSummary = expectAssetCanvasSize(result.cropAssets.eosin.fullres.dataUrl, { width: 30, height: 30 });
    const heSummary = expectAssetCanvasSize(result.cropAssets.he.fullres.dataUrl, { width: 30, height: 30 });

    expect(result.cropRect).toEqual(chipBounds);
    expect(result.cropWidth).toBe(30);
    expect(result.cropHeight).toBe(30);
    expect(eosinSummary.fillRects).toContainEqual({
      fillStyle: '#ffffff',
      x: 0,
      y: 0,
      width: 30,
      height: 30,
    });
    expect(eosinSummary.drawImageCalls).toEqual([]);
    expect(heSummary.drawImageCalls).toEqual([]);
  });

  it('keeps fully in-bounds warped HE crops free of white-border regressions', async () => {
    installBrowserStubs();

    const chipBounds: PreprocessRect = {
      x: 0.2,
      y: 0.1,
      width: 0.3,
      height: 0.3,
    };

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      chipBounds,
      controlPoints: [],
      inlierMask: null,
    });

    const heSummary = expectAssetCanvasSize(result.cropAssets.he.fullres.dataUrl, { width: 30, height: 30 });

    expect(heSummary.drawImageCalls).toEqual([{
      sourceWidth: 100,
      sourceHeight: 100,
      args: [20, 10, 30, 30, 0, 0, 30, 30],
    }]);
    expect(getLastWarpAffineCall()).toMatchObject({
      size: { width: 100, height: 100 },
      borderMode: 0,
      fill: [255, 255, 255, 255],
      matrix: [1, 0, 0, 0, 1, 0],
    });
  });

  it('keeps canonical eosin and HE asset dimensions aligned to the requested crop extent', async () => {
    installBrowserStubs();

    const chipBounds: PreprocessRect = {
      x: -0.05,
      y: 0.1,
      width: 0.35,
      height: 0.25,
    };

    const result = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      chipBounds,
      controlPoints: [],
      inlierMask: null,
    });

    expect(result.cropRect).toEqual({
      x: -0.05,
      y: 0.1,
      width: 0.35,
      height: 0.35,
    });
    expect(result.cropWidth).toBe(35);
    expect(result.cropHeight).toBe(35);

    for (const asset of [
      result.cropAssets.eosin.fullres,
      result.cropAssets.eosin.hires,
      result.cropAssets.eosin.lowres,
      result.cropAssets.he.fullres,
      result.cropAssets.he.hires,
      result.cropAssets.he.lowres,
    ]) {
      expectAssetCanvasSize(asset.dataUrl, { width: 35, height: 35 });
    }
  });

  it('keeps localization chip geometry as the authoritative eosin crop domain', async () => {
    installBrowserStubs();

    const chipBounds: PreprocessRect = {
      x: 0.12,
      y: 0.18,
      width: 0.6,
      height: 0.6,
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

  it('keeps the downstream crop contract stable for accepted alignment inputs', async () => {
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
    const acceptedResult = await runCropQcWithArgs({
      affineMatrix: [1, 0, 0, 0, 1, 0],
      chipBounds,
      acceptedChipBounds,
      alignmentAccepted: true,
      controlPoints: [],
      inlierMask: null,
    });

    expectGeometryToBeCloseTo(acceptedResult.heQcGeometry, {
      rect: {
        x: 1 / 9,
        y: 1 / 6,
        width: 2 / 3,
        height: 0.5,
      },
      width: 24,
      height: 18,
    });
    expect(acceptedResult.cropRect.x).toBeCloseTo(chipBounds.x);
    expect(acceptedResult.cropRect.y).toBeCloseTo(chipBounds.y);
    expect(acceptedResult.cropRect.width).toBeCloseTo(chipBounds.width);
    expect(acceptedResult.cropRect.height).toBeCloseTo(chipBounds.height);
    expect(acceptedResult.cropWidth).toBe(36);
    expect(acceptedResult.cropHeight).toBe(36);
  });

  it('preserves refined H&E quad precedence for derived QC metadata', async () => {
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
    const acceptedChipQuad = [
      { x: 0.32, y: 0.31 },
      { x: 0.58, y: 0.28 },
      { x: 0.54, y: 0.57 },
      { x: 0.29, y: 0.52 },
    ] satisfies readonly [
      PreprocessPoint,
      PreprocessPoint,
      PreprocessPoint,
      PreprocessPoint,
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
      controlPoints: [],
      inlierMask: null,
    }).catch((error: unknown) => error);

    expect(blockedError).toBeInstanceOf(CropQcBlockedError);
    expect(blockedError).toMatchObject({
      code: 'missing-accepted-transform',
      message: 'Crop QC is blocked until an accepted registration transform is available.',
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
