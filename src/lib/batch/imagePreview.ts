import type { BatchImageSize } from '@/types/batch';

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
      return { blob, size: { width, height } };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
      return { blob, size: { width: source.width, height: source.height } };
    }

    context.drawImage(source.source, 0, 0, width, height);
    const previewBlob = await canvasToBlob(canvas, BATCH_PREVIEW_MIME_TYPE, BATCH_PREVIEW_QUALITY);

    return { blob: previewBlob, size: { width, height } };
  } finally {
    source.release();
  }
};
