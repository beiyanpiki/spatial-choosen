import type { ProjectedSpot, TissueActivationMatrix } from '@/types/built-in';
import { getProjectedSpotLowresBounds } from './spotProjection';
import { applyConnectedSpotCleanup, applyDensityFilter } from './tissueCleanup';
import { matrixFromSelectedSpotIds } from './tissueMatrix';
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

const transformChannels = (args: {
  thresholdMode: TissueParams['thresholdMode'];
  r: number;
  g: number;
  b: number;
}) => {
  const { thresholdMode, r, g, b } = args;

  if (thresholdMode === 'gray-max') {
    const value = Math.max(r, g, b);
    return [value, value, value] as const;
  }

  if (thresholdMode === 'gray-min') {
    const value = Math.min(r, g, b);
    return [value, value, value] as const;
  }

  return [r, g, b] as const;
};

const computeRawSaturation = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  if (max === 0) {
    return 0;
  }

  const min = Math.min(r, g, b);
  return ((max - min) / max) * 255;
};

const buildActivePixelIntegralImage = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  blockThreshold: number,
  thresholdMode: TissueParams['thresholdMode'],
) => {
  const stride = width + 1;
  const integral = new Uint32Array((height + 1) * stride);

  for (let py = 0; py < height; py += 1) {
    let rowSum = 0;
    for (let px = 0; px < width; px += 1) {
      const offset = (py * width + px) * 4;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      const [workingR, workingG, workingB] = transformChannels({ thresholdMode, r, g, b });
      const workingIntensity = (workingR + workingG + workingB) / 3;
      const isActivePixel = thresholdMode === 'raw'
        ? computeRawSaturation(r, g, b) >= blockThreshold
        : workingIntensity <= blockThreshold;

      if (isActivePixel) {
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
  matrix: TissueActivationMatrix;
  summary: TissueParitySummary;
  params: TissueParams;
  warning: string | null;
};

type MatrixAxisResolution = {
  size: number;
  offset: number;
};

type MatrixResolution = {
  rows: number;
  columns: number;
  rowOffset: number;
  columnOffset: number;
};

const normalizeExplicitMatrixDimension = (value: number | undefined) => {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		return null;
	}

  return value;
};

const resolveMatrixAxis = (args: {
  values: number[];
  explicitSize?: number;
}): MatrixAxisResolution => {
  const validValues = args.values.filter((value) => Number.isInteger(value));
  const explicitSize = normalizeExplicitMatrixDimension(args.explicitSize);

  if (validValues.length === 0) {
    return {
      size: explicitSize ?? 1,
      offset: 0,
    };
  }

  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  const offset = min <= 0 ? 1 - min : 0;
  const inferredSize = Math.max(max + offset, 1);

  return {
    size: Math.max(explicitSize ?? 0, inferredSize),
    offset,
  };
};

const resolveMatrixDimensions = (args: {
  projectedSpots: ProjectedSpot[];
  explicitRows?: number;
  explicitColumns?: number;
}): MatrixResolution => {
  const rowResolution = resolveMatrixAxis({
    values: args.projectedSpots.map((spot) => spot.arrayRow),
    explicitSize: args.explicitRows,
  });
  const columnResolution = resolveMatrixAxis({
    values: args.projectedSpots.map((spot) => spot.arrayCol),
    explicitSize: args.explicitColumns,
  });

  return {
    rows: rowResolution.size,
    columns: columnResolution.size,
    rowOffset: rowResolution.offset,
    columnOffset: columnResolution.offset,
  };
};

const normalizeProjectedSpotsForMatrix = (args: {
  projectedSpots: ProjectedSpot[];
  rowOffset: number;
  columnOffset: number;
}) => {
  if (args.rowOffset === 0 && args.columnOffset === 0) {
    return args.projectedSpots;
  }

  return args.projectedSpots.map((spot) => ({
    ...spot,
    arrayRow: spot.arrayRow + args.rowOffset,
    arrayCol: spot.arrayCol + args.columnOffset,
  }));
};

export async function runTissueAutoSelection(args: {
  eosinLowresCropDataUrl: string;
  cropWidth: number;
  cropHeight: number;
  tissueLowresScaleFactor: number;
  matrixRows?: number;
  matrixColumns?: number;
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
    params.thresholdMode,
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
  const matrixDimensions = resolveMatrixDimensions({
    projectedSpots: args.projectedSpots,
    explicitRows: args.matrixRows,
    explicitColumns: args.matrixColumns,
  });
  const matrixProjectedSpots = normalizeProjectedSpotsForMatrix({
    projectedSpots: args.projectedSpots,
    rowOffset: matrixDimensions.rowOffset,
    columnOffset: matrixDimensions.columnOffset,
  });
  const matrix = matrixFromSelectedSpotIds({
    rows: matrixDimensions.rows,
    columns: matrixDimensions.columns,
    projectedSpots: matrixProjectedSpots,
    selectedSpotIds: selectedIds,
  });
  const summary: TissueParitySummary = {
    selectedCount,
    selectedPercent,
    maskCoverage: selectedPercent,
  };

  const warning = selectedCount === 0 || selectedPercent < 1 ? 'Auto-selection result is empty or low-confidence.' : null;

  return {
    selectedIds,
    matrix,
    summary,
    params,
    warning,
  } satisfies TissuePipelineResult;
}
