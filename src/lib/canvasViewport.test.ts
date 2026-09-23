import { describe, expect, it } from 'vitest';

import { computeBaseView, computeZoomTransform, getTransform } from './canvasViewport';

describe('computeZoomTransform', () => {
  // A square-ish viewport: the fitted view is 600x600 inside an 800x600 rect.
  const base = computeBaseView({ width: 800, height: 600 }, 1);

  const pointUnderScreen = (
    zoom: number,
    pan: { x: number; y: number },
    norm: { x: number; y: number },
  ) => {
    const transform = getTransform(base, zoom, pan);
    if (!transform) throw new Error('expected a transform');

    return {
      x: transform.originX + norm.x * transform.width,
      y: transform.originY + norm.y * transform.height,
    };
  };

  it('keeps the image point under the pointer when anchored', () => {
    const anchorNorm = { x: 0.25, y: 0.75 };
    const anchorScreen = { x: 220, y: 430 };
    const next = computeZoomTransform(base, 2.5, anchorNorm, anchorScreen);
    expect(next).not.toBeNull();

    const after = pointUnderScreen(next!.zoom, next!.pan, anchorNorm);
    expect(after.x).toBeCloseTo(anchorScreen.x, 6);
    expect(after.y).toBeCloseTo(anchorScreen.y, 6);
  });

  it('grows out of the centre when no anchor is given', () => {
    const next = computeZoomTransform(base, 2, undefined, undefined);
    expect(next).not.toBeNull();

    const centre = pointUnderScreen(next!.zoom, next!.pan, { x: 0.5, y: 0.5 });
    expect(centre.x).toBeCloseTo((base?.viewX ?? 0) + (base?.viewWidth ?? 0) / 2, 6);
    expect(centre.y).toBeCloseTo((base?.viewY ?? 0) + (base?.viewHeight ?? 0) / 2, 6);
  });

  it('holds the anchor from an already panned and zoomed view', () => {
    const zoom = 1.8;
    const pan = { x: -40, y: 25 };
    const anchorScreen = { x: 300, y: 200 };
    const before = getTransform(base, zoom, pan);
    if (!before) throw new Error('expected a transform');

    const anchorNorm = {
      x: (anchorScreen.x - before.originX) / before.width,
      y: (anchorScreen.y - before.originY) / before.height,
    };
    const next = computeZoomTransform(base, zoom * 1.1, anchorNorm, anchorScreen);
    expect(next).not.toBeNull();

    const after = pointUnderScreen(next!.zoom, next!.pan, anchorNorm);
    expect(after.x).toBeCloseTo(anchorScreen.x, 6);
    expect(after.y).toBeCloseTo(anchorScreen.y, 6);
  });

  it('clamps the zoom to the supported range', () => {
    const anchorNorm = { x: 0.4, y: 0.4 };
    const anchorScreen = { x: 320, y: 240 };

    expect(computeZoomTransform(base, 10_000, anchorNorm, anchorScreen)?.zoom).toBe(20);
    expect(computeZoomTransform(base, 0.0001, anchorNorm, anchorScreen)?.zoom).toBe(0.2);
  });
});
