/**
 * Tissue-channel statistics and automatic Otsu classification for the eosin
 * crop, in the granularity the decision is actually made at: per projected
 * spot.
 *
 * The auto pipeline computes, for every spot, the mean of three stain-sensitive
 * channels over the spot's pixel bounds:
 *
 * - saturation: any colored stain vs white/grey background — also the channel
 *   that carries the signal on the instrument's low-contrast eosin reference
 *   scans, whose global pixel histogram is nearly unimodal but whose
 *   spot-level saturation separates cleanly;
 * - stain ("pinkness", Schreiber et al., Sci Rep 2024): eosin-specific,
 *   maps grey/black to exactly 0;
 * - darkness: darker tissue on bright background (the classic brightfield
 *   assumption behind Space Ranger-class pipelines).
 *
 * Each channel's spot-mean distribution is split with Otsu; the channel whose
 * classes separate best wins. Spots in the foreground class are selected, and
 * isolated groups that survive the threshold — background patches whose
 * statistics resemble tissue — are removed afterwards by a grid-level
 * connected-component filter (tissueCleanup.applyRelativeComponentFilter).
 * No channel choice or threshold is exposed to the user.
 *
 * All functions are DOM-free and operate on flat typed arrays, which keeps
 * them unit-testable in Node.
 */

export type TissueChannelId = 'saturation' | 'stain' | 'darkness';

export const TISSUE_CHANNEL_IDS: readonly TissueChannelId[] = ['saturation', 'stain', 'darkness'] as const;

/**
 * Minimum Otsu separation for a channel to count as carrying any signal.
 * Uniform images (zero variance) score 0; any real texture scores well above
 * this floor, so it only guards the degenerate case.
 */
export const MIN_CHANNEL_SEPARATION = 0.05;

/**
 * Minimum fraction of spots in the Otsu foreground class. A split that
 * isolates a vanishing minority carries no tissue information.
 */
export const MIN_FOREGROUND_FRACTION = 0.01;

export type ChannelIntegralImages = Record<
  TissueChannelId,
  { integral: Float64Array; stride: number }
>;

export type OtsuSeparation = {
  threshold: number;
  /** Between-class variance divided by total variance, in [0, 1]. */
  separation: number;
};

export type AutoChannelSelection = OtsuSeparation & {
  channel: TissueChannelId;
};

export const computeRawSaturation = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  if (max === 0) {
    return 0;
  }

  const min = Math.min(r, g, b);
  return ((max - min) / max) * 255;
};

/**
 * Eosin "pinkness" stain strength in 0..255 (Schreiber et al., Sci Rep 2024).
 * Grey/black map to exactly 0; pink and purple (eosin and hematoxylin) map to
 * positive values that grow with stain intensity.
 */
export const computeStainStrength = (r: number, g: number, b: number) => {
  const redOverGreen = Math.max(r - g, 0);
  const blueOverGreen = Math.max(b - g, 0);
  return (redOverGreen * blueOverGreen) / 255;
};

/** 255 - mean intensity; tissue is darker than background on brightfield scans. */
export const computeDarkness = (r: number, g: number, b: number) => (
  255 - (r + g + b) / 3
);

/** Per-pixel channel value, each in 0..255 with "higher = more tissue-like". */
export const computeChannelValue = (channel: TissueChannelId, r: number, g: number, b: number) => {
  if (channel === 'saturation') {
    return computeRawSaturation(r, g, b);
  }

  if (channel === 'stain') {
    return computeStainStrength(r, g, b);
  }

  return computeDarkness(r, g, b);
};

/** Sum-area tables of every channel, for O(1) windowed means per spot. */
export const buildChannelIntegralImages = (
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): ChannelIntegralImages => {
  const stride = width + 1;
  const integrals = {} as Record<TissueChannelId, Float64Array>;
  for (const channel of TISSUE_CHANNEL_IDS) {
    integrals[channel] = new Float64Array((height + 1) * stride);
  }

  for (let py = 0; py < height; py += 1) {
    const rowSums = { saturation: 0, stain: 0, darkness: 0 } as Record<TissueChannelId, number>;
    for (let px = 0; px < width; px += 1) {
      const offset = (py * width + px) * 4;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;

      for (const channel of TISSUE_CHANNEL_IDS) {
        rowSums[channel] += computeChannelValue(channel, r, g, b);
        integrals[channel][(py + 1) * stride + (px + 1)] =
          integrals[channel][py * stride + (px + 1)] + rowSums[channel];
      }
    }
  }

  const result = {} as ChannelIntegralImages;
  for (const channel of TISSUE_CHANNEL_IDS) {
    result[channel] = { integral: integrals[channel], stride };
  }
  return result;
};

/**
 * Classic single-level Otsu over a 256-bin histogram.
 * Returns the lowest bin of the foreground class (values >= threshold).
 */
export const otsuThresholdFromHistogram = (histogram: Uint32Array | Float64Array) => {
  let total = 0;
  let sumAll = 0;
  for (let bin = 0; bin < 256; bin += 1) {
    total += histogram[bin];
    sumAll += bin * histogram[bin];
  }
  if (total === 0) {
    return 255;
  }

  let weightBackground = 0;
  let sumBackground = 0;
  let bestThreshold = 255;
  let bestVariance = -1;

  for (let bin = 0; bin < 256; bin += 1) {
    weightBackground += histogram[bin];
    if (weightBackground === 0) {
      continue;
    }

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) {
      break;
    }

    sumBackground += bin * histogram[bin];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      // Foreground starts one bin above the current background bin.
      bestThreshold = bin + 1;
    }
  }

  return bestThreshold;
};

/**
 * Otsu over an arbitrary set of continuous values, scored by how well the two
 * classes separate: between-class variance divided by total variance. A
 * unimodal distribution scores near 0 (no tissue signal); a clean bimodal
 * split approaches 1.
 */
export const otsuWithSeparation = (values: Float64Array | number[]): OtsuSeparation => {
  const count = values.length;
  if (count === 0) {
    return { threshold: 255, separation: 0 };
  }

  let min = Infinity;
  let max = -Infinity;
  let mean = 0;
  for (let index = 0; index < count; index += 1) {
    const value = values[index];
    if (value < min) min = value;
    if (value > max) max = value;
    mean += value;
  }
  mean /= count;

  let totalVariance = 0;
  for (let index = 0; index < count; index += 1) {
    totalVariance += (values[index] - mean) ** 2;
  }
  totalVariance /= count;

  if (max <= min || totalVariance <= Number.EPSILON) {
    return { threshold: max, separation: 0 };
  }

  // Discretize into 256 bins over [min, max] for the histogram-based search.
  const scale = 255 / (max - min);
  const histogram = new Float64Array(256);
  for (let index = 0; index < count; index += 1) {
    const bin = Math.min(255, Math.floor((values[index] - min) * scale));
    histogram[bin] += 1;
  }

  const binThreshold = otsuThresholdFromHistogram(histogram);
  const threshold = min + binThreshold / scale;

  // Between-class variance at the winning split, normalized by total variance.
  let weightBackground = 0;
  let sumBackground = 0;
  let betweenVariance = 0;
  for (let bin = 0; bin < 256; bin += 1) {
    if (bin === binThreshold) {
      const weightForeground = count - weightBackground;
      if (weightBackground > 0 && weightForeground > 0) {
        const meanBackground = sumBackground / weightBackground;
        const meanForeground = (mean * count - sumBackground) / weightForeground;
        betweenVariance = (weightBackground / count) * (weightForeground / count)
          * (meanBackground - meanForeground) ** 2;
      }
      break;
    }
    weightBackground += histogram[bin];
    sumBackground += (min + (bin + 0.5) / scale) * histogram[bin];
  }

  return { threshold, separation: Math.min(1, betweenVariance / totalVariance) };
};

/**
 * Picks the tissue channel whose spot-mean distribution separates best and
 * returns its Otsu threshold. Returns null when no channel offers a usable
 * split (no variance, or a foreground class of effectively zero spots) — the
 * caller treats that as "no tissue signal" rather than guessing.
 */
export const selectAutoChannel = (
  spotMeans: Record<TissueChannelId, Float64Array | number[]>,
): AutoChannelSelection | null => {
  let best: AutoChannelSelection | null = null;

  for (const channel of TISSUE_CHANNEL_IDS) {
    const values = spotMeans[channel];
    if (!values || values.length === 0) {
      continue;
    }

    const { threshold, separation } = otsuWithSeparation(values);
    if (separation < MIN_CHANNEL_SEPARATION) {
      continue;
    }

    let foregroundCount = 0;
    for (let index = 0; index < values.length; index += 1) {
      if (values[index] >= threshold) {
        foregroundCount += 1;
      }
    }
    if (foregroundCount / values.length < MIN_FOREGROUND_FRACTION) {
      continue;
    }

    if (!best || separation > best.separation) {
      best = { channel, threshold, separation };
    }
  }

  return best;
};
