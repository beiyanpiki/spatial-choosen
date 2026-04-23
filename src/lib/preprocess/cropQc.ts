import type {
  AlignmentAffineMatrix,
  AlignmentControlPoint,
  CanonicalCropQcGeometry,
  CropQcCanonicalAsset,
  CropQcCanonicalAssetSet,
  HeFocusAutoProposalQuad,
  LocalizationImageTransform,
  PreprocessRect,
} from '@/types/preprocess';
import type { CvMat, OpenCvRuntime } from './loadOpenCv';
import { LOCALIZATION_MIN_BOX_SIZE } from './localization';

type Size = { width: number; height: number };
type PixelRect = { x: number; y: number; width: number; height: number };
type PixelPoint = { x: number; y: number };

export type CropQcBlockedReason = 'missing-accepted-transform' | 'missing-accepted-chip-bounds';

export class CropQcBlockedError extends Error {
  readonly code: CropQcBlockedReason;

  constructor(code: CropQcBlockedReason, message?: string) {
    super(message ?? (code === 'missing-accepted-transform'
      ? 'Crop/QC is blocked until an accepted alignment transform is available.'
      : 'Crop/QC is blocked until canonical accepted chip geometry is available.'));
    this.name = 'CropQcBlockedError';
    this.code = code;
  }
}

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
  if (!context) throw new Error('Canvas context unavailable');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
};

const fillCanvasWhite = (context: CanvasRenderingContext2D, size: Size) => {
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
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

  const assets = {
    fullres: toCanonicalAsset(fullresCanvas),
    hires: toCanonicalAsset(hiresCanvas),
    lowres: toCanonicalAsset(lowresCanvas),
  } satisfies CropQcCanonicalAssetSet;

  if (hiresCanvas !== fullresCanvas) {
    disposeCanvas(hiresCanvas);
  }
  if (lowresCanvas !== fullresCanvas && lowresCanvas !== hiresCanvas) {
    disposeCanvas(lowresCanvas);
  }

  return {
    assets,
    sizes: {
      fullres: fullresSize,
      hires: hiresSize,
      lowres: lowresSize,
    },
  };
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
  if (!context) throw new Error('Canvas context unavailable');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0);
  return { canvas, context, width: image.naturalWidth, height: image.naturalHeight };
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

  const dataUrl = checker.toDataURL('image/png');
  disposeCanvas(checker);
  return dataUrl;
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
  movingSize: Size;
  affineMatrix: AlignmentAffineMatrix;
  controlPoints: AlignmentControlPoint[];
  inlierMask: boolean[] | null;
}) => {
  const leftCanvas = args.alignmentAccepted ? args.eosinCrop : args.eosinFull;
  const rightCanvas = args.alignmentAccepted ? args.heCrop : args.heFull;
  const preview = document.createElement('canvas');
  preview.width = leftCanvas.width + rightCanvas.width + FEATURE_MATCHES_GAP;
  preview.height = Math.max(leftCanvas.height, rightCanvas.height);
  const context = preview.getContext('2d');
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
  let drawableIndex = 0;

  for (const candidate of candidates) {
    const referencePoint = toPixelPoint(candidate.source, args.referenceSize);
    const movingPoint = toPixelPoint(candidate.target, args.movingSize);
    const warpedMovingPoint = args.alignmentAccepted
      ? applyAffineToPoint(movingPoint, args.affineMatrix)
      : movingPoint;

    const leftPoint = args.alignmentAccepted
      ? {
        x: toCropLocalPoint(referencePoint, args.pixelRect).x * acceptedScale.x,
        y: toCropLocalPoint(referencePoint, args.pixelRect).y * acceptedScale.y,
      }
      : referencePoint;
    const rightLocalPoint = args.alignmentAccepted
      ? {
        x: toCropLocalPoint(warpedMovingPoint, args.pixelRect).x * acceptedScale.x,
        y: toCropLocalPoint(warpedMovingPoint, args.pixelRect).y * acceptedScale.y,
      }
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

  const dataUrl = preview.toDataURL('image/png');
  disposeCanvas(preview);
  return dataUrl;
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

    const pixelData = new Uint8ClampedArray(dst.data);
    const warpedImageData = new ImageData(pixelData, outputSize.width, outputSize.height);
    const canvas = document.createElement('canvas');
    canvas.width = outputSize.width;
    canvas.height = outputSize.height;
    const warpedContext = canvas.getContext('2d');
    if (!warpedContext) throw new Error('Warp output context unavailable');
    warpedContext.imageSmoothingEnabled = true;
    warpedContext.imageSmoothingQuality = 'high';
    warpedContext.putImageData(warpedImageData, 0, 0);
    return canvas;
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
  const eosin = await imageToCanvas(args.eosinDataUrl);
  const he = await imageToCanvas(args.heDataUrl);

  const normalized = resolveCropBounds({
    chipBounds: args.chipBounds,
    acceptedChipQuad: args.acceptedChipQuad,
    acceptedChipBounds: args.acceptedChipBounds,
    coarseChipBounds: args.coarseChipBounds,
    referenceSize: { width: eosin.width, height: eosin.height },
    alignmentAccepted: args.alignmentAccepted,
    solveAccepted: args.solveAccepted,
  });
  const heFullresSize = getOriginalDensityCropSize(normalized.pixelRect, args.affineMatrix);

  const eosinCrop = cropCanvas(
    eosin.canvas,
    { width: eosin.width, height: eosin.height },
    normalized.pixelRect,
  );
  const eosinFrame = heFullresSize.width === eosinCrop.width && heFullresSize.height === eosinCrop.height
    ? eosinCrop
    : drawCanvas(eosinCrop, heFullresSize);
  const heCrop = makeWarpedHeCrop(
    args.cv,
    he.canvas,
    args.affineMatrix,
    normalized.pixelRect,
    heFullresSize,
  );
  const useAcceptedFeatureMatchesPreview = args.solveAccepted ?? args.alignmentAccepted ?? true;

  try {
    const eosinReferenceGeometry = toCanonicalCropQcGeometry(normalized);
    const heQcGeometry = resolveHeQcGeometry({
      acceptedChipQuad: args.acceptedChipQuad,
      acceptedChipBounds: args.acceptedChipBounds,
      movingSize: { width: he.width, height: he.height },
      affineMatrix: args.affineMatrix,
      cropPixelRect: normalized.pixelRect,
    });
    const eosinAssetSet = buildCanonicalAssetSet(eosinFrame);
    const heAssetSet = buildCanonicalAssetSet(heCrop);
    const cropAssets = {
      eosin: eosinAssetSet.assets,
      he: heAssetSet.assets,
    };

    const checkerboardDataUrl = makeCheckerboard(eosinFrame, heCrop);
    const featureMatchesDataUrl = makeFeatureMatchesPreview({
      alignmentAccepted: useAcceptedFeatureMatchesPreview,
      eosinFull: eosin.canvas,
      eosinCrop: eosinFrame,
      heFull: he.canvas,
      heCrop,
      pixelRect: normalized.pixelRect,
      referenceSize: { width: eosin.width, height: eosin.height },
      movingSize: { width: he.width, height: he.height },
      affineMatrix: args.affineMatrix,
      controlPoints: args.controlPoints ?? [],
      inlierMask: args.inlierMask ?? null,
    });
    const checkerboardPreview = {
      dataUrl: checkerboardDataUrl,
    };
    const featureMatchesPreview = {
      dataUrl: featureMatchesDataUrl,
    };
    const fullresSize = heAssetSet.sizes.fullres;
    const tissue_hires_scalef = getScaleFactor(heAssetSet.sizes.hires, fullresSize);
    const tissue_lowres_scalef = getScaleFactor(heAssetSet.sizes.lowres, fullresSize);
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
    disposeCanvas(eosin.canvas);
    disposeCanvas(he.canvas);
    disposeCanvas(eosinCrop);
    if (eosinFrame !== eosinCrop) {
      disposeCanvas(eosinFrame);
    }
    disposeCanvas(heCrop);
  }
}
