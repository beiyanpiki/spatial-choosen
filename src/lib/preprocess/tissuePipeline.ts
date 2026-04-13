import type { ProjectedSpot } from '@/types/preprocess';
import { getProjectedSpotLowresBounds } from './spotProjection';
import { applyConnectedSpotCleanup, applyDensityFilter } from './tissueCleanup';
import { normalizeTissueParams, type TissueParams } from './tissueThresholds';

const SPOT_BATCH_YIELD_INTERVAL = 250;

type SchedulerLike = {
  yield?: () => Promise<void>;
};

const computeActivePixelRatio = (args: {
  activePixelIntegralImage: Uint32Array;
  integralStride: number;
  imageWidth: number;
  imageHeight: number;
  cropWidth: number;
  cropHeight: number;
  tissueLowresScaleFactor: number;
  spot: ProjectedSpot;
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

  const totalPixels = (endX - startX) * (endY - startY);
  const activePixels = args.activePixelIntegralImage[endY * args.integralStride + endX]
    - args.activePixelIntegralImage[startY * args.integralStride + endX]
    - args.activePixelIntegralImage[endY * args.integralStride + startX]
    + args.activePixelIntegralImage[startY * args.integralStride + startX];

  return totalPixels > 0 ? activePixels / totalPixels : 0;
};

const buildActivePixelIntegralImage = (data: Uint8ClampedArray, width: number, height: number, blockThreshold: number) => {
  const stride = width + 1;
  const integral = new Uint32Array((height + 1) * stride);

  for (let py = 0; py < height; py += 1) {
    let rowSum = 0;
    for (let px = 0; px < width; px += 1) {
      const offset = (py * width + px) * 4;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      if (Math.min(r, g, b) <= blockThreshold) {
        rowSum += 1;
      }
      integral[(py + 1) * stride + (px + 1)] = integral[py * stride + (px + 1)] + rowSum;
    }
  }

  return { integral, stride };
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
  const { integral, stride } = buildActivePixelIntegralImage(
    imageData.data,
    imageData.width,
    imageData.height,
    params.blockThreshold,
  );
  const candidateIds: string[] = [];

  for (let index = 0; index < args.projectedSpots.length; index += 1) {
    const spot = args.projectedSpots[index];
    if (!spot) {
      continue;
    }

    const activePixelRatio = computeActivePixelRatio({
      activePixelIntegralImage: integral,
      integralStride: stride,
      imageWidth: imageData.width,
      imageHeight: imageData.height,
      cropWidth: args.cropWidth,
      cropHeight: args.cropHeight,
      tissueLowresScaleFactor: args.tissueLowresScaleFactor,
      spot,
    });

    if (activePixelRatio >= params.activationThreshold) {
      candidateIds.push(spot.id);
    }

    const processedSpotCount = index + 1;
    if (
      processedSpotCount % SPOT_BATCH_YIELD_INTERVAL === 0
      || processedSpotCount === args.projectedSpots.length
    ) {
      await yieldToMainThread();
    }
  }

  let selectedIdSet = new Set(candidateIds);

  if (selectedIdSet.size > 0 && params.minConnectedSpotCount > 1) {
    selectedIdSet = applyConnectedSpotCleanup({
      projectedSpots: args.projectedSpots,
      selectedIds: selectedIdSet,
      minConnectedSpotCount: params.minConnectedSpotCount,
    });
  }

  if (selectedIdSet.size > 0 && params.dbscanMinSamples > 1) {
    selectedIdSet = applyDensityFilter({
      projectedSpots: args.projectedSpots,
      candidateIds: selectedIdSet,
      eps: params.dbscanEps,
      minSamples: params.dbscanMinSamples,
    });
  }

  const selectedIds = args.projectedSpots
    .filter((spot) => selectedIdSet.has(spot.id))
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
