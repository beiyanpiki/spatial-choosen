import { describe, expect, it } from 'vitest';

import type { BatchRegion } from '@/types/batch';

import { applyAffine, normalizeSimilarityParams, similarityNormalizedMatrix } from './affine';
import {
  applyRegionStroke,
  isPointInRegion,
  createRegion,
  mapReferenceRegionsToPackage,
  replaceRegions,
  regionsTouchedByStroke,
  subtractRegions,
  unionRegions,
} from './regions';

const region = (id: string, points: BatchRegion['points']): BatchRegion => ({ id, points, colorId: 1 });

const colored = (id: string, colorId: number, points: BatchRegion['points']): BatchRegion => ({
  id,
  points,
  colorId,
});

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

describe('region editing operations', () => {
  const left = colored('left', 1, [
    { x: 0.1, y: 0.1 },
    { x: 0.4, y: 0.1 },
    { x: 0.4, y: 0.4 },
    { x: 0.1, y: 0.4 },
  ]);
  const right = colored('right', 2, [
    { x: 0.3, y: 0.1 },
    { x: 0.6, y: 0.1 },
    { x: 0.6, y: 0.4 },
    { x: 0.3, y: 0.4 },
  ]);
  const island = colored('island', 3, [
    { x: 0.2, y: 0.2 },
    { x: 0.3, y: 0.2 },
    { x: 0.3, y: 0.3 },
    { x: 0.2, y: 0.3 },
  ]);

  it('merges two overlapping regions into one outline of the active class', () => {
    const merged = unionRegions([left, right], 4);

    expect(merged).toHaveLength(1);
    expect(merged[0].colorId).toBe(4);
    expect(isPointInRegion({ x: 0.5, y: 0.25 }, merged[0])).toBe(true);
    expect(isPointInRegion({ x: 0.05, y: 0.25 }, merged[0])).toBe(false);
  });

  it('cuts one region out of another and keeps the base class', () => {
    const cut = subtractRegions(left, [island]);

    expect(cut.length).toBeGreaterThan(0);
    expect(cut.every((region) => region.colorId === 1)).toBe(true);
    // The removed island is now a hole in the outline.
    expect(isPointInRegion({ x: 0.25, y: 0.25 }, cut[0])).toBe(false);
    expect(isPointInRegion({ x: 0.15, y: 0.35 }, cut[0])).toBe(true);
  });

  it('leaves the base region alone when there is nothing to cut', () => {
    const untouched = subtractRegions(left, []);

    expect(untouched).toHaveLength(1);
    expect(untouched[0].id).toBe('left');
  });

  it('replaces the listed regions while keeping the painting order', () => {
    const merged = unionRegions([left, right], 4);
    const next = replaceRegions([left, right, island], ['left', 'right'], merged);

    expect(next.map((region) => region.id)).toEqual([island.id, merged[0].id]);
  });
});

describe('applyRegionStroke', () => {
  const red = colored('red', 1, [
    { x: 0.1, y: 0.1 },
    { x: 0.3, y: 0.1 },
    { x: 0.3, y: 0.3 },
    { x: 0.1, y: 0.3 },
  ]);
  const blue = colored('blue', 2, [
    { x: 0.5, y: 0.5 },
    { x: 0.6, y: 0.5 },
    { x: 0.6, y: 0.6 },
    { x: 0.5, y: 0.6 },
  ]);
  const touchingStroke = colored('stroke', 1, [
    { x: 0.25, y: 0.15 },
    { x: 0.45, y: 0.15 },
    { x: 0.45, y: 0.25 },
    { x: 0.25, y: 0.25 },
  ]);

  it('merges a stroke into the regions of the active colour only', () => {
    const next = applyRegionStroke([red, blue], touchingStroke, 'merge', 1);

    expect(next.map((region) => region.colorId)).toEqual([2, 1]);
    const mergedRed = next[1];
    expect(isPointInRegion({ x: 0.35, y: 0.2 }, mergedRed)).toBe(true);
    expect(isPointInRegion({ x: 0.15, y: 0.15 }, mergedRed)).toBe(true);
    expect(next[0]).toBe(blue);
  });

  it('lets a new colour paint over the regions underneath it', () => {
    // A red region and a blue stroke that covers its right half.
    const blueStroke = colored('blue-stroke', 2, [
      { x: 0.2, y: 0.05 },
      { x: 0.35, y: 0.05 },
      { x: 0.35, y: 0.35 },
      { x: 0.2, y: 0.35 },
    ]);
    const next = applyRegionStroke([red], blueStroke, 'merge', 2);

    const trimmedRed = next.find((region) => region.colorId === 1)!;
    const blueRegion = next.find((region) => region.colorId === 2)!;

    // Red keeps only the part the new colour did not cover…
    expect(isPointInRegion({ x: 0.15, y: 0.2 }, trimmedRed)).toBe(true);
    expect(isPointInRegion({ x: 0.28, y: 0.2 }, trimmedRed)).toBe(false);
    // …and blue owns the overlap.
    expect(isPointInRegion({ x: 0.28, y: 0.2 }, blueRegion)).toBe(true);
  });

  it('leaves regions of the drawn colour untouched when they do not overlap', () => {
    const farStroke = colored('far', 1, [
      { x: 0.7, y: 0.7 },
      { x: 0.8, y: 0.7 },
      { x: 0.8, y: 0.8 },
      { x: 0.7, y: 0.8 },
    ]);
    const next = applyRegionStroke([red, blue], farStroke, 'merge', 1);

    expect(next[0]).toBe(blue);
    expect(next[1].colorId).toBe(1);
  });

  it('starts a new region when the active colour has none yet', () => {
    const next = applyRegionStroke([red], touchingStroke, 'merge', 3);

    expect(next).toHaveLength(2);
    expect(next.map((region) => region.colorId).sort()).toEqual([1, 3]);
  });

  it('cuts a stroke out of every region it touches', () => {
    const hole = colored('hole', 1, [
      { x: 0.15, y: 0.15 },
      { x: 0.25, y: 0.15 },
      { x: 0.25, y: 0.25 },
      { x: 0.15, y: 0.25 },
    ]);
    const next = applyRegionStroke([red, blue], hole, 'cut', 1);

    expect(isPointInRegion({ x: 0.2, y: 0.2 }, next[0])).toBe(false);
    expect(isPointInRegion({ x: 0.12, y: 0.12 }, next[0])).toBe(true);
    // The untouched region keeps its identity.
    expect(next[1]).toBe(blue);
  });
});
