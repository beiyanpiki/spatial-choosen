import type { ProjectedSpot } from '@/types/preprocess';
import { getProjectedSpotLowresBounds } from './spotProjection';
import { normalizeTissueParams, type TissueParams } from './tissueThresholds';

const SPOT_BATCH_YIELD_INTERVAL = 250;

type SchedulerLike = {
  yield?: () => Promise<void>;
};

const grayscaleMinAt = (data: Uint8ClampedArray, width: number, height: number, x: number, y: number) => {
  const px = Math.max(0, Math.min(width - 1, x));
  const py = Math.max(0, Math.min(height - 1, y));
  const offset = (py * width + px) * 4;
  const r = data[offset] ?? 0;
  const g = data[offset + 1] ?? 0;
  const b = data[offset + 2] ?? 0;
  return Math.min(r, g, b);
};

const computeActivePixelRatio = (args: {
  data: Uint8ClampedArray;
  imageWidth: number;
  imageHeight: number;
  cropWidth: number;
  cropHeight: number;
  tissueLowresScaleFactor: number;
  spot: ProjectedSpot;
  blockThreshold: number;
}) => {
  const bounds = getProjectedSpotLowresBounds({
    spot: args.spot,
    cropWidth: args.cropWidth,
    cropHeight: args.cropHeight,
    tissue_lowres_scalef: args.tissueLowresScaleFactor,
  });
  const startX = Math.max(0, Math.min(args.imageWidth, bounds.startX));
  const endX = Math.max(startX, Math.min(args.imageWidth, bounds.endX));
  const startY = Math.max(0, Math.min(args.imageHeight, bounds.startY));
  const endY = Math.max(startY, Math.min(args.imageHeight, bounds.endY));

  let totalPixels = 0;
  let activePixels = 0;

  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      totalPixels += 1;
      if (grayscaleMinAt(args.data, args.imageWidth, args.imageHeight, px, py) <= args.blockThreshold) {
        activePixels += 1;
      }
    }
  }

  return totalPixels > 0 ? activePixels / totalPixels : 0;
};

const yieldToMainThread = async () => {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: SchedulerLike }).scheduler;
  if (typeof scheduler?.yield === 'function') {
    await scheduler.yield();
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
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
  eosinLowresCropDataUrl: string;
  cropWidth: number;
  cropHeight: number;
  tissueLowresScaleFactor: number;
  projectedSpots: ProjectedSpot[];
  params: Partial<TissueParams>;
}) {
  const params = normalizeTissueParams(args.params);
  const imageData = await loadImageData(args.eosinLowresCropDataUrl);
  const selectedIds: string[] = [];

  for (let index = 0; index < args.projectedSpots.length; index += 1) {
    const spot = args.projectedSpots[index];
    if (!spot) {
      continue;
    }

    const activePixelRatio = computeActivePixelRatio({
      data: imageData.data,
      imageWidth: imageData.width,
      imageHeight: imageData.height,
      cropWidth: args.cropWidth,
      cropHeight: args.cropHeight,
      tissueLowresScaleFactor: args.tissueLowresScaleFactor,
      spot,
      blockThreshold: params.blockThreshold,
    });

    if (activePixelRatio >= params.activationThreshold) {
      selectedIds.push(spot.id);
    }

    const processedSpotCount = index + 1;
    if (
      processedSpotCount % SPOT_BATCH_YIELD_INTERVAL === 0
      || processedSpotCount === args.projectedSpots.length
    ) {
      await yieldToMainThread();
    }
  }

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
