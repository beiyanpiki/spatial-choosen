import type { ProjectedSpot, TissueSpotStyle } from '@/types/preprocess';
import { DEFAULT_TISSUE_SPOT_STYLE } from './tissueSpotStyle';

/**
 * Background and unselected-spot presentation for the standalone spot image.
 *
 * The image shows the full projected chip grid without any H&E/eosin tissue
 * background: tissue-selected spots use the tissue spot style color at full
 * opacity, while unselected spots keep a light neutral fill so the grid stays
 * visible for QC.
 */
export const STANDALONE_SPOT_IMAGE_BACKGROUND_COLOR = '#FFFFFF';
export const STANDALONE_SPOT_IMAGE_INACTIVE_FILL = '#E2E8F0';

export const STANDALONE_SPOT_IMAGE_RENDER_UNAVAILABLE_ERROR =
  'Standalone spot image rendering is unavailable. Export this project from a browser with canvas support.';

export type StandaloneSpotImageFillRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
};

export type StandaloneSpotImageRenderArgs = {
  width: number;
  height: number;
  projectedSpots: readonly ProjectedSpot[];
  selectedSpotIds: ReadonlySet<string> | readonly string[];
  spotStyle?: TissueSpotStyle;
};

const resolveSpotFill = (
  isSelected: boolean,
  spotStyle: TissueSpotStyle | undefined,
) => (isSelected ? (spotStyle ?? DEFAULT_TISSUE_SPOT_STYLE).color : STANDALONE_SPOT_IMAGE_INACTIVE_FILL);

const normalizeSelectedSpotIds = (
  selectedSpotIds: ReadonlySet<string> | readonly string[],
): ReadonlySet<string> =>
  selectedSpotIds instanceof Set ? selectedSpotIds : new Set(selectedSpotIds);

/**
 * Convert normalized projected spots into pixel fill rects for a canvas of
 * `width` × `height`. Mirrors the tissue selection canvas semantics (spot
 * x/y are centers, width/height are normalized square sides, at least 1px)
 * so the standalone image matches what the user verified during selection.
 */
export function computeStandaloneSpotImageFillRects(
  args: StandaloneSpotImageRenderArgs,
): StandaloneSpotImageFillRect[] {
  const { width, height } = args;
  const selectedSpotIds = normalizeSelectedSpotIds(args.selectedSpotIds);

  return args.projectedSpots.map((spot) => {
    const normalizedWidth = spot.width ?? spot.diameterX ?? 0;
    const normalizedHeight = spot.height ?? spot.diameterY ?? normalizedWidth;
    const spotWidth = Math.max(1, normalizedWidth * width);
    const spotHeight = Math.max(1, normalizedHeight * height);

    return {
      x: spot.x * width - spotWidth / 2,
      y: spot.y * height - spotHeight / 2,
      width: spotWidth,
      height: spotHeight,
      fill: resolveSpotFill(selectedSpotIds.has(spot.id), args.spotStyle),
    };
  });
}

export type StandaloneSpotImageDrawSurface = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'fillRect'
>;

export function drawStandaloneSpotImage(
  surface: StandaloneSpotImageDrawSurface,
  args: StandaloneSpotImageRenderArgs,
): void {
  surface.fillStyle = STANDALONE_SPOT_IMAGE_BACKGROUND_COLOR;
  surface.fillRect(0, 0, args.width, args.height);

  for (const rect of computeStandaloneSpotImageFillRects(args)) {
    surface.fillStyle = rect.fill;
    surface.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
}

export type RenderedStandaloneSpotImage = {
  dataUrl: string;
  width: number;
  height: number;
};

const loadReferenceImage = (sourceUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Registered H&E crop image failed to load for spot image rendering.'));
    image.src = sourceUrl;
  });

/**
 * Render the standalone spot image (browser-only) at exactly the pixel
 * dimensions of the reference crop image, so the eosin crop, H&E crop, and
 * spot image all share identical dimensions in the preview and the ZIP.
 */
export async function renderStandaloneSpotImageDataUrl(args: {
  referenceImageUrl: string;
  projectedSpots: readonly ProjectedSpot[];
  selectedSpotIds: ReadonlySet<string> | readonly string[];
  spotStyle?: TissueSpotStyle;
}): Promise<RenderedStandaloneSpotImage> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new Error(STANDALONE_SPOT_IMAGE_RENDER_UNAVAILABLE_ERROR);
  }

  const referenceImage = await loadReferenceImage(args.referenceImageUrl);
  const width = Math.max(1, referenceImage.naturalWidth);
  const height = Math.max(1, referenceImage.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error(STANDALONE_SPOT_IMAGE_RENDER_UNAVAILABLE_ERROR);
  }

  drawStandaloneSpotImage(context, {
    width,
    height,
    projectedSpots: args.projectedSpots,
    selectedSpotIds: args.selectedSpotIds,
    spotStyle: args.spotStyle,
  });

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
  };
}
