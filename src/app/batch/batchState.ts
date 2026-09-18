import {
  DEFAULT_SIMILARITY_PARAMS,
  normalizeSimilarityParams,
} from '@/lib/batch/affine';
import { mapReferenceRegionsToPackage } from '@/lib/batch/regions';
import type {
  BatchMatrixLayout,
  BatchPackage,
  BatchRegion,
  BatchSelectionSettings,
  BatchSimilarityParams,
} from '@/types/batch';

export const DEFAULT_SELECTION_SETTINGS: BatchSelectionSettings = {
  anchorMode: 'top-left',
  // A spot counts as selected as soon as its square touches the drawn region,
  // not only when its centre falls inside it.
  hitMode: 'overlap',
};

export const DEFAULT_MATRIX_LAYOUT: BatchMatrixLayout = '2x3';

export function createDefaultAlignment(): BatchSimilarityParams {
  return { ...DEFAULT_SIMILARITY_PARAMS };
}

export function resolveAlignment(
  alignments: Record<string, BatchSimilarityParams>,
  packageId: string,
): BatchSimilarityParams {
  return normalizeSimilarityParams(alignments[packageId] ?? DEFAULT_SIMILARITY_PARAMS);
}

export function isDefaultAlignment(params: BatchSimilarityParams): boolean {
  const normalized = normalizeSimilarityParams(params);
  return normalized.rotationDegrees === 0
    && normalized.scale === 1
    && !normalized.flipHorizontal
    && !normalized.flipVertical
    && normalized.offsetX === 0
    && normalized.offsetY === 0;
}

export function hasCustomRegions(
  customRegions: Record<string, BatchRegion[]>,
  packageId: string,
): boolean {
  return Boolean(customRegions[packageId]);
}

/**
 * Regions for one package, in that package's own normalized frame.
 *
 * Without a manual override the reference selection is re-projected through the
 * current alignment, so step 4 always reflects the latest step 2 result.
 */
export function resolveRegionsForPackage(args: {
  packageId: string;
  referencePackageId: string | null;
  referenceRegions: readonly BatchRegion[];
  customRegions: Record<string, BatchRegion[]>;
  alignments: Record<string, BatchSimilarityParams>;
}): BatchRegion[] {
  const { packageId, referencePackageId, referenceRegions, customRegions, alignments } = args;
  const custom = customRegions[packageId];

  if (custom) {
    return custom;
  }

  if (referenceRegions.length === 0) {
    return [];
  }

  if (packageId === referencePackageId) {
    return referenceRegions.map((region) => ({ ...region }));
  }

  return mapReferenceRegionsToPackage(referenceRegions, resolveAlignment(alignments, packageId));
}

export function resolveAllPackageRegions(args: {
  packages: readonly BatchPackage[];
  referencePackageId: string | null;
  referenceRegions: readonly BatchRegion[];
  customRegions: Record<string, BatchRegion[]>;
  alignments: Record<string, BatchSimilarityParams>;
}): Record<string, BatchRegion[]> {
  const result: Record<string, BatchRegion[]> = {};

  for (const entry of args.packages) {
    result[entry.id] = resolveRegionsForPackage({
      packageId: entry.id,
      referencePackageId: args.referencePackageId,
      referenceRegions: args.referenceRegions,
      customRegions: args.customRegions,
      alignments: args.alignments,
    });
  }

  return result;
}
