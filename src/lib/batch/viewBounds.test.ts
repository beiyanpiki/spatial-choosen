import { describe, expect, it } from 'vitest';

import {
  boundsCoverFrame,
  transformBounds,
  unionBounds,
} from './viewBounds';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

const expectBox = (
  actual: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number },
) => {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
  expect(actual.width).toBeCloseTo(expected.width, 10);
  expect(actual.height).toBeCloseTo(expected.height, 10);
};

describe('transformBounds', () => {
  it('keeps a box unchanged under the identity matrix', () => {
    expectBox(transformBounds(box(0.2, 0.3, 0.4, 0.25), [1, 0, 0, 0, 1, 0]), box(0.2, 0.3, 0.4, 0.25));
  });

  it('returns the axis-aligned envelope of a rotated box', () => {
    // 90 degrees about the origin: (x, y) -> (-y, x).
    const rotated = transformBounds(box(0.2, 0.1, 0.3, 0.4), [0, -1, 0, 1, 0, 0]);

    expectBox(rotated, box(-0.5, 0.2, 0.4, 0.3));
  });

  it('follows the translation part of the matrix', () => {
    const moved = transformBounds(box(0, 0, 0.2, 0.2), [1, 0, 0.5, 0, 1, -0.1]);

    expectBox(moved, box(0.5, -0.1, 0.2, 0.2));
  });
});

describe('unionBounds', () => {
  it('covers both boxes', () => {
    expectBox(
      unionBounds(box(0.1, 0.2, 0.2, 0.2), box(0.5, 0.35, 0.3, 0.3)),
      box(0.1, 0.2, 0.7, 0.45),
    );
  });

  it('returns the outer box when one contains the other', () => {
    expectBox(unionBounds(box(0, 0, 1, 1), box(0.4, 0.4, 0.1, 0.1)), box(0, 0, 1, 1));
  });
});

describe('boundsCoverFrame', () => {
  it('detects a box that already fills the frame', () => {
    expect(boundsCoverFrame(box(0, 0, 1, 1))).toBe(true);
    expect(boundsCoverFrame(box(0.05, 0, 0.95, 1))).toBe(false);
  });
});
