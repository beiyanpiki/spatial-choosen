'use client';

import * as UTIF from 'utif';
import type { PreprocessImageKind, PreprocessSourceImage } from '@/types/preprocess';
import { PREPROCESS_NUMERIC_DEFAULTS } from './constants';
import { checkSourceImageFileSize } from './safety';

type DecodedSourceImage = {
  height: number;
  mimeType: string;
  sourceBlob: Blob;
  sourceUrl: string;
  thumbnailBlob?: Blob;
  workingBlob?: Blob;
  width: number;
};

const TIFF_FILE_NAME = /\.(tif|tiff)$/i;
const TIFF_MIME_TYPES = new Set(['image/tif', 'image/tiff', 'application/tiff']);

const loadImageElement = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new window.Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Image preview could not be decoded'));
  image.src = src;
});

const canvasToBlob = (canvas: HTMLCanvasElement, mimeType = 'image/png') => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) {
      resolve(blob);
      return;
    }
    reject(new Error('Canvas export failed'));
  }, mimeType);
});

const disposeCanvas = (canvas: HTMLCanvasElement) => {
  canvas.width = 0;
  canvas.height = 0;
};

const getDownsampledDimensions = (sourceWidth: number, sourceHeight: number, maxEdge: number) => {
  const longestEdge = Math.max(sourceWidth, sourceHeight);
  const scale = longestEdge > 0 ? Math.min(1, maxEdge / longestEdge) : 1;

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
};

const createDownsampledBlobFromSource = async (
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number = PREPROCESS_NUMERIC_DEFAULTS.thumbnailMaxDimension,
) => {
  const dimensions = getDownsampledDimensions(sourceWidth, sourceHeight, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;

  try {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context unavailable for image downsampling');
    }

    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas, 'image/png');
  } finally {
    disposeCanvas(canvas);
  }
};

const createThumbnailBlob = async (src: string, maxEdge: number = PREPROCESS_NUMERIC_DEFAULTS.thumbnailMaxDimension) => {
  const image = await loadImageElement(src);
  const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longestEdge > 0 ? Math.min(1, maxEdge / longestEdge) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext('2d');
  try {
    if (!context) {
      throw new Error('Canvas 2D context unavailable for image thumbnail creation');
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas, 'image/png');
  } finally {
    disposeCanvas(canvas);
  }
};

const isTiffFile = (file: File) => TIFF_MIME_TYPES.has(file.type.toLowerCase()) || TIFF_FILE_NAME.test(file.name);

const decodeBrowserNativeImage = async (file: File): Promise<DecodedSourceImage> => {
  const sourceBlob = file;
  const sourceUrl = URL.createObjectURL(sourceBlob);
  let image: HTMLImageElement;
  try {
    image = await loadImageElement(sourceUrl);
  } catch (error) {
    URL.revokeObjectURL(sourceUrl);
    throw error;
  }

  const [thumbnailBlob, workingBlob] = await Promise.all([
    createDownsampledBlobFromSource(
      image,
      image.naturalWidth,
      image.naturalHeight,
      PREPROCESS_NUMERIC_DEFAULTS.thumbnailMaxDimension,
    ),
    createDownsampledBlobFromSource(
      image,
      image.naturalWidth,
      image.naturalHeight,
      PREPROCESS_NUMERIC_DEFAULTS.workingMaxDimension,
    ),
  ]);

  return {
    height: image.naturalHeight,
    mimeType: file.type || 'application/octet-stream',
    sourceBlob,
    sourceUrl,
    thumbnailBlob,
    workingBlob,
    width: image.naturalWidth,
  };
};

const decodeTiffImage = async (file: File): Promise<DecodedSourceImage> => {
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  const ifd = ifds.find((entry) => Array.isArray(entry.t256) && Array.isArray(entry.t257)) ?? ifds[0];

  if (!ifd) {
    throw new Error('TIFF image could not be decoded');
  }

  UTIF.decodeImage(buffer, ifd);

  const width = typeof ifd.width === 'number' ? ifd.width : Array.isArray(ifd.t256) ? Number(ifd.t256[0]) : 0;
  const height = typeof ifd.height === 'number' ? ifd.height : Array.isArray(ifd.t257) ? Number(ifd.t257[0]) : 0;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('TIFF image dimensions are invalid');
  }

  const rgba = UTIF.toRGBA8(ifd);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context unavailable for TIFF decoding');
  }

  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  try {
    const [sourceBlob, thumbnailBlob, workingBlob] = await Promise.all([
      canvasToBlob(canvas, 'image/png'),
      createDownsampledBlobFromSource(canvas, width, height, PREPROCESS_NUMERIC_DEFAULTS.thumbnailMaxDimension),
      createDownsampledBlobFromSource(canvas, width, height, PREPROCESS_NUMERIC_DEFAULTS.workingMaxDimension),
    ]);

    return {
      height,
      mimeType: 'image/png',
      sourceBlob,
      sourceUrl: URL.createObjectURL(sourceBlob),
      thumbnailBlob,
      workingBlob,
      width,
    };
  } finally {
    disposeCanvas(canvas);
  }
};

export async function buildSourceImage(file: File, kind: PreprocessImageKind): Promise<PreprocessSourceImage> {
  const sizeCheck = checkSourceImageFileSize(file.size);
  if (!sizeCheck.ok) {
    throw new Error(sizeCheck.reason ?? 'Image exceeds preprocess size limits');
  }

  const decoded = isTiffFile(file)
    ? await decodeTiffImage(file)
    : await decodeBrowserNativeImage(file);
  const [thumbnailBlob, workingBlob] = await Promise.all([
    decoded.thumbnailBlob ?? createThumbnailBlob(decoded.sourceUrl),
    decoded.workingBlob ?? createThumbnailBlob(decoded.sourceUrl, PREPROCESS_NUMERIC_DEFAULTS.workingMaxDimension),
  ]);
  const thumbnailObjectUrl = URL.createObjectURL(thumbnailBlob);
  const workingObjectUrl = URL.createObjectURL(workingBlob);
  const workingDimensions = getDownsampledDimensions(
    decoded.width,
    decoded.height,
    PREPROCESS_NUMERIC_DEFAULTS.workingMaxDimension,
  );

  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    kind,
    fileName: file.name,
    mimeType: decoded.mimeType,
    sizeBytes: file.size,
    width: decoded.width,
    height: decoded.height,
    lastModified: file.lastModified || null,
    sourceBlob: decoded.sourceBlob,
    thumbnailBlob,
    workingBlob,
    objectUrl: decoded.sourceUrl,
    thumbnailObjectUrl,
    workingObjectUrl,
    dataUrl: decoded.sourceUrl,
    thumbnailDataUrl: thumbnailObjectUrl,
    workingDataUrl: workingObjectUrl,
    workingWidth: workingDimensions.width,
    workingHeight: workingDimensions.height,
  };
}

export { createDownsampledBlobFromSource, createThumbnailBlob, isTiffFile, loadImageElement };
