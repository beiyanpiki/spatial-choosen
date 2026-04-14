import type {
  AlignmentAffineMatrix,
  AlignmentControlPoint,
  CropQcCanonicalAsset,
  CropQcCanonicalAssetSet,
  LocalizationImageTransform,
  PreprocessRect,
} from '@/types/preprocess';
import type { CvMat, OpenCvRuntime } from './loadOpenCv';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type Size = { width: number; height: number };
type PixelRect = { x: number; y: number; width: number; height: number };
type PixelPoint = { x: number; y: number };

const disposeCanvas = (canvas: HTMLCanvasElement) => {
  canvas.width = 0;
  canvas.height = 0;
};

export type CropQcResult = {
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

const cropCanvas = (
  source: CanvasImageSource,
  pixelRect: PixelRect,
) => {
  const canvas = document.createElement('canvas');
  canvas.width = pixelRect.width;
  canvas.height = pixelRect.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Crop canvas context unavailable');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    pixelRect.x,
    pixelRect.y,
    pixelRect.width,
    pixelRect.height,
    0,
    0,
    pixelRect.width,
    pixelRect.height,
  );
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
  const minX = clamp(chipBounds.x, 0, 1);
  const maxX = clamp(chipBounds.x + chipBounds.width, 0, 1);
  const minY = clamp(chipBounds.y, 0, 1);
  const maxY = clamp(chipBounds.y + chipBounds.height, 0, 1);

  const widthNorm = Math.max(1 / Math.max(1, imageSize.width), maxX - minX);
  const heightNorm = Math.max(1 / Math.max(1, imageSize.height), maxY - minY);

  const pxX = clamp(Math.round(minX * imageSize.width), 0, Math.max(0, imageSize.width - 1));
  const pxY = clamp(Math.round(minY * imageSize.height), 0, Math.max(0, imageSize.height - 1));
  const pxWidth = Math.max(1, Math.round(widthNorm * imageSize.width));
  const pxHeight = Math.max(1, Math.round(heightNorm * imageSize.height));

  return {
    rect: {
      x: minX,
      y: minY,
      width: widthNorm,
      height: heightNorm,
    },
    pixelRect: {
      x: pxX,
      y: pxY,
      width: Math.min(pxWidth, imageSize.width - pxX),
      height: Math.min(pxHeight, imageSize.height - pxY),
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

const applyAffineToPoint = (
  point: PixelPoint,
  affineMatrix: AlignmentAffineMatrix,
): PixelPoint => ({
  x: affineMatrix[0] * point.x + affineMatrix[1] * point.y + affineMatrix[2],
  y: affineMatrix[3] * point.x + affineMatrix[4] * point.y + affineMatrix[5],
});

const toCropLocalPoint = (point: PixelPoint, pixelRect: PixelRect): PixelPoint => ({
  x: point.x - pixelRect.x,
  y: point.y - pixelRect.y,
});

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
  let drawableIndex = 0;

  for (const candidate of candidates) {
    const referencePoint = toPixelPoint(candidate.source, args.referenceSize);
    const movingPoint = toPixelPoint(candidate.target, args.movingSize);
    const warpedMovingPoint = args.alignmentAccepted
      ? applyAffineToPoint(movingPoint, args.affineMatrix)
      : movingPoint;

    const leftPoint = args.alignmentAccepted
      ? toCropLocalPoint(referencePoint, args.pixelRect)
      : referencePoint;
    const rightLocalPoint = args.alignmentAccepted
      ? toCropLocalPoint(warpedMovingPoint, args.pixelRect)
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
) => {
  const context = heCanvas.getContext('2d');
  if (!context) throw new Error('HE canvas context unavailable');
  const imageData = context.getImageData(0, 0, heCanvas.width, heCanvas.height);

  let src: CvMat | null = null;
  let matrix: CvMat | null = null;
  let dst: CvMat | null = null;
  try {
    src = cv.matFromImageData(imageData);
    matrix = cv.matFromArray(2, 3, cv.CV_64F, [
      affineMatrix[0],
      affineMatrix[1],
      affineMatrix[2] - pixelRect.x,
      affineMatrix[3],
      affineMatrix[4],
      affineMatrix[5] - pixelRect.y,
    ]);
    dst = new cv.Mat();
    const size = new cv.Size(pixelRect.width, pixelRect.height);
    const fill = new cv.Scalar(0, 0, 0, 255);

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
    const warpedImageData = new ImageData(pixelData, pixelRect.width, pixelRect.height);
    const canvas = document.createElement('canvas');
    canvas.width = pixelRect.width;
    canvas.height = pixelRect.height;
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
  imageTransform: LocalizationImageTransform;
  affineMatrix: AlignmentAffineMatrix;
  alignmentAccepted?: boolean;
  solveAccepted?: boolean;
  controlPoints?: AlignmentControlPoint[];
  inlierMask?: boolean[] | null;
}) {
  const eosin = await imageToCanvas(args.eosinDataUrl);
  const he = await imageToCanvas(args.heDataUrl);

  const normalized = normalizeRect(args.chipBounds, { width: eosin.width, height: eosin.height });

  const eosinCrop = cropCanvas(eosin.canvas, normalized.pixelRect);
  const heCrop = makeWarpedHeCrop(args.cv, he.canvas, args.affineMatrix, normalized.pixelRect);
  const useAcceptedFeatureMatchesPreview = args.solveAccepted ?? args.alignmentAccepted ?? true;

  try {
    const eosinAssetSet = buildCanonicalAssetSet(eosinCrop);
    const heAssetSet = buildCanonicalAssetSet(heCrop);
    const cropAssets = {
      eosin: eosinAssetSet.assets,
      he: heAssetSet.assets,
    };

    const checkerboardDataUrl = makeCheckerboard(eosinCrop, heCrop);
    const featureMatchesDataUrl = makeFeatureMatchesPreview({
      alignmentAccepted: useAcceptedFeatureMatchesPreview,
      eosinFull: eosin.canvas,
      eosinCrop,
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
      cropRect: normalized.rect,
      cropWidth: normalized.pixelRect.width,
      cropHeight: normalized.pixelRect.height,
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
    disposeCanvas(heCrop);
  }
}
