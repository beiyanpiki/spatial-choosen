import { describe, expect, it } from 'vitest';

import { contentBoundsFromPixels } from './imagePreview';

const BACKGROUND = 240;
const TISSUE = 120;

/**
 * Builds RGBA pixels for a canvas where `isTissue(x, y)` marks the sample.
 */
const buildPixels = (
  width: number,
  height: number,
  isTissue: (x: number, y: number) => boolean,
) => {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = isTissue(x, y) ? TISSUE : BACKGROUND;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }

  return data;
};

describe('contentBoundsFromPixels', () => {
  it('trims an empty band above the tissue', () => {
    // 100x100, tissue only inside rows/columns 30..69.
    const data = buildPixels(100, 100, (x, y) => x >= 30 && x <= 69 && y >= 30 && y <= 69);
    const bounds = contentBoundsFromPixels(data, 100, 100);

    expect(bounds).not.toBeNull();
    // 1.5% margin is added around the detected rows/columns.
    expect(bounds!.y).toBeCloseTo(0.28, 3);
    expect(bounds!.x).toBeCloseTo(0.28, 3);
    expect(bounds!.height).toBeCloseTo(0.44, 3);
    expect(bounds!.width).toBeCloseTo(0.44, 3);
  });

  it('ignores scattered specks in the slide background', () => {
    const data = buildPixels(100, 100, (x, y) => {
      const inTissue = x >= 40 && x <= 59 && y >= 40 && y <= 59;
      // Two lone dark pixels far away from the sample.
      const speck = (x === 2 && y === 2) || (x === 97 && y === 95);
      return inTissue || speck;
    });
    const bounds = contentBoundsFromPixels(data, 100, 100);

    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThan(0.3);
    expect(bounds!.x + bounds!.width).toBeLessThan(0.75);
  });

  it('reports nothing when the sample fills the frame', () => {
    expect(contentBoundsFromPixels(buildPixels(50, 50, () => true), 50, 50)).toBeNull();
  });

  it('reports nothing for a blank slide', () => {
    expect(contentBoundsFromPixels(buildPixels(50, 50, () => false), 50, 50)).toBeNull();
  });

  it('rejects payloads that do not match the declared size', () => {
    expect(contentBoundsFromPixels(new Uint8ClampedArray(16), 50, 50)).toBeNull();
  });
});
