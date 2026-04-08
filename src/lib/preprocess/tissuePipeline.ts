import type { ProjectedSpot } from '@/types/preprocess';
import { normalizeTissueParams, type TissueParams } from './tissueThresholds';

const grayscaleMinAt = (data: Uint8ClampedArray, width: number, x: number, y: number) => {
  const px = Math.max(0, Math.min(width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(Math.floor(data.length / 4 / width) - 1, Math.round(y)));
  const offset = (py * width + px) * 4;
  const r = data[offset] ?? 0;
  const g = data[offset + 1] ?? 0;
  const b = data[offset + 2] ?? 0;
  return Math.min(r, g, b);
};

const computeActivePixelRatio = (args: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  spot: ProjectedSpot;
  blockThreshold: number;
}) => {
  const radiusX = Math.max(args.spot.diameterX / 2, 1 / args.width);
  const radiusY = Math.max(args.spot.diameterY / 2, 1 / args.height);
  const startX = Math.max(0, Math.floor((args.spot.x - radiusX) * args.width));
  const endX = Math.min(args.width, Math.ceil((args.spot.x + radiusX) * args.width));
  const startY = Math.max(0, Math.floor((args.spot.y - radiusY) * args.height));
  const endY = Math.min(args.height, Math.ceil((args.spot.y + radiusY) * args.height));

  let totalPixels = 0;
  let activePixels = 0;

  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const normalizedX = (((px + 0.5) / args.width) - args.spot.x) / radiusX;
      const normalizedY = (((py + 0.5) / args.height) - args.spot.y) / radiusY;
      if ((normalizedX * normalizedX) + (normalizedY * normalizedY) > 1) {
        continue;
      }

      totalPixels += 1;
      if (grayscaleMinAt(args.data, args.width, px, py) <= args.blockThreshold) {
        activePixels += 1;
      }
    }
  }

  return totalPixels > 0 ? activePixels / totalPixels : 0;
};

const loadImageData = (dataUrl: string) => new Promise<ImageData>((resolve, reject) => {
  const image = new window.Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('Canvas context unavailable'));
      return;
    }
    context.drawImage(image, 0, 0);
    resolve(context.getImageData(0, 0, canvas.width, canvas.height));
  };
  image.onerror = () => reject(new Error('Failed to decode eosin crop image'));
  image.src = dataUrl;
});

export type TissueParitySummary = {
  selectedCount: number;
  selectedPercent: number;
  maskCoverage: number;
};

export type TissuePipelineResult = {
  selectedIds: string[];
  summary: TissueParitySummary;
  params: TissueParams;
  warning: string | null;
};

export async function runTissueAutoSelection(args: {
  eosinCropDataUrl: string;
  projectedSpots: ProjectedSpot[];
  params: Partial<TissueParams>;
}) {
  const params = normalizeTissueParams(args.params);
  const imageData = await loadImageData(args.eosinCropDataUrl);

  const selectedIds = args.projectedSpots
    .filter((spot) => computeActivePixelRatio({
      data: imageData.data,
      width: imageData.width,
      height: imageData.height,
      spot,
      blockThreshold: params.blockThreshold,
    }) >= params.activationThreshold)
    .map((spot) => spot.id);
  const selectedCount = selectedIds.length;
  const selectedPercent = args.projectedSpots.length > 0 ? (selectedCount / args.projectedSpots.length) * 100 : 0;
  const summary: TissueParitySummary = {
    selectedCount,
    selectedPercent,
    maskCoverage: selectedPercent,
  };

  const warning = selectedCount === 0 || selectedPercent < 1 ? 'Auto-selection result is empty or low-confidence.' : null;

  return {
    selectedIds,
    summary,
    params,
    warning,
  } satisfies TissuePipelineResult;
}
