import { describe, expect, it } from 'vitest';

import { normalizeSimilarityParams } from '@/lib/batch/affine';
import type { BatchPackage, BatchRegion } from '@/types/batch';

import {
  DEFAULT_SELECTION_SETTINGS,
  createDefaultAlignment,
  hasCustomRegions,
  isDefaultAlignment,
  resolveAllPackageRegions,
  resolveRegionsForPackage,
  resolveAlignment,
} from './batchState';

describe('default selection settings', () => {
  it('counts a spot as soon as its square touches the region', () => {
    // The review step no longer exposes these, so the defaults are the contract.
    expect(DEFAULT_SELECTION_SETTINGS).toEqual({ anchorMode: 'top-left', hitMode: 'overlap' });
  });
});

const region = (points: BatchRegion['points']): BatchRegion => ({ id: 'region-1', points });

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
      referenceRegions: [{ id: 'region-1', points: [{ x: 1, y: 0.5 }] }],
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
