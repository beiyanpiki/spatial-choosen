import { getTransformedRectCorners } from '@/lib/preprocess/imageTransforms';
import type { AlignmentAffineMatrix, LocalizationImageTransform, PreprocessRect } from '@/types/preprocess';
import type { CvMat, OpenCvRuntime } from './loadOpenCv';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type Size = { width: number; height: number };

export type CropQcResult = {
  cropRect: PreprocessRect;
  cropWidth: number;
  cropHeight: number;
  eosinCropDataUrl: string;
  heWarpedCropDataUrl: string;
  checkerboardDataUrl: string;
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
  transform: LocalizationImageTransform,
  imageSize: Size,
): { rect: PreprocessRect; pixelRect: { x: number; y: number; width: number; height: number } } => {
  const corners = getTransformedRectCorners(chipBounds, transform);
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);

  const minX = clamp(Math.min(...xs), 0, 1);
  const maxX = clamp(Math.max(...xs), 0, 1);
  const minY = clamp(Math.min(...ys), 0, 1);
  const maxY = clamp(Math.max(...ys), 0, 1);

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

  return checker.toDataURL('image/png');
};

const makeWarpedHe = (
  cv: OpenCvRuntime,
  heCanvas: HTMLCanvasElement,
  affineMatrix: AlignmentAffineMatrix,
  referenceSize: Size,
) => {
  const context = heCanvas.getContext('2d');
  if (!context) throw new Error('HE canvas context unavailable');
  const imageData = context.getImageData(0, 0, heCanvas.width, heCanvas.height);

  let src: CvMat | null = null;
  let matrix: CvMat | null = null;
  let dst: CvMat | null = null;
  try {
    src = cv.matFromImageData(imageData);
    matrix = cv.matFromArray(2, 3, cv.CV_64F, affineMatrix);
    dst = new cv.Mat();
    const size = new cv.Size(referenceSize.width, referenceSize.height);
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
    const warpedImageData = new ImageData(pixelData, referenceSize.width, referenceSize.height);
    const canvas = document.createElement('canvas');
    canvas.width = referenceSize.width;
    canvas.height = referenceSize.height;
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
}) {
  const eosin = await imageToCanvas(args.eosinDataUrl);
  const he = await imageToCanvas(args.heDataUrl);

  const normalized = normalizeRect(args.chipBounds, args.imageTransform, { width: eosin.width, height: eosin.height });
  const warpedHeCanvas = makeWarpedHe(args.cv, he.canvas, args.affineMatrix, { width: eosin.width, height: eosin.height });

  const eosinCrop = document.createElement('canvas');
  eosinCrop.width = normalized.pixelRect.width;
  eosinCrop.height = normalized.pixelRect.height;
  const eosinCropCtx = eosinCrop.getContext('2d');
  if (!eosinCropCtx) throw new Error('Eosin crop context unavailable');
  eosinCropCtx.imageSmoothingEnabled = true;
  eosinCropCtx.imageSmoothingQuality = 'high';
  eosinCropCtx.drawImage(
    eosin.canvas,
    normalized.pixelRect.x,
    normalized.pixelRect.y,
    normalized.pixelRect.width,
    normalized.pixelRect.height,
    0,
    0,
    normalized.pixelRect.width,
    normalized.pixelRect.height,
  );

  const heCrop = document.createElement('canvas');
  heCrop.width = normalized.pixelRect.width;
  heCrop.height = normalized.pixelRect.height;
  const heCropCtx = heCrop.getContext('2d');
  if (!heCropCtx) throw new Error('HE crop context unavailable');
  heCropCtx.imageSmoothingEnabled = true;
  heCropCtx.imageSmoothingQuality = 'high';
  heCropCtx.drawImage(
    warpedHeCanvas,
    normalized.pixelRect.x,
    normalized.pixelRect.y,
    normalized.pixelRect.width,
    normalized.pixelRect.height,
    0,
    0,
    normalized.pixelRect.width,
    normalized.pixelRect.height,
  );

  const checkerboardDataUrl = makeCheckerboard(eosinCrop, heCrop);

  return {
    cropRect: normalized.rect,
    cropWidth: normalized.pixelRect.width,
    cropHeight: normalized.pixelRect.height,
    eosinCropDataUrl: eosinCrop.toDataURL('image/png'),
    heWarpedCropDataUrl: heCrop.toDataURL('image/png'),
    checkerboardDataUrl,
  } satisfies CropQcResult;
}
