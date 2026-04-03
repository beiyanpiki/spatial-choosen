import type { ProjectedSpot } from '@/types/preprocess';
import { applyConnectedSpotCleanup, applyDensityFilter } from './tissueCleanup';
import { normalizeTissueParams, type TissueParams } from './tissueThresholds';

const grayscaleAt = (data: Uint8ClampedArray, width: number, x: number, y: number) => {
  const px = Math.max(0, Math.min(width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(Math.floor(data.length / 4 / width) - 1, Math.round(y)));
  const offset = (py * width + px) * 4;
  const r = data[offset] ?? 0;
  const g = data[offset + 1] ?? 0;
  const b = data[offset + 2] ?? 0;
  return 0.299 * r + 0.587 * g + 0.114 * b;
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

  const candidate = new Set<string>();
  for (const spot of args.projectedSpots) {
    const intensity = grayscaleAt(
      imageData.data,
      imageData.width,
      spot.x * imageData.width,
      spot.y * imageData.height,
    );

    const activationPass = params.thresholdMode === 'dark'
      ? intensity <= params.activationThreshold
      : intensity >= params.activationThreshold;
    const blockPass = params.thresholdMode === 'dark'
      ? intensity >= params.blockThreshold
      : intensity <= params.blockThreshold;

    if (activationPass && blockPass) {
      candidate.add(spot.id);
    }
  }

  const dense = applyDensityFilter({
    projectedSpots: args.projectedSpots,
    candidateIds: candidate,
    eps: params.dbscanEps,
    minSamples: params.dbscanMinSamples,
  });

  const connected = applyConnectedSpotCleanup({
    projectedSpots: args.projectedSpots,
    selectedIds: dense,
    minConnectedSpotCount: params.minConnectedSpotCount,
  });

  const selectedIds = args.projectedSpots.filter((spot) => connected.has(spot.id)).map((spot) => spot.id);
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
