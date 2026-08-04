import type {
  AlignmentAffineMatrix,
  AlignmentControlPoint,
  CanonicalCropQcGeometry,
  CropQcCanonicalAsset,
  CropQcCanonicalAssetSet,
  LocalizationImageTransform,
  PreprocessPoint,
  PreprocessRect,
} from '@/types/preprocess';
import type { CvMat, OpenCvRuntime } from './loadOpenCv';
import { LOCALIZATION_MIN_BOX_SIZE } from './localization';

type Size = { width: number; height: number };
type PixelRect = { x: number; y: number; width: number; height: number };
type PixelPoint = { x: number; y: number };
type HeFocusAutoProposalQuad = readonly [
  PreprocessPoint,
  PreprocessPoint,
  PreprocessPoint,
  PreprocessPoint,
];

export type CropQcBlockedReason = 'missing-accepted-transform' | 'missing-accepted-chip-bounds';

export class CropQcBlockedError extends Error {
  readonly code: CropQcBlockedReason;

  constructor(code: CropQcBlockedReason, message?: string) {
    super(message ?? (code === 'missing-accepted-transform'
      ? 'Crop QC is blocked until an accepted registration transform is available.'
      : 'Crop QC is blocked until accepted chip geometry is available.'));
    this.name = 'CropQcBlockedError';
    this.code = code;
  }
}

export type CropQcFailureStage =
  | 'load-reference-image'
  | 'load-moving-image'
  | 'resolve-crop-bounds'
  | 'calculate-output-size'
  | 'prepare-reference-frame'
  | 'warp-moving-image'
  | 'orient-reference-frame'
  | 'orient-moving-frame'
  | 'crop-reference-image'
  | 'crop-moving-image'
  | 'calculate-qc-geometry'
  | 'encode-reference-assets'
  | 'encode-moving-assets'
  | 'generate-checkerboard-preview'
  | 'generate-feature-matches-preview'
  | 'finalize-result';

const CROP_QC_STAGE_LABELS: Record<CropQcFailureStage, string> = {
  'load-reference-image': 'loading the eosin reference image',
  'load-moving-image': 'loading the H&E moving image',
  'resolve-crop-bounds': 'resolving the registered ROI bounds',
  'calculate-output-size': 'calculating the registered output size',
  'prepare-reference-frame': 'preparing the full-resolution reference frame',
  'warp-moving-image': 'warping the H&E image with OpenCV',
  'orient-reference-frame': 'orienting the eosin reference frame',
  'orient-moving-frame': 'orienting the registered H&E frame',
  'crop-reference-image': 'cropping the eosin reference image',
  'crop-moving-image': 'cropping the registered H&E image',
  'calculate-qc-geometry': 'calculating Crop/QC geometry',
  'encode-reference-assets': 'encoding eosin crop assets',
  'encode-moving-assets': 'encoding H&E crop assets',
  'generate-checkerboard-preview': 'generating the checkerboard preview',
  'generate-feature-matches-preview': 'generating the feature-match preview',
  'finalize-result': 'finalizing Crop/QC metadata',
};

const describeUnknownError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export class CropQcGenerationError extends Error {
  readonly stage: CropQcFailureStage;
  readonly details: Record<string, unknown>;
  override readonly cause: unknown;

  constructor(
    stage: CropQcFailureStage,
    cause: unknown,
    details: Record<string, unknown> = {},
  ) {
    const reason = describeUnknownError(cause);
    super(`Crop QC failed while ${CROP_QC_STAGE_LABELS[stage]}: ${reason}`);
    this.name = 'CropQcGenerationError';
    this.stage = stage;
    this.details = details;
    this.cause = cause;
  }
}

const throwCropQcStageError = (
  stage: CropQcFailureStage,
  error: unknown,
  details: Record<string, unknown>,
): never => {
  if (error instanceof CropQcBlockedError || error instanceof CropQcGenerationError) {
    throw error;
  }
  throw new CropQcGenerationError(stage, error, details);
};

const runCropQcStage = <T>(
  stage: CropQcFailureStage,
  details: Record<string, unknown>,
  callback: () => T,
): T => {
  try {
    return callback();
  } catch (error) {
    return throwCropQcStageError(stage, error, details);
  }
};

const runAsyncCropQcStage = async <T>(
  stage: CropQcFailureStage,
  details: Record<string, unknown>,
  callback: () => Promise<T>,
): Promise<T> => {
  try {
    return await callback();
  } catch (error) {
    return throwCropQcStageError(stage, error, details);
  }
};

const disposeCanvas = (canvas: HTMLCanvasElement) => {
  canvas.width = 0;
  canvas.height = 0;
};

export type CropQcResult = {
  eosinReferenceGeometry: CanonicalCropQcGeometry;
  heQcGeometry: CanonicalCropQcGeometry | null;
  cropRect: PreprocessRect;
  cropWidth: number;
  cropHeight: number;
  cropAssets: {
    eosin: CropQcCanonicalAssetSet;
    he: CropQcCanonicalAssetSet;
  };
  tissue_hires_scalef: number;
  tissue_lowres_scalef: number;
  spot_diameter_fullres: number | null;
  fiducial_diameter_fullres: number;
  checkerboardPreview: {
    dataUrl: string;
  };
  featureMatchesPreview: {
    dataUrl: string;
  };
  eosinCropDataUrl: string;
  heWarpedCropDataUrl: string;
  checkerboardDataUrl: string;
  featureMatchesDataUrl: string;
};

const HIRES_MAX_SIDE = 2000;
const LOWRES_MAX_SIDE = 800;
const FULL_FRAME_WARP_MAX_PIXELS = 64 * 1024 * 1024;
const FIDUCIAL_DIAMETER_FULLRES = 0.027;
const FEATURE_MATCHES_GAP = 24;
const FEATURE_MATCH_VISUAL_SIZE = 4;
const FEATURE_MATCHES_COLORS = [
  '#ff5252',
  '#2dd4bf',
  '#6366f1',
  '#f59e0b',
  '#14b8a6',
  '#ec4899',
  '#3b82f6',
  '#84cc16',
] as const;

const drawCanvas = (source: CanvasImageSource, size: Size) => {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  try {
    if (!context) throw new Error('Canvas context unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, size.width, size.height);
    return canvas;
  } catch (error) {
    disposeCanvas(canvas);
    throw error;
  }
};

const fillCanvasWhite = (context: CanvasRenderingContext2D, size: Size) => {
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
};

const isIdentityImageOrientation = (transform: LocalizationImageTransform) => (
  transform.rotationDegrees === 0 && !transform.flipHorizontal && !transform.flipVertical
);

const isRightAngleImageOrientation = (transform: LocalizationImageTransform) => {
  const quarterTurns = transform.rotationDegrees / 90;
  return Math.abs(quarterTurns - Math.round(quarterTurns)) < 1e-8;
};

const getOrientedCropSize = (source: Size, transform: LocalizationImageTransform): Size => {
  const radians = (transform.rotationDegrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));

  return {
    width: Math.max(1, Math.round(source.width * cos + source.height * sin)),
    height: Math.max(1, Math.round(source.width * sin + source.height * cos)),
  };
};

const applyCropLocalImageTransform = (
  point: PixelPoint,
  transform: LocalizationImageTransform,
  sourceSize: Size,
  outputSize = getOrientedCropSize(sourceSize, transform),
): PixelPoint => {
  const sourceCenter = {
    x: sourceSize.width / 2,
    y: sourceSize.height / 2,
  };
  const outputCenter = {
    x: outputSize.width / 2,
    y: outputSize.height / 2,
  };
  const radians = (transform.rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const sourceDeltaX = point.x - sourceCenter.x;
  const sourceDeltaY = point.y - sourceCenter.y;
  const flippedDeltaX = sourceDeltaX * (transform.flipHorizontal ? -1 : 1);
  const flippedDeltaY = sourceDeltaY * (transform.flipVertical ? -1 : 1);
  const rotatedDeltaX = flippedDeltaX * cos - flippedDeltaY * sin;
  const rotatedDeltaY = flippedDeltaX * sin + flippedDeltaY * cos;

  return {
    x: outputCenter.x + rotatedDeltaX,
    y: outputCenter.y + rotatedDeltaY,
  };
};

const drawCanvasWithImageOrientation = (
  source: HTMLCanvasElement,
  transform: LocalizationImageTransform,
  outputSize = getOrientedCropSize(source, transform),
) => {
  if (isIdentityImageOrientation(transform)) {
    return source;
  }

  const canvas = document.createElement('canvas');
  canvas.width = outputSize.width;
  canvas.height = outputSize.height;
  const context = canvas.getContext('2d');
  try {
    if (!context) throw new Error('Oriented crop canvas context unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    fillCanvasWhite(context, outputSize);
    // Localize scale is UI zoom; Crop/QC only needs the saved orientation.
    context.translate(outputSize.width / 2, outputSize.height / 2);
    context.rotate((transform.rotationDegrees * Math.PI) / 180);
    context.scale(transform.flipHorizontal ? -1 : 1, transform.flipVertical ? -1 : 1);
    context.drawImage(source, -source.width / 2, -source.height / 2, source.width, source.height);
    return canvas;
  } catch (error) {
    disposeCanvas(canvas);
    throw error;
  }
};

const preserveRequestedSquareRect = (
  rect: PreprocessRect,
  imageAspectRatio = 1,
  minSize = LOCALIZATION_MIN_BOX_SIZE,
): PreprocessRect => {
  const aspectRatio = Math.max(imageAspectRatio, Number.EPSILON);
  const size = Math.max(rect.width, rect.height / aspectRatio, minSize);

  return {
    x: rect.x,
    y: rect.y,
    width: size,
    height: size * aspectRatio,
  };
};

const resolvePixelIntersection = (
  pixelRect: PixelRect,
  imageSize: Size,
): {
  sourceRect: PixelRect;
  destinationOrigin: PixelPoint;
} | null => {
  const sourceX = Math.max(0, pixelRect.x);
  const sourceY = Math.max(0, pixelRect.y);
  const sourceEndX = Math.min(imageSize.width, pixelRect.x + pixelRect.width);
  const sourceEndY = Math.min(imageSize.height, pixelRect.y + pixelRect.height);
  const sourceWidth = Math.max(0, sourceEndX - sourceX);
  const sourceHeight = Math.max(0, sourceEndY - sourceY);

  if (sourceWidth === 0 || sourceHeight === 0) {
    return null;
  }

  return {
    sourceRect: {
      x: sourceX,
      y: sourceY,
      width: sourceWidth,
      height: sourceHeight,
    },
    destinationOrigin: {
      x: sourceX - pixelRect.x,
      y: sourceY - pixelRect.y,
    },
  };
};

const cropCanvas = (
  source: CanvasImageSource,
  sourceSize: Size,
  pixelRect: PixelRect,
) => {
  const canvas = document.createElement('canvas');
  canvas.width = pixelRect.width;
  canvas.height = pixelRect.height;
  const context = canvas.getContext('2d');
  try {
    if (!context) throw new Error('Crop canvas context unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    fillCanvasWhite(context, { width: pixelRect.width, height: pixelRect.height });

    const intersection = resolvePixelIntersection(pixelRect, sourceSize);
    if (intersection) {
      context.drawImage(
        source,
        intersection.sourceRect.x,
        intersection.sourceRect.y,
        intersection.sourceRect.width,
        intersection.sourceRect.height,
        intersection.destinationOrigin.x,
        intersection.destinationOrigin.y,
        intersection.sourceRect.width,
        intersection.sourceRect.height,
      );
    }

    return canvas;
  } catch (error) {
    disposeCanvas(canvas);
    throw error;
  }
};

const getResizeDownOnlyDimensions = (source: Size, targetMaxSide: number): Size => {
  const sourceMaxSide = Math.max(source.width, source.height);
  if (sourceMaxSide <= targetMaxSide) {
    return source;
  }

  const scale = targetMaxSide / sourceMaxSide;
  if (source.width >= source.height) {
    return {
      width: targetMaxSide,
      height: Math.max(1, Math.round(source.height * scale)),
    };
  }

  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: targetMaxSide,
  };
};

const toCanonicalAsset = (canvas: HTMLCanvasElement): CropQcCanonicalAsset => ({
  dataUrl: canvas.toDataURL('image/png'),
});

const buildCanonicalAssetSet = (fullresCanvas: HTMLCanvasElement): {
  assets: CropQcCanonicalAssetSet;
  sizes: {
    fullres: Size;
    hires: Size;
    lowres: Size;
  };
} => {
  const fullresSize = { width: fullresCanvas.width, height: fullresCanvas.height };
  const hiresSize = getResizeDownOnlyDimensions(fullresSize, HIRES_MAX_SIDE);
  const lowresSize = getResizeDownOnlyDimensions(fullresSize, LOWRES_MAX_SIDE);

  const hiresCanvas = hiresSize.width === fullresCanvas.width && hiresSize.height === fullresCanvas.height
    ? fullresCanvas
    : drawCanvas(fullresCanvas, hiresSize);
  const lowresCanvas = lowresSize.width === fullresCanvas.width && lowresSize.height === fullresCanvas.height
    ? fullresCanvas
    : drawCanvas(fullresCanvas, lowresSize);

  try {
    const assets = {
      fullres: toCanonicalAsset(fullresCanvas),
      hires: toCanonicalAsset(hiresCanvas),
      lowres: toCanonicalAsset(lowresCanvas),
    } satisfies CropQcCanonicalAssetSet;

    return {
      assets,
      sizes: {
        fullres: fullresSize,
        hires: hiresSize,
        lowres: lowresSize,
      },
    };
  } finally {
    if (hiresCanvas !== fullresCanvas) {
      disposeCanvas(hiresCanvas);
    }
    if (lowresCanvas !== fullresCanvas && lowresCanvas !== hiresCanvas) {
      disposeCanvas(lowresCanvas);
    }
  }
};

const getScaleFactor = (assetSize: Size, fullresSize: Size) => {
  const emittedMaxSide = Math.max(assetSize.width, assetSize.height);
  const fullresMaxSide = Math.max(fullresSize.width, fullresSize.height);
  return fullresMaxSide > 0 ? emittedMaxSide / fullresMaxSide : 1;
};

const getAxisScale = (xComponent: number, yComponent: number) => {
  const scale = Math.hypot(xComponent, yComponent);
  return Number.isFinite(scale) && scale > Number.EPSILON ? scale : 1;
};

const getOriginalDensityCropSize = (
  pixelRect: PixelRect,
  affineMatrix: AlignmentAffineMatrix,
): Size => ({
  width: Math.max(1, Math.round(pixelRect.width / getAxisScale(affineMatrix[0], affineMatrix[3]))),
  height: Math.max(1, Math.round(pixelRect.height / getAxisScale(affineMatrix[1], affineMatrix[4]))),
});

const loadImage = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new window.Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Image decoding failed'));
  image.src = dataUrl;
});

const imageToCanvas = async (dataUrl: string) => {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  try {
    if (!context) throw new Error('Canvas context unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0);
    return { canvas, context, width: image.naturalWidth, height: image.naturalHeight };
  } catch (error) {
    disposeCanvas(canvas);
    throw error;
  }
};

const normalizeRect = (
  chipBounds: PreprocessRect,
  imageSize: Size,
): { rect: PreprocessRect; pixelRect: PixelRect } => {
  const pxX = Math.round(chipBounds.x * imageSize.width);
  const pxY = Math.round(chipBounds.y * imageSize.height);
  const pxWidth = Math.max(1, Math.round(chipBounds.width * imageSize.width));
  const pxHeight = Math.max(1, Math.round(chipBounds.height * imageSize.height));

  return {
    rect: {
      x: chipBounds.x,
      y: chipBounds.y,
      width: chipBounds.width,
      height: chipBounds.height,
    },
    pixelRect: {
      x: pxX,
      y: pxY,
      width: pxWidth,
      height: pxHeight,
    },
  };
};

const makeCheckerboard = (
  eosinCrop: HTMLCanvasElement,
  heCrop: HTMLCanvasElement,
) => {
  const checker = document.createElement('canvas');
  checker.width = eosinCrop.width;
  checker.height = eosinCrop.height;
  const context = checker.getContext('2d');
  try {
    if (!context) throw new Error('Checkerboard context unavailable');
    context.imageSmoothingEnabled = false;

    const tilesX = 10;
    const tilesY = 10;
    const tileWidth = Math.ceil(checker.width / tilesX);
    const tileHeight = Math.ceil(checker.height / tilesY);

    for (let y = 0; y < checker.height; y += tileHeight) {
      for (let x = 0; x < checker.width; x += tileWidth) {
        const useEosin = ((Math.floor(x / tileWidth) + Math.floor(y / tileHeight)) % 2) === 0;
        const src = useEosin ? eosinCrop : heCrop;
        const drawWidth = Math.min(tileWidth, checker.width - x);
        const drawHeight = Math.min(tileHeight, checker.height - y);
        context.drawImage(src, x, y, drawWidth, drawHeight, x, y, drawWidth, drawHeight);
      }
    }

    return checker.toDataURL('image/png');
  } finally {
    disposeCanvas(checker);
  }
};

const toPixelPoint = (point: { x: number; y: number }, size: Size): PixelPoint => ({
  x: point.x * size.width,
  y: point.y * size.height,
});

const toRectCornerPoints = (
  rect: PreprocessRect,
  size: Size,
): [PixelPoint, PixelPoint, PixelPoint, PixelPoint] => ([
  toPixelPoint({ x: rect.x, y: rect.y }, size),
  toPixelPoint({ x: rect.x + rect.width, y: rect.y }, size),
  toPixelPoint({ x: rect.x + rect.width, y: rect.y + rect.height }, size),
  toPixelPoint({ x: rect.x, y: rect.y + rect.height }, size),
]);

const toPixelBounds = (points: readonly PixelPoint[]): PixelRect => {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const applyInverseCropLocalImageTransform = (
  point: PixelPoint,
  transform: LocalizationImageTransform,
  sourceSize: Size,
  outputSize: Size,
): PixelPoint => {
  const radians = (-transform.rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotatedDeltaX = (point.x - outputSize.width / 2) * cos
    - (point.y - outputSize.height / 2) * sin;
  const rotatedDeltaY = (point.x - outputSize.width / 2) * sin
    + (point.y - outputSize.height / 2) * cos;
  const unflippedDeltaX = rotatedDeltaX * (transform.flipHorizontal ? -1 : 1);
  const unflippedDeltaY = rotatedDeltaY * (transform.flipVertical ? -1 : 1);

  return {
    x: sourceSize.width / 2 + unflippedDeltaX,
    y: sourceSize.height / 2 + unflippedDeltaY,
  };
};

const inverseTransformPixelRect = (
  pixelRect: PixelRect,
  transform: LocalizationImageTransform,
  sourceSize: Size,
  outputSize: Size,
): PixelRect => {
  if (isIdentityImageOrientation(transform)) {
    return pixelRect;
  }

  return toPixelBounds([
    { x: pixelRect.x, y: pixelRect.y },
    { x: pixelRect.x + pixelRect.width, y: pixelRect.y },
    { x: pixelRect.x + pixelRect.width, y: pixelRect.y + pixelRect.height },
    { x: pixelRect.x, y: pixelRect.y + pixelRect.height },
  ].map((point) => applyInverseCropLocalImageTransform(
    point,
    transform,
    sourceSize,
    outputSize,
  )));
};

const applyAffineToPoint = (
  point: PixelPoint,
  affineMatrix: AlignmentAffineMatrix,
): PixelPoint => ({
  x: affineMatrix[0] * point.x + affineMatrix[1] * point.y + affineMatrix[2],
  y: affineMatrix[3] * point.x + affineMatrix[4] * point.y + affineMatrix[5],
});

const usesCanonicalAcceptedGeometryContract = (args: {
  acceptedChipQuad?: HeFocusAutoProposalQuad | null;
  acceptedChipBounds?: PreprocessRect | null;
  coarseChipBounds?: PreprocessRect | null;
}) => args.acceptedChipQuad !== undefined
  || args.acceptedChipBounds !== undefined
  || args.coarseChipBounds !== undefined;

const toCanonicalCropQcGeometry = (normalized: {
  rect: PreprocessRect;
  pixelRect: PixelRect;
}): CanonicalCropQcGeometry => ({
  rect: normalized.rect,
  width: normalized.pixelRect.width,
  height: normalized.pixelRect.height,
});

const normalizeRectForSize = (
  chipBounds: PreprocessRect,
  outputSize: Size,
): { rect: PreprocessRect; pixelRect: PixelRect } => {
  const pxX = Math.round(chipBounds.x * outputSize.width);
  const pxY = Math.round(chipBounds.y * outputSize.height);
  const pxWidth = Math.max(1, Math.round(chipBounds.width * outputSize.width));
  const pxHeight = Math.max(1, Math.round(chipBounds.height * outputSize.height));

  return {
    rect: {
      x: chipBounds.x,
      y: chipBounds.y,
      width: chipBounds.width,
      height: chipBounds.height,
    },
    pixelRect: {
      x: pxX,
      y: pxY,
      width: pxWidth,
      height: pxHeight,
    },
  };
};

const resolveCropBounds = (args: {
  chipBounds: PreprocessRect;
  acceptedChipQuad?: HeFocusAutoProposalQuad | null;
  acceptedChipBounds?: PreprocessRect | null;
  coarseChipBounds?: PreprocessRect | null;
  referenceSize: Size;
  alignmentAccepted?: boolean;
  solveAccepted?: boolean;
}) => {
  const usesAcceptedGeometryContract = usesCanonicalAcceptedGeometryContract(args);
  if (usesAcceptedGeometryContract) {
    const hasAcceptedTransform = args.solveAccepted ?? args.alignmentAccepted ?? false;
    if (!hasAcceptedTransform) {
      throw new CropQcBlockedError('missing-accepted-transform');
    }
  }

  const squareChipBounds = preserveRequestedSquareRect(
    args.chipBounds,
    args.referenceSize.width / Math.max(args.referenceSize.height, Number.EPSILON),
  );

  return normalizeRect(squareChipBounds, args.referenceSize);
};

const toCropLocalPoint = (point: PixelPoint, pixelRect: PixelRect): PixelPoint => ({
  x: point.x - pixelRect.x,
  y: point.y - pixelRect.y,
});

const toCropLocalGeometry = (
  points: readonly PixelPoint[],
  cropSize: Size,
): CanonicalCropQcGeometry => {
  const bounds = toPixelBounds(points);

  return {
    rect: {
      x: bounds.x / cropSize.width,
      y: bounds.y / cropSize.height,
      width: bounds.width / cropSize.width,
      height: bounds.height / cropSize.height,
    },
    width: bounds.width,
    height: bounds.height,
  };
};

const resolveHeQcGeometry = (args: {
  acceptedChipQuad?: HeFocusAutoProposalQuad | null;
  acceptedChipBounds?: PreprocessRect | null;
  movingSize: Size;
  affineMatrix: AlignmentAffineMatrix;
  cropPixelRect: PixelRect;
}): CanonicalCropQcGeometry | null => {
  const sourcePoints = args.acceptedChipQuad?.map((point) => toPixelPoint(point, args.movingSize))
    ?? (args.acceptedChipBounds ? toRectCornerPoints(args.acceptedChipBounds, args.movingSize) : null);
  if (!sourcePoints) {
    return null;
  }

  const cropLocalPoints = sourcePoints
    .map((point) => applyAffineToPoint(point, args.affineMatrix))
    .map((point) => toCropLocalPoint(point, args.cropPixelRect));

  return toCropLocalGeometry(cropLocalPoints, {
    width: args.cropPixelRect.width,
    height: args.cropPixelRect.height,
  });
};

const orientCropLocalGeometry = (
  geometry: CanonicalCropQcGeometry | null,
  transform: LocalizationImageTransform,
  sourceSize: Size,
  outputSize: Size,
): CanonicalCropQcGeometry | null => {
  if (!geometry || isIdentityImageOrientation(transform)) {
    return geometry;
  }

  const points = toRectCornerPoints(geometry.rect, sourceSize)
    .map((point) => applyCropLocalImageTransform(point, transform, sourceSize, outputSize));

  return toCropLocalGeometry(points, outputSize);
};

const getFeatureMatchCandidates = (
  controlPoints: AlignmentControlPoint[],
  inlierMask: boolean[] | null,
) => {
  if (!inlierMask) {
    return controlPoints;
  }

  return controlPoints.filter((_, index) => inlierMask[index] ?? false);
};

const drawFeatureMatchMarker = (
  context: CanvasRenderingContext2D,
  point: PixelPoint,
  color: string,
) => {
  context.beginPath();
  context.arc(point.x, point.y, FEATURE_MATCH_VISUAL_SIZE, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  context.stroke();
};

const makeFeatureMatchesPreview = (args: {
  alignmentAccepted: boolean;
  eosinFull: HTMLCanvasElement;
  eosinCrop: HTMLCanvasElement;
  heFull: HTMLCanvasElement;
  heCrop: HTMLCanvasElement;
  pixelRect: PixelRect;
  referenceSize: Size;
  fullresReferenceSize: Size;
  orientedFullresReferenceSize: Size;
  movingSize: Size;
  affineMatrix: AlignmentAffineMatrix;
  controlPoints: AlignmentControlPoint[];
  inlierMask: boolean[] | null;
  imageTransform: LocalizationImageTransform;
}) => {
  const leftCanvas = args.alignmentAccepted ? args.eosinCrop : args.eosinFull;
  const rightCanvas = args.alignmentAccepted ? args.heCrop : args.heFull;
  const preview = document.createElement('canvas');
  preview.width = leftCanvas.width + rightCanvas.width + FEATURE_MATCHES_GAP;
  preview.height = Math.max(leftCanvas.height, rightCanvas.height);
  const context = preview.getContext('2d');
  try {
    if (!context) throw new Error('Feature matches context unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, preview.width, preview.height);
    context.drawImage(leftCanvas, 0, 0);
    context.drawImage(rightCanvas, leftCanvas.width + FEATURE_MATCHES_GAP, 0);

    const separatorX = leftCanvas.width + FEATURE_MATCHES_GAP / 2;
    context.beginPath();
    context.moveTo(separatorX, 0);
    context.lineTo(separatorX, preview.height);
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(15, 23, 42, 0.12)';
    context.stroke();

    const candidates = args.alignmentAccepted
      ? getFeatureMatchCandidates(args.controlPoints, args.inlierMask)
      : args.controlPoints;
    const acceptedScale = {
      x: args.alignmentAccepted ? leftCanvas.width / Math.max(args.pixelRect.width, 1) : 1,
      y: args.alignmentAccepted ? leftCanvas.height / Math.max(args.pixelRect.height, 1) : 1,
    };
    const fullresScale = {
      x: args.fullresReferenceSize.width / Math.max(args.referenceSize.width, 1),
      y: args.fullresReferenceSize.height / Math.max(args.referenceSize.height, 1),
    };
    let drawableIndex = 0;

    const toAcceptedCropPoint = (point: PixelPoint) => ({
      x: toCropLocalPoint(point, args.pixelRect).x * acceptedScale.x,
      y: toCropLocalPoint(point, args.pixelRect).y * acceptedScale.y,
    });
    const toFullresPoint = (point: PixelPoint) => ({
      x: point.x * fullresScale.x,
      y: point.y * fullresScale.y,
    });
    const toOrientedFullresPoint = (point: PixelPoint) => applyCropLocalImageTransform(
      toFullresPoint(point),
      args.imageTransform,
      args.fullresReferenceSize,
      args.orientedFullresReferenceSize,
    );

    for (const candidate of candidates) {
      const referencePoint = toPixelPoint(candidate.source, args.referenceSize);
      const movingPoint = toPixelPoint(candidate.target, args.movingSize);
      const warpedMovingPoint = args.alignmentAccepted
        ? applyAffineToPoint(movingPoint, args.affineMatrix)
        : movingPoint;

      const leftPoint = args.alignmentAccepted
        ? toAcceptedCropPoint(toOrientedFullresPoint(referencePoint))
        : referencePoint;
      const rightLocalPoint = args.alignmentAccepted
        ? toAcceptedCropPoint(toOrientedFullresPoint(warpedMovingPoint))
        : warpedMovingPoint;
      const rightPoint = {
        x: leftCanvas.width + FEATURE_MATCHES_GAP + rightLocalPoint.x,
        y: rightLocalPoint.y,
      };
      const color = FEATURE_MATCHES_COLORS[drawableIndex % FEATURE_MATCHES_COLORS.length];
      drawableIndex += 1;

      context.beginPath();
      context.moveTo(leftPoint.x, leftPoint.y);
      context.lineTo(rightPoint.x, rightPoint.y);
      context.lineWidth = FEATURE_MATCH_VISUAL_SIZE / 2;
      context.strokeStyle = color;
      context.stroke();

      drawFeatureMatchMarker(context, leftPoint, color);
      drawFeatureMatchMarker(context, rightPoint, color);
    }

    return preview.toDataURL('image/png');
  } finally {
    disposeCanvas(preview);
  }
};

const makeWarpedHeCrop = (
  cv: OpenCvRuntime,
  heCanvas: HTMLCanvasElement,
  affineMatrix: AlignmentAffineMatrix,
  pixelRect: PixelRect,
  outputSize: Size,
) => {
  const context = heCanvas.getContext('2d');
  if (!context) throw new Error('HE canvas context unavailable');
  const imageData = context.getImageData(0, 0, heCanvas.width, heCanvas.height);

  let src: CvMat | null = null;
  let matrix: CvMat | null = null;
  let dst: CvMat | null = null;
  try {
    const scaleX = outputSize.width / Math.max(pixelRect.width, 1);
    const scaleY = outputSize.height / Math.max(pixelRect.height, 1);
    src = cv.matFromImageData(imageData);
    matrix = cv.matFromArray(2, 3, cv.CV_64F, [
      affineMatrix[0] * scaleX,
      affineMatrix[1] * scaleX,
      (affineMatrix[2] - pixelRect.x) * scaleX,
      affineMatrix[3] * scaleY,
      affineMatrix[4] * scaleY,
      (affineMatrix[5] - pixelRect.y) * scaleY,
    ]);
    dst = new cv.Mat();
    const size = new cv.Size(outputSize.width, outputSize.height);
    const fill = new cv.Scalar(255, 255, 255, 255);

    cv.warpAffine(
      src,
      dst,
      matrix,
      size,
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      fill,
    );

    const pixelData = new Uint8ClampedArray(
      dst.data.buffer as ArrayBuffer,
      dst.data.byteOffset,
      dst.data.byteLength,
    );
    const warpedImageData = new ImageData(pixelData, outputSize.width, outputSize.height);
    const canvas = document.createElement('canvas');
    canvas.width = outputSize.width;
    canvas.height = outputSize.height;
    const warpedContext = canvas.getContext('2d');
    try {
      if (!warpedContext) throw new Error('Warp output context unavailable');
      warpedContext.imageSmoothingEnabled = true;
      warpedContext.imageSmoothingQuality = 'high';
      warpedContext.putImageData(warpedImageData, 0, 0);
      return canvas;
    } catch (error) {
      disposeCanvas(canvas);
      throw error;
    }
  } finally {
    dst?.delete();
    matrix?.delete();
    src?.delete();
  }
};

export async function runCropQc(args: {
  cv: OpenCvRuntime;
  eosinDataUrl: string;
  heDataUrl: string;
  chipBounds: PreprocessRect;
  acceptedChipQuad?: HeFocusAutoProposalQuad | null;
  acceptedChipBounds?: PreprocessRect | null;
  coarseChipBounds?: PreprocessRect | null;
  imageTransform: LocalizationImageTransform;
  affineMatrix: AlignmentAffineMatrix;
  alignmentAccepted?: boolean;
  solveAccepted?: boolean;
  controlPoints?: AlignmentControlPoint[];
  inlierMask?: boolean[] | null;
}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('runCropQc() is browser-only and must be run in a browser environment');
  }

  const trackedCanvases = new Set<HTMLCanvasElement>();
  const trackCanvas = (canvas: HTMLCanvasElement) => {
    trackedCanvases.add(canvas);
    return canvas;
  };
  const releaseTrackedCanvas = (
    canvas: HTMLCanvasElement,
    protectedCanvases: readonly HTMLCanvasElement[],
  ) => {
    if (!protectedCanvases.includes(canvas)) {
      disposeCanvas(canvas);
      trackedCanvases.delete(canvas);
    }
  };
  try {
    const eosin = await runAsyncCropQcStage(
      'load-reference-image',
      { encodedBytes: args.eosinDataUrl.length },
      () => imageToCanvas(args.eosinDataUrl),
    );
    trackCanvas(eosin.canvas);
    const he = await runAsyncCropQcStage(
      'load-moving-image',
      { encodedBytes: args.heDataUrl.length },
      () => imageToCanvas(args.heDataUrl),
    );
    trackCanvas(he.canvas);

    const normalized = runCropQcStage(
      'resolve-crop-bounds',
      {
        referenceSize: { width: eosin.width, height: eosin.height },
        chipBounds: args.chipBounds,
        acceptedChipBounds: args.acceptedChipBounds,
        hasAcceptedChipQuad: Boolean(args.acceptedChipQuad),
        solveAccepted: args.solveAccepted,
        alignmentAccepted: args.alignmentAccepted,
      },
      () => resolveCropBounds({
        chipBounds: args.chipBounds,
        acceptedChipQuad: args.acceptedChipQuad,
        acceptedChipBounds: args.acceptedChipBounds,
        coarseChipBounds: args.coarseChipBounds,
        referenceSize: { width: eosin.width, height: eosin.height },
        alignmentAccepted: args.alignmentAccepted,
        solveAccepted: args.solveAccepted,
      }),
    );
    const fullReferencePixelRect = { x: 0, y: 0, width: eosin.width, height: eosin.height };
    const heFullresSize = runCropQcStage(
      'calculate-output-size',
      {
        referenceSize: { width: eosin.width, height: eosin.height },
        movingSize: { width: he.width, height: he.height },
        affineMatrix: args.affineMatrix,
      },
      () => getOriginalDensityCropSize(fullReferencePixelRect, args.affineMatrix),
    );

    // CanvasStage stores capture bounds in the fixed, canvas-axis coordinate system.
    // Rotating those bounds again would move Registration Review to a different region.
    const orientedFullresReferenceSize = heFullresSize;
    const orientedCropBounds = normalizeRectForSize(normalized.rect, heFullresSize);
    const fullFrameOutputPixels = heFullresSize.width * heFullresSize.height;
    const useRoiFirstWarp = fullFrameOutputPixels > FULL_FRAME_WARP_MAX_PIXELS
      && isRightAngleImageOrientation(args.imageTransform);
    const sourceRoiPixelRect = inverseTransformPixelRect(
      orientedCropBounds.pixelRect,
      args.imageTransform,
      heFullresSize,
      orientedFullresReferenceSize,
    );
    const roundedSourceRoiPixelRect = {
      x: Math.round(sourceRoiPixelRect.x),
      y: Math.round(sourceRoiPixelRect.y),
      width: Math.max(1, Math.round(sourceRoiPixelRect.width)),
      height: Math.max(1, Math.round(sourceRoiPixelRect.height)),
    };
    const fullresToReferenceScale = {
      x: eosin.width / heFullresSize.width,
      y: eosin.height / heFullresSize.height,
    };
    const warpReferencePixelRect = useRoiFirstWarp
      ? {
        x: Math.round(roundedSourceRoiPixelRect.x * fullresToReferenceScale.x),
        y: Math.round(roundedSourceRoiPixelRect.y * fullresToReferenceScale.y),
        width: Math.max(
          1,
          Math.round(roundedSourceRoiPixelRect.width * fullresToReferenceScale.x),
        ),
        height: Math.max(
          1,
          Math.round(roundedSourceRoiPixelRect.height * fullresToReferenceScale.y),
        ),
      }
      : fullReferencePixelRect;
    const warpOutputSize = useRoiFirstWarp
      ? {
        width: roundedSourceRoiPixelRect.width,
        height: roundedSourceRoiPixelRect.height,
      }
      : heFullresSize;
    const referenceInputFrame = useRoiFirstWarp
      ? trackCanvas(runCropQcStage(
        'crop-reference-image',
        {
          inputSize: { width: eosin.width, height: eosin.height },
          cropPixelRect: warpReferencePixelRect,
          strategy: 'roi-first',
        },
        () => cropCanvas(
          eosin.canvas,
          { width: eosin.width, height: eosin.height },
          warpReferencePixelRect,
        ),
      ))
      : eosin.canvas;
    const referenceFullresFrame = trackCanvas(runCropQcStage(
      'prepare-reference-frame',
      {
        referenceSize: {
          width: referenceInputFrame.width,
          height: referenceInputFrame.height,
        },
        outputSize: warpOutputSize,
        strategy: useRoiFirstWarp ? 'roi-first' : 'full-frame',
      },
      () => (
        warpOutputSize.width === referenceInputFrame.width
          && warpOutputSize.height === referenceInputFrame.height
          ? referenceInputFrame
          : drawCanvas(referenceInputFrame, warpOutputSize)
      ),
    ));
    const orientedEosinFullFrame = trackCanvas(runCropQcStage(
      'orient-reference-frame',
      {
        inputSize: { width: referenceFullresFrame.width, height: referenceFullresFrame.height },
        imageTransform: args.imageTransform,
      },
      () => drawCanvasWithImageOrientation(
        referenceFullresFrame,
        args.imageTransform,
        useRoiFirstWarp
          ? getOrientedCropSize(referenceFullresFrame, args.imageTransform)
          : orientedFullresReferenceSize,
      ),
    ));
    releaseTrackedCanvas(referenceFullresFrame, [
      eosin.canvas,
      orientedEosinFullFrame,
    ]);
    releaseTrackedCanvas(referenceInputFrame, [
      eosin.canvas,
      orientedEosinFullFrame,
    ]);
    const heCrop = trackCanvas(runCropQcStage(
      'warp-moving-image',
      {
        referenceSize: { width: eosin.width, height: eosin.height },
        movingSize: { width: he.width, height: he.height },
        outputSize: warpOutputSize,
        outputPixels: warpOutputSize.width * warpOutputSize.height,
        fullFrameOutputSize: heFullresSize,
        fullFrameOutputPixels,
        strategy: useRoiFirstWarp ? 'roi-first' : 'full-frame',
        affineMatrix: args.affineMatrix,
      },
      () => makeWarpedHeCrop(
        args.cv,
        he.canvas,
        args.affineMatrix,
        warpReferencePixelRect,
        warpOutputSize,
      ),
    ));
    const orientedHeFullFrame = trackCanvas(runCropQcStage(
      'orient-moving-frame',
      {
        inputSize: { width: heCrop.width, height: heCrop.height },
        imageTransform: args.imageTransform,
      },
      () => drawCanvasWithImageOrientation(
        heCrop,
        args.imageTransform,
        useRoiFirstWarp
          ? getOrientedCropSize(heCrop, args.imageTransform)
          : orientedFullresReferenceSize,
      ),
    ));
    releaseTrackedCanvas(heCrop, [he.canvas, orientedHeFullFrame]);
    const orientedEosinFrame = useRoiFirstWarp
      ? orientedEosinFullFrame
      : trackCanvas(runCropQcStage(
        'crop-reference-image',
        {
          inputSize: { width: orientedEosinFullFrame.width, height: orientedEosinFullFrame.height },
          cropPixelRect: orientedCropBounds.pixelRect,
          strategy: 'full-frame',
        },
        () => cropCanvas(
          orientedEosinFullFrame,
          { width: orientedEosinFullFrame.width, height: orientedEosinFullFrame.height },
          orientedCropBounds.pixelRect,
        ),
      ));
    const orientedHeCrop = useRoiFirstWarp
      ? orientedHeFullFrame
      : trackCanvas(runCropQcStage(
        'crop-moving-image',
        {
          inputSize: { width: orientedHeFullFrame.width, height: orientedHeFullFrame.height },
          cropPixelRect: orientedCropBounds.pixelRect,
          strategy: 'full-frame',
        },
        () => cropCanvas(
          orientedHeFullFrame,
          { width: orientedHeFullFrame.width, height: orientedHeFullFrame.height },
          orientedCropBounds.pixelRect,
        ),
      ));
    if (!useRoiFirstWarp) {
      releaseTrackedCanvas(orientedEosinFullFrame, [
        eosin.canvas,
        orientedEosinFrame,
      ]);
      releaseTrackedCanvas(orientedHeFullFrame, [
        he.canvas,
        orientedHeCrop,
      ]);
    }
    const qcPreviewSize = getResizeDownOnlyDimensions(
      { width: orientedEosinFrame.width, height: orientedEosinFrame.height },
      HIRES_MAX_SIDE,
    );
    const eosinQcPreviewFrame = qcPreviewSize.width === orientedEosinFrame.width
      && qcPreviewSize.height === orientedEosinFrame.height
      ? orientedEosinFrame
      : trackCanvas(drawCanvas(orientedEosinFrame, qcPreviewSize));
    const heQcPreviewFrame = qcPreviewSize.width === orientedHeCrop.width
      && qcPreviewSize.height === orientedHeCrop.height
      ? orientedHeCrop
      : trackCanvas(drawCanvas(orientedHeCrop, qcPreviewSize));
    const useAcceptedFeatureMatchesPreview = args.solveAccepted ?? args.alignmentAccepted ?? true;

    const { eosinReferenceGeometry, heQcGeometry } = runCropQcStage(
      'calculate-qc-geometry',
      {
        referenceSize: { width: eosin.width, height: eosin.height },
        movingSize: { width: he.width, height: he.height },
        cropPixelRect: orientedCropBounds.pixelRect,
      },
      () => {
        const eosinReferenceGeometry = toCanonicalCropQcGeometry(orientedCropBounds);
        const orientedHeFullFrameGeometry = orientCropLocalGeometry(
          resolveHeQcGeometry({
            acceptedChipQuad: args.acceptedChipQuad,
            acceptedChipBounds: args.acceptedChipBounds,
            movingSize: { width: he.width, height: he.height },
            affineMatrix: args.affineMatrix,
            cropPixelRect: { x: 0, y: 0, width: eosin.width, height: eosin.height },
          }),
          args.imageTransform,
          heFullresSize,
          orientedFullresReferenceSize,
        );
        const heQcGeometry = orientedHeFullFrameGeometry
          ? toCropLocalGeometry(
            toRectCornerPoints(
              orientedHeFullFrameGeometry.rect,
              orientedFullresReferenceSize,
            ).map((point) => toCropLocalPoint(point, orientedCropBounds.pixelRect)),
            { width: orientedHeCrop.width, height: orientedHeCrop.height },
          )
          : null;
        return { eosinReferenceGeometry, heQcGeometry };
      },
    );
    const eosinAssetSet = runCropQcStage(
      'encode-reference-assets',
      { cropSize: { width: orientedEosinFrame.width, height: orientedEosinFrame.height } },
      () => buildCanonicalAssetSet(orientedEosinFrame),
    );
    const heAssetSet = runCropQcStage(
      'encode-moving-assets',
      { cropSize: { width: orientedHeCrop.width, height: orientedHeCrop.height } },
      () => buildCanonicalAssetSet(orientedHeCrop),
    );
    const cropAssets = {
      eosin: eosinAssetSet.assets,
      he: heAssetSet.assets,
    };

    const checkerboardDataUrl = runCropQcStage(
      'generate-checkerboard-preview',
      {
        cropSize: { width: orientedHeCrop.width, height: orientedHeCrop.height },
        previewSize: qcPreviewSize,
      },
      () => makeCheckerboard(eosinQcPreviewFrame, heQcPreviewFrame),
    );
    const featureMatchesDataUrl = runCropQcStage(
      'generate-feature-matches-preview',
      {
        controlPointCount: args.controlPoints?.length ?? 0,
        inlierCount: args.inlierMask?.filter(Boolean).length ?? null,
        cropPixelRect: orientedCropBounds.pixelRect,
      },
      () => makeFeatureMatchesPreview({
        alignmentAccepted: useAcceptedFeatureMatchesPreview,
        eosinFull: eosin.canvas,
        eosinCrop: eosinQcPreviewFrame,
        heFull: he.canvas,
        heCrop: heQcPreviewFrame,
        pixelRect: orientedCropBounds.pixelRect,
        referenceSize: { width: eosin.width, height: eosin.height },
        fullresReferenceSize: heFullresSize,
        orientedFullresReferenceSize,
        movingSize: { width: he.width, height: he.height },
        affineMatrix: args.affineMatrix,
        controlPoints: args.controlPoints ?? [],
        inlierMask: args.inlierMask ?? null,
        imageTransform: args.imageTransform,
      }),
    );
    releaseTrackedCanvas(eosinQcPreviewFrame, [
      eosin.canvas,
      orientedEosinFrame,
    ]);
    releaseTrackedCanvas(heQcPreviewFrame, [
      he.canvas,
      orientedHeCrop,
    ]);
    const checkerboardPreview = {
      dataUrl: checkerboardDataUrl,
    };
    const featureMatchesPreview = {
      dataUrl: featureMatchesDataUrl,
    };
    const fullresSize = heAssetSet.sizes.fullres;
    const { tissue_hires_scalef, tissue_lowres_scalef } = runCropQcStage(
      'finalize-result',
      { fullresSize },
      () => ({
        tissue_hires_scalef: getScaleFactor(heAssetSet.sizes.hires, fullresSize),
        tissue_lowres_scalef: getScaleFactor(heAssetSet.sizes.lowres, fullresSize),
      }),
    );
    // Exact spot square side length depends on chip projection inputs that are not available in Crop/QC yet.
    // Leave it pending here so chip projection can perform the first authoritative write.
    const spot_diameter_fullres = null;

    return {
      eosinReferenceGeometry,
      heQcGeometry,
      cropRect: eosinReferenceGeometry.rect,
      cropWidth: fullresSize.width,
      cropHeight: fullresSize.height,
      cropAssets,
      tissue_hires_scalef,
      tissue_lowres_scalef,
      spot_diameter_fullres,
      fiducial_diameter_fullres: FIDUCIAL_DIAMETER_FULLRES,
      checkerboardPreview,
      featureMatchesPreview,
      eosinCropDataUrl: cropAssets.eosin.fullres.dataUrl,
      heWarpedCropDataUrl: cropAssets.he.fullres.dataUrl,
      checkerboardDataUrl,
      featureMatchesDataUrl,
    } satisfies CropQcResult;
  } finally {
    for (const canvas of trackedCanvases) {
      disposeCanvas(canvas);
    }
  }
}
