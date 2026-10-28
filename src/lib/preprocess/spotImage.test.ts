import { describe, expect, it } from 'vitest';

import type { ProjectedSpot, TissueSpotStyle } from '@/types/preprocess';

import {
  computeStandaloneSpotImageFillRects,
  drawStandaloneSpotImage,
  STANDALONE_SPOT_IMAGE_BACKGROUND_COLOR,
  STANDALONE_SPOT_IMAGE_INACTIVE_FILL,
  type StandaloneSpotImageDrawSurface,
} from './spotImage';

const createSpot = (
  id: string,
  x: number,
  y: number,
  side = 0.2,
): ProjectedSpot => ({
  id,
  barcode: id,
  arrayRow: 1,
  arrayCol: 1,
  x,
  y,
  width: side,
  height: side,
  diameterX: side,
  diameterY: side,
});

const spotStyle: TissueSpotStyle = { color: '#FF0000', opacity: 0.4 };

describe('computeStandaloneSpotImageFillRects', () => {
  it('maps normalized spot centers to pixel rects with active and inactive fills', () => {
    const rects = computeStandaloneSpotImageFillRects({
      width: 200,
      height: 100,
      projectedSpots: [
        createSpot('spot-a', 0.5, 0.5, 0.2),
        createSpot('spot-b', 0.25, 0.25, 0.2),
      ],
      selectedSpotIds: ['spot-a'],
      spotStyle,
    });

    // 0.2 normalized side over a 200x100 canvas: 40px wide, 20px tall.
    expect(rects[0]).toEqual({
      x: 0.5 * 200 - 20,
      y: 0.5 * 100 - 10,
      width: 40,
      height: 20,
      fill: '#FF0000',
    });
    expect(rects[1]).toEqual({
      x: 0.25 * 200 - 20,
      y: 0.25 * 100 - 10,
      width: 40,
      height: 20,
      fill: STANDALONE_SPOT_IMAGE_INACTIVE_FILL,
    });
  });

  it('accepts a Set of selected spot ids and legacy diameter-only spots', () => {
    const legacySpot = {
      ...createSpot('legacy-spot', 0.5, 0.5, 0),
      width: undefined,
      height: undefined,
      diameterX: 0.5,
      diameterY: 0.5,
    } as ProjectedSpot;

    const rects = computeStandaloneSpotImageFillRects({
      width: 100,
      height: 100,
      projectedSpots: [legacySpot],
      selectedSpotIds: new Set(['legacy-spot']),
      spotStyle,
    });

    expect(rects[0]).toEqual({
      x: 25,
      y: 25,
      width: 50,
      height: 50,
      fill: '#FF0000',
    });
  });

  it('keeps degenerate spots at least one pixel and falls back to the default style color', () => {
    const rects = computeStandaloneSpotImageFillRects({
      width: 10,
      height: 10,
      projectedSpots: [createSpot('tiny-active', 0.1, 0.1, 0), createSpot('tiny-inactive', 0.9, 0.9, 0)],
      selectedSpotIds: ['tiny-active'],
    });

    expect(rects[0]).toMatchObject({ width: 1, height: 1, fill: '#38A169' });
    expect(rects[1]).toMatchObject({ width: 1, height: 1, fill: STANDALONE_SPOT_IMAGE_INACTIVE_FILL });
  });
});

describe('drawStandaloneSpotImage', () => {
  type RecordedFill = {
    style: string | CanvasGradient | CanvasPattern;
    args: [number, number, number, number];
  };

  const createRecordedSurface = () => {
    const fills: RecordedFill[] = [];
    let currentFill: string | CanvasGradient | CanvasPattern = '';
    const surface: StandaloneSpotImageDrawSurface = {
      get fillStyle() {
        return currentFill;
      },
      set fillStyle(value: string | CanvasGradient | CanvasPattern) {
        currentFill = value;
      },
      fillRect(x: number, y: number, width: number, height: number) {
        fills.push({ style: currentFill, args: [x, y, width, height] });
      },
    };

    return { surface, fills };
  };

  it('paints the background first, then each spot rect with its fill', () => {
    const { surface, fills } = createRecordedSurface();

    drawStandaloneSpotImage(surface, {
      width: 100,
      height: 80,
      projectedSpots: [
        createSpot('spot-a', 0.5, 0.5, 0.2),
        createSpot('spot-b', 0.2, 0.2, 0.2),
      ],
      selectedSpotIds: ['spot-b'],
      spotStyle,
    });

    expect(fills).toEqual([
      { style: STANDALONE_SPOT_IMAGE_BACKGROUND_COLOR, args: [0, 0, 100, 80] },
      { style: STANDALONE_SPOT_IMAGE_INACTIVE_FILL, args: [40, 32, 20, 16] },
      { style: '#FF0000', args: [10, 8, 20, 16] },
    ]);
  });
});
