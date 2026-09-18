import { describe, expect, it } from 'vitest';

import type { BatchRegion } from '@/types/batch';

import { applyAffine, normalizeSimilarityParams, similarityNormalizedMatrix } from './affine';
import {
  createRegion,
  mapReferenceRegionsToPackage,
  regionsTouchedByStroke,
} from './regions';

const region = (id: string, points: BatchRegion['points']): BatchRegion => ({ id, points });

const TRIANGLE = region('region-a', [
  { x: 0.2, y: 0.2 },
  { x: 0.6, y: 0.3 },
  { x: 0.4, y: 0.7 },
]);

describe('region frame conversion', () => {
  it('round trips a region through the package frame and back', () => {
    const params = normalizeSimilarityParams({ rotationDegrees: 37, scale: 1.8, offsetX: 0.05 });
    const forward = similarityNormalizedMatrix(params);

    const [inPackage] = mapReferenceRegionsToPackage([TRIANGLE], params);
    const backInReference = inPackage.points.map((point) => applyAffine(forward, point));

    expect(inPackage.id).toBe(TRIANGLE.id);
    backInReference.forEach((point, index) => {
      expect(point.x).toBeCloseTo(TRIANGLE.points[index].x, 10);
      expect(point.y).toBeCloseTo(TRIANGLE.points[index].y, 10);
    });
  });

  it('keeps region ids so the projected guide can be traced back', () => {
    const params = normalizeSimilarityParams({ rotationDegrees: -20, scale: 0.7 });

    const mapped = mapReferenceRegionsToPackage([TRIANGLE], params);

    expect(mapped.map((entry) => entry.id)).toEqual(['region-a']);
  });

  it('moves a reference-frame stroke into the package frame before storing it', () => {
    const params = normalizeSimilarityParams({ scale: 2 });
    const stroke = createRegion([
      { x: 0.5, y: 0.5 },
      { x: 1, y: 0.5 },
      { x: 1, y: 1 },
    ]);

    const [stored] = mapReferenceRegionsToPackage([stroke!], params);

    // A 2x zoom about the centre halves the distance on the way back.
    expect(stored.points[0].x).toBeCloseTo(0.5, 10);
    expect(stored.points[1].x).toBeCloseTo(0.75, 10);
    expect(stored.points[2].y).toBeCloseTo(0.75, 10);
    // The stroke keeps its id, so step 4 can still address the same region.
    expect(stored.id).toBe(stroke!.id);
  });
});

describe('regionsTouchedByStroke', () => {
  it('reports regions the stroke passes through', () => {
    const untouched = region('region-b', [
      { x: 0.8, y: 0.8 },
      { x: 0.9, y: 0.8 },
      { x: 0.9, y: 0.9 },
    ]);
    const stroke = [{ x: 0.4, y: 0.4 }, { x: 0.41, y: 0.41 }];

    expect(regionsTouchedByStroke([TRIANGLE, untouched], stroke)).toEqual(new Set(['region-a']));
  });

  it('ignores strokes that miss every region', () => {
    expect(regionsTouchedByStroke([TRIANGLE], [{ x: 0.05, y: 0.05 }])).toEqual(new Set());
  });
});
