import type { BatchBounds, BatchImageSize } from '@/types/batch';

export const BATCH_PREVIEW_MAX_DIMENSION = 1600;
export const BATCH_PREVIEW_MIME_TYPE = 'image/jpeg';
export const BATCH_PREVIEW_QUALITY = 0.92;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const readPngSize = (bytes: Uint8Array): BatchImageSize | null => {
  if (bytes.byteLength < 24) return null;
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);

  return width > 0 && height > 0 ? { width, height } : null;
};

const readJpegSize = (bytes: Uint8Array): BatchImageSize | null => {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;

  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];

    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[offset + 5] << 8) + bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) + bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }

    offset += 2 + Math.max(2, length);
  }

  return null;
};

const decodeSize = async (blob: Blob): Promise<BatchImageSize> => {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Unable to decode image'));
      element.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
};

/**
 * Reads pixel dimensions without a full decode when the container allows it.
 *
 * Full-resolution NATA images reach ~6600px, so header parsing keeps import
 * cheap before the (much smaller) preview derivative is built.
 */
export async function readImageSize(blob: Blob): Promise<BatchImageSize> {
  const header = new Uint8Array(await blob.slice(0, 65_536).arrayBuffer());
  const parsed = readPngSize(header) ?? readJpegSize(header);

  return parsed ?? decodeSize(blob);
}

type DecodedSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

const loadBitmapLike = async (blob: Blob): Promise<DecodedSource> => {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Unable to decode image'));
      element.src = url;
    });

    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
};

const canvasToBlob = (canvas: HTMLCanvasElement, mimeType: string, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Unable to encode image preview'))),
      mimeType,
      quality,
    );
  });

export type PreviewDerivative = {
  blob: Blob;
  size: BatchImageSize;
  /** Normalized bounds of the non-white area, or null when nothing was trimmed. */
  contentBounds: { x: number; y: number; width: number; height: number } | null;
};

/** How much darker than the slide background a row/column has to be. */
const BACKGROUND_MARGIN = 12;
/** Extra room kept around the tissue so it does not sit flush against the edge. */
const CONTENT_MARGIN_RATIO = 0.015;

const median = (values: readonly number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

const firstIndexBelow = (means: readonly number[], threshold: number) =>
  means.findIndex((mean) => mean < threshold);

const lastIndexBelow = (means: readonly number[], threshold: number) => {
  for (let index = means.length - 1; index >= 0; index -= 1) {
    if (means[index] < threshold) return index;
  }
  return -1;
};

/**
 * Finds the bounding box of the tissue.
 *
 * NATA crops keep a lot of empty slide around the sample: pale scan background
 * (and, in some packages, a pure-white band where the scan did not reach). Whole
 * rows and columns are therefore judged by their *mean* brightness, so scattered
 * dust does not drag the box open, and anything that is not clearly darker than
 * the background is treated as empty margin.
 */
export function contentBoundsFromPixels(
  data: Uint8ClampedArray | number[],
  width: number,
  height: number,
): BatchBounds | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return null;

  const rowSum = new Float64Array(height);
  const columnSum = new Float64Array(width);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + x * 4;
      const value = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      rowSum[y] += value;
      columnSum[x] += value;
    }
  }

  const rowMeans = Array.from(rowSum, (sum) => sum / width);
  const columnMeans = Array.from(columnSum, (sum) => sum / height);
  const background = median(rowMeans);
  const threshold = background - BACKGROUND_MARGIN;

  const firstRow = firstIndexBelow(rowMeans, threshold);
  const lastRow = lastIndexBelow(rowMeans, threshold);
  const firstColumn = firstIndexBelow(columnMeans, threshold);
  const lastColumn = lastIndexBelow(columnMeans, threshold);

  if (firstRow < 0 || lastRow < 0 || firstColumn < 0 || lastColumn < 0) return null;

  const padX = Math.round(width * CONTENT_MARGIN_RATIO);
  const padY = Math.round(height * CONTENT_MARGIN_RATIO);
  const minX = Math.max(0, firstColumn - padX);
  const minY = Math.max(0, firstRow - padY);
  const maxX = Math.min(width - 1, lastColumn + padX);
  const maxY = Math.min(height - 1, lastRow + padY);

  // Nothing worth trimming when the tissue already fills the frame.
  const coversWidth = (maxX - minX + 1) / width;
  const coversHeight = (maxY - minY + 1) / height;
  if (coversWidth > 0.98 && coversHeight > 0.98) return null;

  return {
    x: minX / width,
    y: minY / height,
    width: (maxX - minX + 1) / width,
    height: (maxY - minY + 1) / height,
  };
}

const computeContentBounds = (context: CanvasRenderingContext2D, width: number, height: number) => {
  let imageData: ImageData;

  try {
    imageData = context.getImageData(0, 0, width, height);
  } catch {
    return null;
  }

  return contentBoundsFromPixels(imageData.data, width, height);
};

/**
 * Builds the downscaled derivative used for interactive canvases.
 *
 * The original blob is kept untouched for export; only the preview is resized,
 * so aligning a 6600px image does not require a 6600px decode per frame.
 */
export async function createPreviewDerivative(
  blob: Blob,
  maxDimension = BATCH_PREVIEW_MAX_DIMENSION,
): Promise<PreviewDerivative> {
  const source = await loadBitmapLike(blob);

  try {
    const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));

    if (scale === 1) {
      return { blob, size: { width, height }, contentBounds: null };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
      return { blob, size: { width: source.width, height: source.height }, contentBounds: null };
    }

    context.drawImage(source.source, 0, 0, width, height);
    const contentBounds = computeContentBounds(context, width, height);
    const previewBlob = await canvasToBlob(canvas, BATCH_PREVIEW_MIME_TYPE, BATCH_PREVIEW_QUALITY);

    return { blob: previewBlob, size: { width, height }, contentBounds };
  } finally {
    source.release();
  }
};
