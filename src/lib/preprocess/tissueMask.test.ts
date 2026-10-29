import { describe, expect, it } from 'vitest';
import {
  buildAutoTissueMask,
  closeMask,
  computeStainStrength,
  fillMaskHoles,
  hysteresisMask,
  otsuThresholdFromHistogram,
  removeSmallComponents,
  twoLevelOtsuThresholds,
} from './tissueMask';

type Rect = {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
};

const WHITE: readonly [number, number, number] = [250, 250, 250];
const EOSIN_TISSUE: readonly [number, number, number] = [220, 120, 180];
const EOSIN_RESIDUE: readonly [number, number, number] = [235, 175, 210];
const GREY_ARTIFACT: readonly [number, number, number] = [128, 128, 128];
const BLACK_ARTIFACT: readonly [number, number, number] = [30, 30, 30];

const buildImageData = (args: {
  width: number;
  height: number;
  fill?: readonly [number, number, number];
  rectangles?: Array<Rect & { color: readonly [number, number, number] }>;
}) => {
  const [fr, fg, fb] = args.fill ?? WHITE;
  const data = new Uint8ClampedArray(args.width * args.height * 4);

  for (let index = 0; index < args.width * args.height; index += 1) {
    const offset = index * 4;
    data[offset] = fr;
    data[offset + 1] = fg;
    data[offset + 2] = fb;
    data[offset + 3] = 255;
  }

  for (const rect of args.rectangles ?? []) {
    for (let py = Math.max(0, rect.startY); py < Math.min(args.height, rect.endY); py += 1) {
      for (let px = Math.max(0, rect.startX); px < Math.min(args.width, rect.endX); px += 1) {
        const offset = (py * args.width + px) * 4;
        data[offset] = rect.color[0];
        data[offset + 1] = rect.color[1];
        data[offset + 2] = rect.color[2];
        data[offset + 3] = 255;
      }
    }
  }

  return data;
};

const countMaskPixels = (mask: Uint8Array) => {
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 1) {
      count += 1;
    }
  }
  return count;
};

const maskHasValueAt = (mask: Uint8Array, width: number, px: number, py: number) => (
  mask[py * width + px] === 1
);

describe('computeStainStrength', () => {
  it('maps eosin pink to positive values that grow with stain intensity', () => {
    expect(computeStainStrength(220, 120, 180)).toBeGreaterThan(0);
    expect(computeStainStrength(220, 120, 180)).toBeGreaterThan(computeStainStrength(235, 175, 210));
    expect(computeStainStrength(220, 120, 180)).toBeLessThanOrEqual(255);
  });

  it('maps grey and black regions to exactly zero regardless of brightness', () => {
    expect(computeStainStrength(255, 255, 255)).toBe(0);
    expect(computeStainStrength(128, 128, 128)).toBe(0);
    expect(computeStainStrength(30, 30, 30)).toBe(0);
    expect(computeStainStrength(0, 0, 0)).toBe(0);
  });

  it('maps red-only and green-only stain colors to zero', () => {
    expect(computeStainStrength(255, 0, 0)).toBe(0);
    expect(computeStainStrength(0, 255, 0)).toBe(0);
  });
});

describe('otsuThresholdFromHistogram', () => {
  it('splits a bimodal histogram between the two modes', () => {
    const histogram = new Uint32Array(256);
    histogram[3] = 1000;
    histogram[40] = 900;

    const threshold = otsuThresholdFromHistogram(histogram);
    expect(threshold).toBeGreaterThan(3);
    expect(threshold).toBeLessThanOrEqual(40);
  });

  it('returns 255 for an empty histogram', () => {
    expect(otsuThresholdFromHistogram(new Uint32Array(256))).toBe(255);
  });
});

describe('twoLevelOtsuThresholds', () => {
  it('produces a low/high pair that separates three stain classes', () => {
    const histogram = new Uint32Array(256);
    histogram[0] = 6000;
    histogram[10] = 900;
    histogram[20] = 900;

    const { low, high } = twoLevelOtsuThresholds(histogram);
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThanOrEqual(10);
    expect(high).toBeGreaterThan(10);
    expect(high).toBeLessThanOrEqual(20);
  });

  it('falls back to a single threshold when the stain class does not split', () => {
    const histogram = new Uint32Array(256);
    histogram[0] = 6000;
    histogram[8] = 900;
    histogram[24] = 2500;

    const { low, high } = twoLevelOtsuThresholds(histogram);
    expect(high).toBe(low);
    expect(low).toBeGreaterThan(0);
  });

  it('never returns a high threshold below the low threshold', () => {
    const histogram = new Uint32Array(256);
    histogram[10] = 500;

    const { low, high } = twoLevelOtsuThresholds(histogram);
    expect(high).toBeGreaterThanOrEqual(low);
  });
});

describe('closeMask', () => {
  it('bridges gaps narrower than twice the radius', () => {
    const width = 21;
    const height = 5;
    const mask = new Uint8Array(width * height);
    for (let px = 0; px < 8; px += 1) {
      for (let py = 0; py < height; py += 1) {
        mask[py * width + px] = 1;
      }
    }
    for (let px = 13; px < width; px += 1) {
      for (let py = 0; py < height; py += 1) {
        mask[py * width + px] = 1;
      }
    }

    const closed = closeMask(mask, width, height, 3);
    for (let px = 0; px < width; px += 1) {
      expect(maskHasValueAt(closed, width, px, 2)).toBe(true);
    }
  });

  it('leaves gaps wider than twice the radius open', () => {
    const width = 30;
    const height = 5;
    const mask = new Uint8Array(width * height);
    for (let px = 0; px < 10; px += 1) {
      for (let py = 0; py < height; py += 1) {
        mask[py * width + px] = 1;
      }
    }
    for (let px = 22; px < width; px += 1) {
      for (let py = 0; py < height; py += 1) {
        mask[py * width + px] = 1;
      }
    }

    const closed = closeMask(mask, width, height, 3);
    expect(maskHasValueAt(closed, width, 15, 2)).toBe(false);
  });
});

describe('hysteresisMask', () => {
  it('keeps weak pixels attached to strong regions and drops isolated weak blobs', () => {
    const width = 20;
    const height = 5;
    const strong = new Uint8Array(width * height);
    const weak = new Uint8Array(width * height);

    // Strong tissue on the left, weak halo adjacent to it.
    for (let px = 0; px < 6; px += 1) {
      for (let py = 0; py < height; py += 1) {
        strong[py * width + px] = 1;
      }
    }
    for (let px = 6; px < 9; px += 1) {
      for (let py = 0; py < height; py += 1) {
        weak[py * width + px] = 1;
      }
    }
    // Isolated weak blob far away from tissue: the "similar background".
    for (let px = 14; px < 18; px += 1) {
      for (let py = 0; py < height; py += 1) {
        weak[py * width + px] = 1;
      }
    }

    const result = hysteresisMask(strong, weak, width, height);
    expect(maskHasValueAt(result, width, 7, 2)).toBe(true);
    expect(maskHasValueAt(result, width, 16, 2)).toBe(false);
  });
});

describe('fillMaskHoles', () => {
  it('fills enclosed background holes', () => {
    const width = 10;
    const height = 10;
    const mask = new Uint8Array(width * height).fill(1);
    for (let py = 4; py < 6; py += 1) {
      for (let px = 4; px < 6; px += 1) {
        mask[py * width + px] = 0;
      }
    }

    const filled = fillMaskHoles(mask, width, height);
    expect(countMaskPixels(filled)).toBe(width * height);
  });

  it('keeps background that touches the image border', () => {
    const width = 10;
    const height = 10;
    const mask = new Uint8Array(width * height).fill(1);
    for (let py = 0; py < height; py += 1) {
      mask[py * width + 9] = 0;
    }

    const filled = fillMaskHoles(mask, width, height);
    expect(maskHasValueAt(filled, width, 9, 5)).toBe(false);
  });
});

describe('removeSmallComponents', () => {
  it('drops components below both the absolute floor and the relative ratio', () => {
    const width = 50;
    const height = 10;
    const mask = new Uint8Array(width * height);
    for (let px = 0; px < 30; px += 1) {
      for (let py = 0; py < height; py += 1) {
        mask[py * width + px] = 1;
      }
    }
    for (let px = 40; px < 43; px += 1) {
      for (let py = 0; py < 3; py += 1) {
        mask[py * width + px] = 1;
      }
    }

    const filtered = removeSmallComponents(mask, width, height, 10);
    expect(maskHasValueAt(filtered, width, 15, 5)).toBe(true);
    expect(maskHasValueAt(filtered, width, 41, 1)).toBe(false);
  });

  it('keeps a component that satisfies the relative ratio', () => {
    const width = 50;
    const height = 10;
    const mask = new Uint8Array(width * height);
    // Large component: 300 px. Companion: 40 px > ceil(300 * AUTO_COMPONENT_AREA_RATIO).
    for (let px = 0; px < 30; px += 1) {
      for (let py = 0; py < height; py += 1) {
        mask[py * width + px] = 1;
      }
    }
    for (let px = 40; px < 44; px += 1) {
      for (let py = 0; py < height; py += 1) {
        mask[py * width + px] = 1;
      }
    }

    const filtered = removeSmallComponents(mask, width, height, 10);
    expect(maskHasValueAt(filtered, width, 42, 5)).toBe(true);
  });
});

describe('buildAutoTissueMask', () => {
  it('selects real tissue while rejecting similar-looking background patches and grey artifacts', () => {
    const width = 100;
    const height = 100;
    const data = buildImageData({
      width,
      height,
      rectangles: [
        // Real tissue: strongly stained pink region.
        { startX: 10, endX: 60, startY: 10, endY: 60, color: EOSIN_TISSUE },
        // Background with similar (but weaker) stain statistics.
        { startX: 5, endX: 30, startY: 70, endY: 95, color: EOSIN_RESIDUE },
        // Grey and black scanner artifacts.
        { startX: 70, endX: 90, startY: 5, endY: 25, color: GREY_ARTIFACT },
        { startX: 65, endX: 85, startY: 70, endY: 95, color: BLACK_ARTIFACT },
      ],
    });

    const result = buildAutoTissueMask(data, { width, height, spotPitchPx: 8 });

    expect(result.hasStainSignal).toBe(true);
    expect(result.lowThreshold).toBeGreaterThan(0);
    expect(result.highThreshold).toBeGreaterThanOrEqual(result.lowThreshold);

    // Tissue interior stays selected.
    expect(maskHasValueAt(result.mask, width, 35, 35)).toBe(true);
    // Residue patch, grey artifact and black artifact stay background.
    expect(maskHasValueAt(result.mask, width, 17, 82)).toBe(false);
    expect(maskHasValueAt(result.mask, width, 80, 15)).toBe(false);
    expect(maskHasValueAt(result.mask, width, 75, 82)).toBe(false);
  });

  it('returns an empty mask when the image carries no stain signal', () => {
    const width = 20;
    const height = 20;
    const data = buildImageData({ width, height, fill: WHITE });

    const result = buildAutoTissueMask(data, { width, height, spotPitchPx: 8 });
    expect(result.hasStainSignal).toBe(false);
    expect(countMaskPixels(result.mask)).toBe(0);
  });
});
