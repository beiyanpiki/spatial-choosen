import { PREPROCESS_OVERSIZED_IMAGE_LIMITS } from './constants';

export type OversizedImageCheck = {
  ok: boolean;
  sizeBytes: number;
  reason: string | null;
};

export function checkSourceImageFileSize(sizeBytes: number): OversizedImageCheck {
  if (sizeBytes > PREPROCESS_OVERSIZED_IMAGE_LIMITS.hardBytes) {
    return {
      ok: false,
      sizeBytes,
      reason: `File size ${sizeBytes} bytes exceeds ${PREPROCESS_OVERSIZED_IMAGE_LIMITS.hardBytes} bytes limit`,
    };
  }

  return {
    ok: true,
    sizeBytes,
    reason: null,
  };
}

export type DecodedImageSizeCheck = {
  ok: boolean;
  width: number;
  height: number;
  reason: string | null;
};

/**
 * Pixel-dimension cap on decoded images. A compressed 20000x20000 TIFF can be
 * a few MB on disk but decodes to ~1.6GB of RGBA; the check must run before
 * the full decode allocates (see sourceImage.ts decodeTiffImage).
 */
export function checkSourceImageDecodedSize(
  width: number,
  height: number,
): DecodedImageSizeCheck {
  const totalPixels = width * height;
  const longestEdge = Math.max(width, height);
  if (totalPixels > PREPROCESS_OVERSIZED_IMAGE_LIMITS.maxPixels) {
    return {
      ok: false,
      width,
      height,
      reason: `Image dimensions ${width}x${height} exceed the ${PREPROCESS_OVERSIZED_IMAGE_LIMITS.maxPixels} pixel limit`,
    };
  }
  if (longestEdge > PREPROCESS_OVERSIZED_IMAGE_LIMITS.maxLongestEdge) {
    return {
      ok: false,
      width,
      height,
      reason: `Image longest edge ${longestEdge}px exceeds the ${PREPROCESS_OVERSIZED_IMAGE_LIMITS.maxLongestEdge}px limit`,
    };
  }

  return {
    ok: true,
    width,
    height,
    reason: null,
  };
}
