import {
  DEFAULT_SIMILARITY_PARAMS,
  composeAffine,
  decomposeNormalizedSimilarity,
  normalizeSimilarityParams,
  rebaseSimilarityParams,
  similarityNormalizedMatrix,
} from '@/lib/batch/affine';
import {
  applyRegionStroke,
  cloneRegions,
  mapReferenceRegionsToPackage,
  transformRegions,
} from '@/lib/batch/regions';
import type {
  BatchAffineMatrix,
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

  // The outline lives in the reference image's own frame, so the projection runs
  // through the *relative* transform. With the reference still at identity — the
  // default — this is the package's own transform, exactly as before.
  const relative = referencePackageId
    ? rebaseSimilarityParams(
        resolveAlignment(alignments, packageId),
        resolveAlignment(alignments, referencePackageId),
      )
    : resolveAlignment(alignments, packageId);

  return mapReferenceRegionsToPackage(referenceRegions, relative);
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

export type ReferenceTransfer = {
  referenceRegions: BatchRegion[];
  customRegions: Record<string, BatchRegion[]>;
};

/**
 * Applies a stroke drawn in the reference frame to the whole batch.
 *
 * The stroke joins the shared outline, so every package that follows the
 * outline — the reference included — picks it up. Packages with their own
 * override get the same stroke in their own frame, otherwise their override
 * would mask the shared edit on that image.
 */
export function applySharedStroke(args: {
  referenceRegions: readonly BatchRegion[];
  customRegions: Record<string, BatchRegion[]>;
  alignments: Record<string, BatchSimilarityParams>;
  /** Pose of the reference image itself; its outline is stored in its own frame. */
  referenceParams?: BatchSimilarityParams;
  stroke: BatchRegion;
  tool: 'merge' | 'cut';
  colorId: number;
}): {
  referenceRegions: BatchRegion[];
  customRegions: Record<string, BatchRegion[]>;
} {
  const { referenceRegions, customRegions, alignments, stroke, tool, colorId } = args;
  const referenceParams = normalizeSimilarityParams(args.referenceParams);
  const nextCustom: Record<string, BatchRegion[]> = { ...customRegions };

  for (const [packageId, regions] of Object.entries(customRegions)) {
    const [ownedStroke] = mapReferenceRegionsToPackage(
      [stroke],
      resolveAlignment(alignments, packageId),
    );
    if (!ownedStroke) continue;

    nextCustom[packageId] = applyRegionStroke(regions, ownedStroke, tool, colorId);
  }

  // The stroke arrives in the batch frame; the outline lives in the reference
  // image's own frame.
  const [outlineStroke] = mapReferenceRegionsToPackage([stroke], referenceParams);

  return {
    referenceRegions: outlineStroke
      ? applyRegionStroke(referenceRegions, outlineStroke, tool, colorId)
      : cloneRegions(referenceRegions),
    customRegions: nextCustom,
  };
}

/**
 * A transform that was dialled against another image instead of the batch
 * reference. Recomposing from the stored relative values is what makes a chained
 * alignment (`image 3 -> image 2 -> image 1`) follow later edits of its base.
 */
export type AlignmentLink = { baseId: string; params: BatchSimilarityParams };

/**
 * Expresses a package's stored transform against another base image.
 *
 * Returns `null` for the reference: it never moves, so the transform needs no
 * link bookkeeping and stays absolute.
 */
export function linkAlignmentToBase(args: {
  alignments: Record<string, BatchSimilarityParams>;
  packageId: string;
  baseId: string;
  referencePackageId: string | null;
}): AlignmentLink | null {
  const { alignments, packageId, baseId, referencePackageId } = args;
  if (baseId === referencePackageId) return null;

  return {
    baseId,
    params: rebaseSimilarityParams(
      resolveAlignment(alignments, packageId),
      resolveAlignment(alignments, baseId),
    ),
  };
}

/**
 * Applies alignment edits and drags the chained packages along.
 *
 * A package stores an absolute `package -> reference` transform, so moving a
 * base image would silently invalidate everything aligned to it. Every package
 * that was dialled against a changed base is therefore recomposed from its
 * stored relative values.
 */
export function applyAlignmentEdits(args: {
  alignments: Record<string, BatchSimilarityParams>;
  links: Record<string, AlignmentLink>;
  updates: Record<string, BatchSimilarityParams>;
  /** `null` drops a link, `undefined` leaves it as it is. */
  linkUpdates: Record<string, AlignmentLink | null>;
}): {
  alignments: Record<string, BatchSimilarityParams>;
  links: Record<string, AlignmentLink>;
} {
  const { updates, linkUpdates } = args;
  const nextAlignments = { ...args.alignments };
  const nextLinks = { ...args.links };

  for (const [id, params] of Object.entries(updates)) {
    nextAlignments[id] = normalizeSimilarityParams(params);
  }

  for (const [id, link] of Object.entries(linkUpdates)) {
    if (link) {
      nextLinks[id] = link;
    } else {
      delete nextLinks[id];
    }
  }

  const queue = Object.keys(updates);
  const seen = new Set(queue);

  // Breadth-first, so a chain of any length is rebased exactly once per edit and
  // a hand-made cycle cannot spin forever.
  while (queue.length > 0) {
    const changedId = queue.shift() as string;
    const baseParams = resolveAlignment(nextAlignments, changedId);

    for (const [dependentId, link] of Object.entries(nextLinks)) {
      if (link.baseId !== changedId || seen.has(dependentId)) continue;

      seen.add(dependentId);
      nextAlignments[dependentId] = decomposeNormalizedSimilarity(composeAffine(
        similarityNormalizedMatrix(baseParams),
        similarityNormalizedMatrix(link.params),
      )) ?? createDefaultAlignment();
      queue.push(dependentId);
    }
  }

  return { alignments: nextAlignments, links: nextLinks };
}

/**
 * Moves the selection over when the reference image changes.
 *
 * Whatever was already drawn on the new reference becomes the reference outline;
 * the old outline stays with the old reference as that package's own region.
 * Both are frame-correct: a package's regions live in its own frame, and the
 * reference outline lives in the reference's frame.
 *
 * An empty list counts as "nothing drawn": clearing an image before promoting it
 * must not blank the guide that every other package is projected from.
 */
export function transferReferenceRegions(args: {
  previousReferenceId: string | null;
  nextReferenceId: string;
  previousReferenceRegions: readonly BatchRegion[];
  customRegions: Record<string, BatchRegion[]>;
  /** Maps the old reference frame onto the new one. */
  toNextReference: BatchAffineMatrix;
}): ReferenceTransfer {
  const {
    previousReferenceId,
    nextReferenceId,
    previousReferenceRegions,
    customRegions,
    toNextReference,
  } = args;

  const drawnOnNextReference = customRegions[nextReferenceId];
  const referenceRegions = drawnOnNextReference && drawnOnNextReference.length > 0
    ? cloneRegions(drawnOnNextReference)
    : transformRegions(previousReferenceRegions, toNextReference);

  const nextCustomRegions: Record<string, BatchRegion[]> = { ...customRegions };
  delete nextCustomRegions[nextReferenceId];

  if (previousReferenceId && previousReferenceId !== nextReferenceId) {
    nextCustomRegions[previousReferenceId] = cloneRegions(previousReferenceRegions);
  }

  return { referenceRegions, customRegions: nextCustomRegions };
}
