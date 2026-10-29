import { describe, expect, it } from 'vitest';
import type { ProjectedSpot } from '@/types/preprocess';
import {
  AUTO_COMPONENT_AREA_RATIO,
  AUTO_COMPONENT_MIN_SPOTS,
  applyBoundaryGrowth,
  applyRelativeComponentFilter,
} from './tissueCleanup';

const spot = (id: string, arrayRow: number, arrayCol: number): ProjectedSpot => ({
  id,
  barcode: id,
  arrayRow,
  arrayCol,
  x: arrayCol / 10,
  y: arrayRow / 10,
  width: 0.05,
  height: 0.05,
  diameterX: 0.05,
  diameterY: 0.05,
});

describe('applyBoundaryGrowth', () => {
  it('adds only candidates touching the original selection, exactly one ring', () => {
    const projectedSpots = [
      // Selection: a 2x2 block.
      spot('t1', 1, 1),
      spot('t2', 1, 2),
      spot('t3', 2, 1),
      spot('t4', 2, 2),
      // Candidates adjacent to the block.
      spot('ring-a', 3, 1),
      spot('ring-b', 1, 3),
      // Candidate only adjacent to ring-a: must NOT be added in the same round.
      spot('second-ring', 4, 1),
      // Candidate far away.
      spot('far', 8, 8),
    ];

    const keep = applyBoundaryGrowth({
      projectedSpots,
      selectedIds: new Set(['t1', 't2', 't3', 't4']),
      candidateIds: new Set(['ring-a', 'ring-b', 'second-ring', 'far']),
    });

    expect([...keep].sort()).toEqual(['ring-a', 'ring-b', 't1', 't2', 't3', 't4']);
  });

  it('never grows beyond the selection when no candidate qualifies', () => {
    const keep = applyBoundaryGrowth({
      projectedSpots: [spot('a', 1, 1), spot('b', 1, 2)],
      selectedIds: new Set(['a']),
      candidateIds: new Set<string>(),
    });

    expect([...keep]).toEqual(['a']);
  });
});

describe('applyRelativeComponentFilter', () => {
  it('keeps large components and drops small isolated ones', () => {
    const projectedSpots = [
      // A contiguous 2x2 tissue block.
      spot('t1', 1, 1),
      spot('t2', 1, 2),
      spot('t3', 2, 1),
      spot('t4', 2, 2),
      // A single isolated background speck.
      spot('speck', 8, 8),
    ];

    const keep = applyRelativeComponentFilter({
      projectedSpots,
      selectedIds: new Set(['t1', 't2', 't3', 't4', 'speck']),
    });

    expect([...keep].sort()).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('keeps components at least the absolute floor even when the largest is huge', () => {
    const projectedSpots = [
      ...Array.from({ length: 40 }, (_unused, index) => spot(`big-${index}`, 1 + Math.floor(index / 10), 1 + (index % 10))),
      spot('small', 5, 5),
      spot('small-nb', 6, 5),
      spot('small-nb2', 5, 6),
      spot('small-nb3', 6, 6),
    ];

    const keep = applyRelativeComponentFilter({
      projectedSpots,
      selectedIds: new Set([
        ...projectedSpots.map((entry) => entry.id),
      ]),
    });

    // 5% of 40 is 2, so the absolute floor of 4 decides: the 2x2 block survives.
    expect(keep.size).toBe(44);
    expect(keep.has('small')).toBe(true);
  });

  it('returns the input set unchanged when nothing is selected', () => {
    const keep = applyRelativeComponentFilter({
      projectedSpots: [spot('a', 1, 1)],
      selectedIds: new Set(),
    });
    expect(keep.size).toBe(0);
  });

  it('exposes fixed auto-pipeline constants', () => {
    expect(AUTO_COMPONENT_MIN_SPOTS).toBe(4);
    expect(AUTO_COMPONENT_AREA_RATIO).toBe(0.05);
  });
});
