import { describe, expect, it } from 'vitest';
import {
  buildChannelIntegralImages,
  computeChannelValue,
  computeDarkness,
  computeRawSaturation,
  computeStainStrength,
  otsuThresholdFromHistogram,
  otsuWithSeparation,
  selectAutoChannel,
  TISSUE_CHANNEL_IDS,
} from './tissueMask';

const WHITE: readonly [number, number, number] = [250, 250, 250];
const EOSIN_TISSUE: readonly [number, number, number] = [220, 120, 180];

const buildImageData = (
  pixels: Array<readonly [number, number, number]>,
  width: number,
) => {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((pixel, index) => {
    const offset = index * 4;
    data[offset] = pixel[0];
    data[offset + 1] = pixel[1];
    data[offset + 2] = pixel[2];
    data[offset + 3] = 255;
  });
  return { data, width, height: pixels.length / width };
};

describe('channel value helpers', () => {
  it('maps eosin pink to positive stain values that grow with intensity', () => {
    expect(computeStainStrength(220, 120, 180)).toBeGreaterThan(0);
    expect(computeStainStrength(220, 120, 180)).toBeGreaterThan(computeStainStrength(235, 175, 210));
  });

  it('maps grey and black regions to exactly zero stain regardless of brightness', () => {
    expect(computeStainStrength(255, 255, 255)).toBe(0);
    expect(computeStainStrength(128, 128, 128)).toBe(0);
    expect(computeStainStrength(30, 30, 30)).toBe(0);
    expect(computeStainStrength(255, 0, 0)).toBe(0);
  });

  it('computes saturation and darkness with higher meaning more tissue-like', () => {
    expect(computeRawSaturation(220, 120, 180)).toBeGreaterThan(computeRawSaturation(250, 250, 250));
    expect(computeDarkness(220, 120, 180)).toBeGreaterThan(computeDarkness(250, 250, 250));
    expect(computeDarkness(60, 60, 60)).toBeCloseTo(195, 5);
  });

  it('exposes the same three channels everywhere', () => {
    expect(TISSUE_CHANNEL_IDS).toEqual(['saturation', 'stain', 'darkness']);
    for (const channel of TISSUE_CHANNEL_IDS) {
      expect(computeChannelValue(channel, 0, 0, 0)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('buildChannelIntegralImages', () => {
  it('yields exact windowed means over a small image', () => {
    // 2x2 image: two white pixels and two eosin pixels.
    const { data, width, height } = buildImageData([
      WHITE, EOSIN_TISSUE,
      EOSIN_TISSUE, WHITE,
    ], 2);
    const integrals = buildChannelIntegralImages(data, width, height);

    const mean = (channel: 'saturation' | 'stain' | 'darkness') => {
      const { integral, stride } = integrals[channel];
      return integral[2 * stride + 2] / 4;
    };

    const expectedSaturation = (
      2 * computeRawSaturation(...WHITE)
      + 2 * computeRawSaturation(...EOSIN_TISSUE)
    ) / 4;
    expect(mean('saturation')).toBeCloseTo(expectedSaturation, 6);

    const expectedDarkness = (
      2 * computeDarkness(...WHITE)
      + 2 * computeDarkness(...EOSIN_TISSUE)
    ) / 4;
    expect(mean('darkness')).toBeCloseTo(expectedDarkness, 6);
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

describe('otsuWithSeparation', () => {
  it('scores a bimodal distribution with high separation and a threshold between modes', () => {
    const values = new Float64Array([
      ...new Array(50).fill(5),
      ...new Array(50).fill(120),
    ]);

    const { threshold, separation } = otsuWithSeparation(values);
    expect(threshold).toBeGreaterThan(5);
    expect(threshold).toBeLessThanOrEqual(120);
    expect(separation).toBeGreaterThan(0.9);
  });

  it('scores a uniform ramp lower than a clean bimodal split', () => {
    const ramp = new Float64Array(
      Array.from({ length: 100 }, (_unused, index) => 50 + index * 0.1),
    );
    const bimodal = new Float64Array([
      ...new Array(50).fill(5),
      ...new Array(50).fill(120),
    ]);

    const rampSeparation = otsuWithSeparation(ramp).separation;
    const bimodalSeparation = otsuWithSeparation(bimodal).separation;
    expect(bimodalSeparation).toBeGreaterThan(rampSeparation);
    expect(bimodalSeparation).toBeGreaterThan(0.9);
  });

  it('returns zero separation for uniform values', () => {
    const { threshold, separation } = otsuWithSeparation(new Float64Array(20).fill(0));
    expect(separation).toBe(0);
    expect(threshold).toBe(0);
  });

  it('handles empty input', () => {
    expect(otsuWithSeparation(new Float64Array(0))).toEqual({ threshold: 255, separation: 0 });
  });
});

describe('selectAutoChannel', () => {
  it('picks the channel whose spot means separate best', () => {
    const selection = selectAutoChannel({
      // Saturation is cleanly bimodal; darkness is uniform.
      saturation: new Float64Array([...new Array(40).fill(10), ...new Array(40).fill(100)]),
      stain: new Float64Array(80).fill(0),
      darkness: new Float64Array(80).fill(3),
    });

    expect(selection?.channel).toBe('saturation');
    expect(selection?.threshold).toBeGreaterThan(10);
    expect(selection?.threshold).toBeLessThanOrEqual(100);
  });

  it('returns null when no channel separates well enough', () => {
    const selection = selectAutoChannel({
      saturation: new Float64Array(50).fill(4),
      stain: new Float64Array(50).fill(0),
      darkness: new Float64Array(50).fill(128),
    });

    expect(selection).toBeNull();
  });

  it('returns null when the foreground class would be a vanishing minority', () => {
    // 1 of 200 spots above the threshold: below MIN_FOREGROUND_FRACTION.
    const values = new Float64Array(200);
    values.fill(10);
    values[42] = 200;

    const selection = selectAutoChannel({
      saturation: values,
      stain: new Float64Array(200).fill(0),
      darkness: new Float64Array(200).fill(0),
    });

    expect(selection).toBeNull();
  });

  it('skips channels with no values', () => {
    const selection = selectAutoChannel({
      saturation: new Float64Array([...new Array(30).fill(2), ...new Array(30).fill(90)]),
      stain: new Float64Array(0),
      darkness: new Float64Array(60).fill(0),
    });

    expect(selection?.channel).toBe('saturation');
  });
});
