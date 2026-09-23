import { describe, expect, it } from 'vitest';

import {
  applyAffine,
  composeAffine,
  decomposeNormalizedSimilarity,
  invertAffine,
  normalizeSimilarityParams,
  rebaseSimilarityParams,
  similarityNormalizedMatrix,
} from '@/lib/batch/affine';
import { computeSelection } from '@/lib/batch/pipeline';
import { applyRegionStroke, mapReferenceRegionsToPackage } from '@/lib/batch/regions';
import { pointInRegions } from '@/lib/batch/selection';
import type {
  BatchAffineMatrix,
  BatchPackage,
  BatchRegion,
  BatchSimilarityParams,
  BatchSpot,
} from '@/types/batch';

import {
  DEFAULT_SELECTION_SETTINGS,
  applyAlignmentEdits,
  applySharedStroke,
  createDefaultAlignment,
  hasCustomRegions,
  isDefaultAlignment,
  linkAlignmentToBase,
  resolveAllPackageRegions,
  resolveRegionsForPackage,
  resolveAlignment,
  transferReferenceRegions,
} from './batchState';

describe('default selection settings', () => {
  it('counts a spot as soon as its square touches the region', () => {
    // The review step no longer exposes these, so the defaults are the contract.
    expect(DEFAULT_SELECTION_SETTINGS).toEqual({ anchorMode: 'top-left', hitMode: 'overlap' });
  });
});

const region = (points: BatchRegion['points']): BatchRegion => ({ id: 'region-1', points, colorId: 1 });

const REFERENCE_REGION = region([
  { x: 1, y: 0.5 },
  { x: 1, y: 1 },
  { x: 0.5, y: 1 },
]);

const closePoint = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
};

describe('alignment helpers', () => {
  it('treats the untouched default as identity', () => {
    expect(isDefaultAlignment(createDefaultAlignment())).toBe(true);
    expect(isDefaultAlignment(normalizeSimilarityParams({ scale: 1.1 }))).toBe(false);
  });

  it('falls back to identity when a package has no stored alignment', () => {
    expect(resolveAlignment({}, 'missing')).toEqual(createDefaultAlignment());
  });
});

describe('resolveRegionsForPackage', () => {
  it('keeps the reference region untouched for the reference package', () => {
    const resolved = resolveRegionsForPackage({
      packageId: 'ref',
      referencePackageId: 'ref',
      referenceRegions: [REFERENCE_REGION],
      customRegions: {},
      alignments: {},
    });

    expect(resolved[0].points).toEqual(REFERENCE_REGION.points);
  });

  it('inverts the scale when projecting onto a package', () => {
    const resolved = resolveRegionsForPackage({
      packageId: 'pkg',
      referencePackageId: 'ref',
      referenceRegions: [REFERENCE_REGION],
      customRegions: {},
      alignments: { pkg: normalizeSimilarityParams({ scale: 2 }) },
    });

    // moving -> reference doubles the distance from the centre, so the
    // reference region halves on the way back.
    closePoint(resolved[0].points[0], { x: 0.75, y: 0.5 });
    closePoint(resolved[0].points[1], { x: 0.75, y: 0.75 });
    closePoint(resolved[0].points[2], { x: 0.5, y: 0.75 });
  });

  it('inverts the rotation when projecting onto a package', () => {
    const resolved = resolveRegionsForPackage({
      packageId: 'pkg',
      referencePackageId: 'ref',
      referenceRegions: [{ id: 'region-1', points: [{ x: 1, y: 0.5 }], colorId: 1 }],
      customRegions: {},
      alignments: { pkg: normalizeSimilarityParams({ rotationDegrees: 90, scale: 2 }) },
    });

    closePoint(resolved[0].points[0], { x: 0.5, y: 0.25 });
  });

  it('prefers a manual override when one exists', () => {
    const manual = region([{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }]);
    const resolved = resolveRegionsForPackage({
      packageId: 'pkg',
      referencePackageId: 'ref',
      referenceRegions: [REFERENCE_REGION],
      customRegions: { pkg: [manual] },
      alignments: {},
    });

    expect(resolved).toEqual([manual]);
    expect(hasCustomRegions({ pkg: [manual] }, 'pkg')).toBe(true);
    expect(hasCustomRegions({ pkg: [manual] }, 'other')).toBe(false);
  });

  it('returns nothing when no reference region has been drawn yet', () => {
    expect(resolveRegionsForPackage({
      packageId: 'pkg',
      referencePackageId: 'ref',
      referenceRegions: [],
      customRegions: {},
      alignments: {},
    })).toEqual([]);
  });
});

describe('resolveAllPackageRegions', () => {
  it('resolves every package with the shared reference region', () => {
    const stubPackage = (id: string) => ({ id } as unknown as BatchPackage);

    const resolved = resolveAllPackageRegions({
      packages: [
        stubPackage('ref'),
        stubPackage('pkg'),
      ],
      referencePackageId: 'ref',
      referenceRegions: [REFERENCE_REGION],
      customRegions: {},
      alignments: { pkg: normalizeSimilarityParams({ scale: 2 }) },
    });

    expect(Object.keys(resolved)).toEqual(['ref', 'pkg']);
    closePoint(resolved.pkg[0].points[0], { x: 0.75, y: 0.5 });
  });
});

describe('transferReferenceRegions', () => {
  const drawnOnNext = region([{ x: 0.3, y: 0.3 }, { x: 0.4, y: 0.3 }, { x: 0.4, y: 0.4 }]);
  const oldOutline = region([{ x: 0.6, y: 0.6 }, { x: 0.7, y: 0.6 }, { x: 0.7, y: 0.7 }]);
  const identity: BatchAffineMatrix = [1, 0, 0, 0, 1, 0];

  it('keeps the region drawn on the image that becomes the reference', () => {
    const transfer = transferReferenceRegions({
      previousReferenceId: 'refA',
      nextReferenceId: 'b',
      previousReferenceRegions: [oldOutline],
      customRegions: { b: [drawnOnNext] },
      toNextReference: identity,
    });

    // What was drawn on B is now the reference outline…
    expect(transfer.referenceRegions[0].points).toEqual(drawnOnNext.points);
    // …and the old outline stays with A as its own region.
    expect(transfer.customRegions.refA[0].points).toEqual(oldOutline.points);
    expect(transfer.customRegions.b).toBeUndefined();
  });

  it('re-bases the outline when the new reference has nothing drawn on it', () => {
    const toNext = invertAffine(
      similarityNormalizedMatrix(normalizeSimilarityParams({ offsetX: 0.2 })),
    );
    expect(toNext).not.toBeNull();

    const transfer = transferReferenceRegions({
      previousReferenceId: 'refA',
      nextReferenceId: 'b',
      previousReferenceRegions: [oldOutline],
      customRegions: {},
      toNextReference: toNext as BatchAffineMatrix,
    });

    // The outline keeps its place on screen, expressed in B's frame.
    expect(transfer.referenceRegions[0].points[0].x).toBeCloseTo(oldOutline.points[0].x - 0.2, 10);
    expect(transfer.customRegions.refA[0].points).toEqual(oldOutline.points);
  });

  it('leaves other packages untouched', () => {
    const other = region([{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }]);
    const transfer = transferReferenceRegions({
      previousReferenceId: 'refA',
      nextReferenceId: 'b',
      previousReferenceRegions: [],
      customRegions: { c: [other] },
      toNextReference: [1, 0, 0, 0, 1, 0],
    });

    expect(transfer.customRegions.c[0].points).toEqual(other.points);
  });

  it('re-bases the outline when the new reference was cleared instead of drawn on', () => {
    const transfer = transferReferenceRegions({
      previousReferenceId: 'refA',
      nextReferenceId: 'b',
      previousReferenceRegions: [oldOutline],
      // An emptied image is not a guide; promoting it must not blank the batch.
      customRegions: { b: [] },
      toNextReference: identity,
    });

    expect(transfer.referenceRegions[0].points).toEqual(oldOutline.points);
    expect(transfer.customRegions.refA[0].points).toEqual(oldOutline.points);
  });
});

/** Chained alignment: image 3 matched onto image 2, which is matched onto image 1. */
describe('chained alignment against a chosen base image', () => {
  const REFERENCE = 'ref';
  const baseAbsolute = normalizeSimilarityParams({
    rotationDegrees: -20,
    scale: 0.8,
    offsetX: -0.1,
    offsetY: 0.02,
  });
  const cAbsolute = normalizeSimilarityParams({
    rotationDegrees: 15,
    scale: 1.2,
    offsetX: 0.05,
    offsetY: -0.03,
  });
  const dAbsolute = normalizeSimilarityParams({ scale: 1.4, offsetY: 0.1 });
  /** What the operator sees between c and the base it was matched against. */
  const relativeOfC = rebaseSimilarityParams(cAbsolute, baseAbsolute);
  const relativeOfD = rebaseSimilarityParams(dAbsolute, cAbsolute);
  const reference = { [REFERENCE]: createDefaultAlignment() };
  const probe = { x: 0.25, y: 0.75 };

  const expectParamsClose = (left: BatchSimilarityParams, right: BatchSimilarityParams) => (
    closePoint(
      applyAffine(similarityNormalizedMatrix(left), probe),
      applyAffine(similarityNormalizedMatrix(right), probe),
    )
  );

  it('keeps the pose absolute and only records the base as a link', () => {
    const link = linkAlignmentToBase({
      alignments: { ...reference, b: baseAbsolute, c: cAbsolute },
      packageId: 'c',
      baseId: 'b',
      referencePackageId: REFERENCE,
    });

    expect(link?.baseId).toBe('b');
    expectParamsClose(link?.params ?? createDefaultAlignment(), relativeOfC);
  });

  it('needs no link when the base is the reference', () => {
    const link = linkAlignmentToBase({
      alignments: { ...reference, c: cAbsolute },
      packageId: 'c',
      baseId: REFERENCE,
      referencePackageId: REFERENCE,
    });

    expect(link).toBeNull();
  });

  it('keeps the pair together when the base is adjusted again', () => {
    const before = { ...reference, b: baseAbsolute, c: cAbsolute };
    const links = {
      c: linkAlignmentToBase({
        alignments: before,
        packageId: 'c',
        baseId: 'b',
        referencePackageId: REFERENCE,
      }) as NonNullable<ReturnType<typeof linkAlignmentToBase>>,
    };

    const after = applyAlignmentEdits({
      alignments: before,
      links,
      updates: {
        b: normalizeSimilarityParams({
          ...baseAbsolute,
          rotationDegrees: -6,
          offsetX: baseAbsolute.offsetX + 0.15,
        }),
      },
      linkUpdates: {},
    });

    // The base moved, so the image matched onto it came along…
    expect(after.alignments.b).not.toEqual(before.b);
    expect(after.alignments.c).not.toEqual(before.c);
    // …keeping the relative pose the operator dialled.
    expectParamsClose(rebaseSimilarityParams(after.alignments.c, after.alignments.b), relativeOfC);
    expect(after.links.c).toEqual(links.c);
  });

  it('stops following once the link is dropped', () => {
    const before = { ...reference, b: baseAbsolute, c: cAbsolute };

    const after = applyAlignmentEdits({
      alignments: before,
      links: {
        c: linkAlignmentToBase({
          alignments: before,
          packageId: 'c',
          baseId: 'b',
          referencePackageId: REFERENCE,
        }) as NonNullable<ReturnType<typeof linkAlignmentToBase>>,
      },
      updates: { b: normalizeSimilarityParams({ ...baseAbsolute, offsetY: 0.2 }) },
      linkUpdates: { c: null },
    });

    expectParamsClose(after.alignments.c, cAbsolute);
    expect(after.links.c).toBeUndefined();
  });

  it('propagates through a chain and survives a hand-made cycle', () => {
    const before = { ...reference, b: baseAbsolute, c: cAbsolute, d: dAbsolute };
    const links = {
      c: linkAlignmentToBase({
        alignments: before,
        packageId: 'c',
        baseId: 'b',
        referencePackageId: REFERENCE,
      }) as NonNullable<ReturnType<typeof linkAlignmentToBase>>,
      d: linkAlignmentToBase({
        alignments: before,
        packageId: 'd',
        baseId: 'c',
        referencePackageId: REFERENCE,
      }) as NonNullable<ReturnType<typeof linkAlignmentToBase>>,
    };

    const moved = applyAlignmentEdits({
      alignments: before,
      links,
      updates: { b: normalizeSimilarityParams({ ...baseAbsolute, offsetX: 0.42 }) },
      linkUpdates: {},
    });

    // c follows b, and d follows c one hop further down the chain.
    expectParamsClose(rebaseSimilarityParams(moved.alignments.c, moved.alignments.b), relativeOfC);
    expectParamsClose(rebaseSimilarityParams(moved.alignments.d, moved.alignments.c), relativeOfD);

    // Two packages pointing at each other must not loop forever.
    const cyclic = applyAlignmentEdits({
      alignments: { ref: createDefaultAlignment(), x: baseAbsolute, y: cAbsolute },
      links: {
        x: { baseId: 'y', params: relativeOfC },
        y: { baseId: 'x', params: relativeOfC },
      },
      updates: { x: normalizeSimilarityParams({ scale: 1.3 }) },
      linkUpdates: {},
    });

    expect(Object.keys(cyclic.alignments)).toEqual(['ref', 'x', 'y']);
  });
});

/**
 * Drawing on the right-hand panel must reach every adjusted image, the locked
 * reference on the left included, even when a package carries its own override.
 */
/**
 * Step 2 can nudge the reference image itself, so the batch frame and the
 * reference image frame are no longer the same thing.
 */
describe('reference image carrying its own pose', () => {
  const relative = normalizeSimilarityParams({ rotationDegrees: 18, scale: 0.85, offsetX: 0.06 });
  const referencePose = normalizeSimilarityParams({
    rotationDegrees: -30,
    scale: 1.25,
    offsetX: -0.08,
    offsetY: 0.04,
  });
  const outline = region([{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }, { x: 0.4, y: 0.4 }, { x: 0.2, y: 0.4 }]);

  const project = (refPose: BatchSimilarityParams, packagePose: BatchSimilarityParams) => (
    resolveRegionsForPackage({
      packageId: 'p',
      referencePackageId: 'ref',
      referenceRegions: [outline],
      customRegions: {},
      alignments: { ref: refPose, p: packagePose },
    })
  );

  it('projects the outline through the relative transform, not the absolute frame', () => {
    const packagePose = decomposeNormalizedSimilarity(composeAffine(
      similarityNormalizedMatrix(referencePose),
      similarityNormalizedMatrix(relative),
    ));
    expect(packagePose).not.toBeNull();

    const posed = project(referencePose, packagePose as BatchSimilarityParams);
    const flat = project(createDefaultAlignment(), relative);

    expect(posed).toHaveLength(flat.length);
    expect(posed[0].points[0].x).toBeCloseTo(flat[0].points[0].x, 9);
    expect(posed[0].points[0].y).toBeCloseTo(flat[0].points[0].y, 9);
  });

  it('keeps the shared stroke in the reference image frame', () => {
    const stroke = region([
      { x: 0.45, y: 0.45 },
      { x: 0.55, y: 0.45 },
      { x: 0.55, y: 0.55 },
      { x: 0.45, y: 0.55 },
    ]);
    const next = applySharedStroke({
      referenceRegions: [],
      customRegions: {},
      alignments: { ref: referencePose },
      referenceParams: referencePose,
      stroke,
      tool: 'merge',
      colorId: 1,
    });

    const toReference = invertAffine(similarityNormalizedMatrix(referencePose));
    expect(toReference).not.toBeNull();
    const localCentre = applyAffine(toReference as BatchAffineMatrix, { x: 0.5, y: 0.5 });

    // Stored where the reference image puts it, not where the batch frame does.
    expect(pointInRegions(localCentre, next.referenceRegions)).toBe(true);
    expect(pointInRegions({ x: 0.5, y: 0.5 }, next.referenceRegions)).toBe(false);
  });
});

describe('applySharedStroke', () => {
  const REFERENCE = 'ref';
  const SIZE = { width: 1000, height: 1000 };
  const alignments = {
    b: normalizeSimilarityParams({ rotationDegrees: 25, scale: 0.9, offsetX: 0.06 }),
  };
  // The outline sits next to the stroke, so "before" really means "not selected".
  const outline = region([{ x: 0.2, y: 0.2 }, { x: 0.35, y: 0.2 }, { x: 0.35, y: 0.35 }, { x: 0.2, y: 0.35 }]);
  const overrideB = region([{ x: 0.05, y: 0.05 }, { x: 0.15, y: 0.05 }, { x: 0.15, y: 0.15 }]);
  const stroke = region([{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 }]);
  const cutStroke = region([{ x: 0.42, y: 0.42 }, { x: 0.58, y: 0.42 }, { x: 0.58, y: 0.58 }, { x: 0.42, y: 0.58 }]);
  const strokeCentre = stroke.points.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x / stroke.points.length,
      y: accumulator.y + point.y / stroke.points.length,
    }),
    { x: 0, y: 0 },
  );
  const customRegions = { b: [overrideB] };

  /** The stroke centre expressed in one package's own normalized frame. */
  const localPoint = (packageId: string) => {
    const toPackage = invertAffine(
      similarityNormalizedMatrix(resolveAlignment(alignments, packageId)),
    );
    expect(toPackage).not.toBeNull();
    return applyAffine(toPackage as BatchAffineMatrix, strokeCentre);
  };

  const spotInsideStroke = (packageId: string): BatchSpot => {
    const local = localPoint(packageId);

    return {
      barcode: 'probe',
      inTissue: true,
      arrayRow: 0,
      arrayCol: 0,
      pxlRowInFullres: local.y * SIZE.height,
      pxlColInFullres: local.x * SIZE.width,
    };
  };

  const selectedFor = (
    referenceRegions: readonly BatchRegion[],
    regionsByPackage: Record<string, BatchRegion[]>,
    packageId: string,
  ) => computeSelection({
    spots: [spotInsideStroke(packageId)],
    regions: resolveRegionsForPackage({
      packageId,
      referencePackageId: REFERENCE,
      referenceRegions,
      customRegions: regionsByPackage,
      alignments,
    }),
    size: SIZE,
    settings: DEFAULT_SELECTION_SETTINGS,
    spotDiameterFullres: 10,
  }).selectedBarcodes;

  it('is not selected by the outline or the override alone', () => {
    expect(selectedFor([outline], customRegions, REFERENCE)).toEqual([]);
    expect(selectedFor([outline], customRegions, 'b')).toEqual([]);
    expect(selectedFor([outline], customRegions, 'c')).toEqual([]);
  });

  it('maps one stroke onto the reference, an overridden image and a projected one', () => {
    const next = applySharedStroke({
      referenceRegions: [outline],
      customRegions,
      alignments,
      stroke,
      tool: 'merge',
      colorId: 1,
    });

    // The stroke joined the shared outline…
    expect(next.referenceRegions).toHaveLength(2);
    expect(next.referenceRegions[1].points).toEqual(stroke.points);
    // …and the override kept its own region and gained the same stroke.
    expect(next.customRegions.b).toHaveLength(2);
    expect(next.customRegions.b[0].points).toEqual(overrideB.points);
    expect(pointInRegions(localPoint('b'), next.customRegions.b)).toBe(true);

    for (const packageId of [REFERENCE, 'b', 'c']) {
      expect(selectedFor(next.referenceRegions, next.customRegions, packageId)).toEqual(['probe']);
    }
  });

  it('carves the stroke out of the outline and out of the override', () => {
    const merged = applySharedStroke({
      referenceRegions: [outline],
      customRegions,
      alignments,
      stroke,
      tool: 'merge',
      colorId: 1,
    });
    const cut = applySharedStroke({
      referenceRegions: merged.referenceRegions,
      customRegions: merged.customRegions,
      alignments,
      stroke: cutStroke,
      tool: 'cut',
      colorId: 1,
    });

    // The mapped stroke was part of the override, and the cut takes it back out.
    expect(pointInRegions(localPoint('b'), merged.customRegions.b)).toBe(true);
    expect(pointInRegions(localPoint('b'), cut.customRegions.b)).toBe(false);
    expect(pointInRegions(strokeCentre, merged.referenceRegions)).toBe(true);
    expect(pointInRegions(strokeCentre, cut.referenceRegions)).toBe(false);
    // The parts the cutter did not cover are left alone on both lists.
    expect(pointInRegions({ x: 0.1, y: 0.1 }, cut.customRegions.b)).toBe(true);
    expect(pointInRegions({ x: 0.22, y: 0.22 }, cut.referenceRegions)).toBe(true);
  });
});

/**
 * Reproduces the reported flow: draw on image B while A is the reference, then
 * promote B to reference. The stroke must survive, the barcodes it covers must
 * stay selected and no package may move on screen.
 */
describe('promoting the drawn-on image to reference', () => {
  const PACKAGE_SIZE = { width: 1000, height: 1000 };
  const ALIGNED_B = normalizeSimilarityParams({
    rotationDegrees: 30,
    scale: 1.5,
    offsetX: 0.08,
    offsetY: -0.04,
  });
  const ALIGNED_C = normalizeSimilarityParams({
    rotationDegrees: -12,
    scale: 0.75,
    offsetX: -0.06,
    offsetY: 0.03,
  });

  const spot = (barcode: string, x: number, y: number): BatchSpot => ({
    barcode,
    inTissue: true,
    arrayRow: 0,
    arrayCol: 0,
    pxlRowInFullres: y,
    pxlColInFullres: x,
  });

  it('keeps the region, the barcode selection and every alignment', () => {
    const alignments = {
      a: createDefaultAlignment(),
      b: ALIGNED_B,
      c: ALIGNED_C,
    };
    const outlineOnA = region([{ x: 0.05, y: 0.05 }, { x: 0.2, y: 0.05 }, { x: 0.2, y: 0.2 }]);

    // The walkthrough panel shows B already rotated onto A, so the stroke the
    // operator draws arrives in A's frame and is stored in B's own frame.
    const drawnOnStage = region([
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.4 },
      { x: 0.6, y: 0.6 },
      { x: 0.4, y: 0.6 },
    ]);
    const [ownedStroke] = mapReferenceRegionsToPackage([drawnOnStage], ALIGNED_B);
    const customRegions = { b: applyRegionStroke([], ownedStroke, 'merge', drawnOnStage.colorId) };

    const centre = ownedStroke.points.reduce(
      (accumulator, point) => ({
        x: accumulator.x + point.x / ownedStroke.points.length,
        y: accumulator.y + point.y / ownedStroke.points.length,
      }),
      { x: 0, y: 0 },
    );
    const spots = [
      spot('inside', centre.x * PACKAGE_SIZE.width, centre.y * PACKAGE_SIZE.height),
      spot('outside', 40, 40),
    ];

    const selection = (regions: readonly BatchRegion[]) => computeSelection({
      spots,
      regions,
      size: PACKAGE_SIZE,
      settings: DEFAULT_SELECTION_SETTINGS,
      spotDiameterFullres: 10,
    }).selectedBarcodes;

    const selectedBefore = selection(resolveRegionsForPackage({
      packageId: 'b',
      referencePackageId: 'a',
      referenceRegions: [outlineOnA],
      customRegions,
      alignments,
    }));
    expect(selectedBefore).toEqual(['inside']);

    // "Set B as reference": the same work `changeReference` does in the UI.
    const toNewReference = invertAffine(similarityNormalizedMatrix(ALIGNED_B));
    expect(toNewReference).not.toBeNull();

    const rebased: Record<string, ReturnType<typeof createDefaultAlignment>> = {};
    for (const [id, params] of Object.entries(alignments)) {
      rebased[id] = decomposeNormalizedSimilarity(
        composeAffine(toNewReference as BatchAffineMatrix, similarityNormalizedMatrix(params)),
      ) ?? createDefaultAlignment();
    }

    const transfer = transferReferenceRegions({
      previousReferenceId: 'a',
      nextReferenceId: 'b',
      previousReferenceRegions: [outlineOnA],
      customRegions,
      toNextReference: toNewReference as BatchAffineMatrix,
    });

    // What was drawn on B is now the guide…
    expect(transfer.referenceRegions).toHaveLength(1);
    expect(transfer.referenceRegions[0].points).toEqual(ownedStroke.points);
    // …and A keeps the outline it had, as its own region.
    expect(transfer.customRegions.a[0].points).toEqual(outlineOnA.points);

    const selectedAfter = selection(resolveRegionsForPackage({
      packageId: 'b',
      referencePackageId: 'b',
      referenceRegions: transfer.referenceRegions,
      customRegions: transfer.customRegions,
      alignments: rebased,
    }));
    expect(selectedAfter).toEqual(selectedBefore);

    // Nothing moves on screen: C's alignment is unchanged once re-expressed.
    const probe = { x: 0.3, y: 0.7 };
    closePoint(
      applyAffine(similarityNormalizedMatrix(rebased.c), probe),
      applyAffine(
        composeAffine(toNewReference as BatchAffineMatrix, similarityNormalizedMatrix(ALIGNED_C)),
        probe,
      ),
    );
  });
});
