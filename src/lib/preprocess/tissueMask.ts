/**
 * Pure image-space tissue-mask primitives for the eosin crop.
 *
 * The default auto detection combines the community-standard tissue mask
 * recipe — automatic Otsu thresholding of a stain-sensitive channel followed
 * by morphological closing, hole filling and connected-component area
 * filtering (as in CLAM, ratiopath, wsiTools and HistomicsTK) — with two
 * robustness additions aimed at the classic failure mode where background
 * regions with stain-like statistics get flagged as tissue:
 *
 * 1. The stain channel is the eosin "pinkness" transform
 *      T = max(R - G, 0) * max(B - G, 0)
 *    from Schreiber et al., Sci Rep 2024 ("Rapid artefact removal and
 *    H&E-stained tissue segmentation"). Grey and black regions (scanner
 *    borders, pen marks, dust) map to exactly zero regardless of brightness,
 *    which keeps Otsu's bimodal assumption intact.
 * 2. Two-level Otsu plus hysteresis: only pixels at least as stained as the
 *    strong class, or weak pixels touching a strong region, survive — so a
 *    diffuse background patch that merely resembles the stain is dropped
 *    unless it is physically connected to real tissue.
 *
 * Every geometric parameter is derived from the projected spot pitch, so no
 * per-image tuning is required.
 *
 * All functions are DOM-free and operate on flat typed arrays, which keeps
 * them unit-testable in Node.
 */

/** Fraction of the largest component's area that a component must reach to survive filtering. */
export const AUTO_COMPONENT_AREA_RATIO = 0.1;

/** Closing radius as a fraction of the projected spot pitch (in pixels). */
export const AUTO_CLOSING_RADIUS_RATIO = 0.4;

/** Minimum component area, in units of spot-pitch cells, before relative filtering applies. */
export const AUTO_MIN_COMPONENT_CELLS = 2;

/** Stain bin above which the histogram must have mass for an image to count as stained. */
const MIN_STAINED_MASS_RATIO = 0.001;
const MIN_STAINED_STRENGTH_BIN = 2;

export type TissueBinaryMask = Uint8Array;

export type AutoTissueMaskOptions = {
  width: number;
  height: number;
  /** Projected spot pitch in mask pixels; drives closing radius and area floors. */
  spotPitchPx: number;
};

export type AutoTissueMaskResult = {
  mask: TissueBinaryMask;
  /** Otsu split between background and weak stain (low) / weak and strong stain (high). */
  lowThreshold: number;
  highThreshold: number;
  /** Whether the image carried enough stain signal to attempt detection at all. */
  hasStainSignal: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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
  return Math.round((redOverGreen * blueOverGreen) / 255);
};

export const computeStainChannel = (
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
) => {
  const stain = new Uint8Array(width * height);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    stain[index] = computeStainStrength(
      data[offset] ?? 0,
      data[offset + 1] ?? 0,
      data[offset + 2] ?? 0,
    );
  }

  return stain;
};

export const buildHistogram = (values: Uint8Array) => {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < values.length; index += 1) {
    histogram[values[index]] += 1;
  }
  return histogram;
};

/**
 * Classic single-level Otsu over a 256-bin histogram.
 * Returns the lowest bin of the foreground class (values >= threshold).
 */
export const otsuThresholdFromHistogram = (histogram: Uint32Array) => {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return 255;
  }

  let sumAll = 0;
  for (let bin = 0; bin < 256; bin += 1) {
    sumAll += bin * histogram[bin];
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
 * Two-level Otsu: the first split separates background from stain, the second
 * splits the stain class again into weak and strong stain. Hysteresis keeps
 * weak-stain pixels only when they touch strong stain, which rejects diffuse
 * background that merely resembles the stain.
 */
export const twoLevelOtsuThresholds = (histogram: Uint32Array) => {
  const low = otsuThresholdFromHistogram(histogram);

  const upperHistogram = new Uint32Array(256);
  for (let bin = low; bin < 256; bin += 1) {
    upperHistogram[bin] = histogram[bin];
  }
  const upperThreshold = otsuThresholdFromHistogram(upperHistogram);

  // 255 is the "no separation" sentinel; a single stain class means there is
  // no distinct strong subset, so hysteresis degenerates to one threshold.
  const high = upperThreshold >= 255 ? low : Math.max(upperThreshold, low);

  return { low, high };
};

/** Separable square dilation (max filter) over a binary mask. */
const dilateMask = (mask: TissueBinaryMask, width: number, height: number, radius: number) => {
  if (radius <= 0) {
    return mask;
  }

  const horizontal = new Uint8Array(width * height);
  for (let py = 0; py < height; py += 1) {
    const rowStart = py * width;
    for (let px = 0; px < width; px += 1) {
      let hit = 0;
      const start = Math.max(0, px - radius);
      const end = Math.min(width - 1, px + radius);
      for (let qx = start; qx <= end && hit === 0; qx += 1) {
        if (mask[rowStart + qx] === 1) {
          hit = 1;
        }
      }
      horizontal[rowStart + px] = hit;
    }
  }

  const output = new Uint8Array(width * height);
  for (let py = 0; py < height; py += 1) {
    const rowStart = py * width;
    for (let px = 0; px < width; px += 1) {
      let hit = 0;
      const start = Math.max(0, py - radius);
      const end = Math.min(height - 1, py + radius);
      for (let qy = start; qy <= end && hit === 0; qy += 1) {
        if (horizontal[qy * width + px] === 1) {
          hit = 1;
        }
      }
      output[rowStart + px] = hit;
    }
  }

  return output;
};

/** Separable square erosion (min filter) over a binary mask. */
const erodeMask = (mask: TissueBinaryMask, width: number, height: number, radius: number) => {
  if (radius <= 0) {
    return mask;
  }

  const horizontal = new Uint8Array(width * height);
  for (let py = 0; py < height; py += 1) {
    const rowStart = py * width;
    for (let px = 0; px < width; px += 1) {
      let all = 1;
      const start = Math.max(0, px - radius);
      const end = Math.min(width - 1, px + radius);
      for (let qx = start; qx <= end; qx += 1) {
        if (mask[rowStart + qx] === 0) {
          all = 0;
          break;
        }
      }
      horizontal[rowStart + px] = all;
    }
  }

  const output = new Uint8Array(width * height);
  for (let py = 0; py < height; py += 1) {
    const rowStart = py * width;
    for (let px = 0; px < width; px += 1) {
      let all = 1;
      const start = Math.max(0, py - radius);
      const end = Math.min(height - 1, py + radius);
      for (let qy = start; qy <= end; qy += 1) {
        if (horizontal[qy * width + px] === 0) {
          all = 0;
          break;
        }
      }
      output[rowStart + px] = all;
    }
  }

  return output;
};

/** Morphological closing: dilate then erode, bridging gaps up to 2*radius. */
export const closeMask = (mask: TissueBinaryMask, width: number, height: number, radius: number) => (
  erodeMask(dilateMask(mask, width, height, radius), width, height, radius)
);

/**
 * Hysteresis selection over two masks: keeps the connected components of
 * (strong ∪ weak) that contain at least one strong pixel.
 */
export const hysteresisMask = (
  strong: TissueBinaryMask,
  weak: TissueBinaryMask,
  width: number,
  height: number,
) => {
  const output = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let queueStart = 0;
  let queueEnd = 0;

  const pushIfCandidate = (index: number) => {
    if (output[index] === 0 && (weak[index] === 1 || strong[index] === 1)) {
      output[index] = 1;
      queue[queueEnd] = index;
      queueEnd += 1;
    }
  };

  for (let index = 0; index < width * height; index += 1) {
    if (strong[index] === 1) {
      pushIfCandidate(index);
    }
  }

  while (queueStart < queueEnd) {
    const index = queue[queueStart];
    queueStart += 1;

    const px = index % width;
    const py = (index - px) / width;

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= width || qy >= height) {
          continue;
        }
        pushIfCandidate(qy * width + qx);
      }
    }
  }

  return output;
};

type ComponentLabeling = {
  labels: Int32Array;
  areas: number[];
};

const labelComponents = (mask: TissueBinaryMask, width: number, height: number): ComponentLabeling => {
  const labels = new Int32Array(width * height).fill(-1);
  const areas: number[] = [];
  const queue = new Int32Array(width * height);

  for (let seed = 0; seed < width * height; seed += 1) {
    if (mask[seed] !== 1 || labels[seed] !== -1) {
      continue;
    }

    const label = areas.length;
    let queueStart = 0;
    let queueEnd = 0;
    labels[seed] = label;
    queue[queueEnd] = seed;
    queueEnd += 1;
    let area = 0;

    while (queueStart < queueEnd) {
      const index = queue[queueStart];
      queueStart += 1;
      area += 1;

      const px = index % width;
      const py = (index - px) / width;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const qx = px + dx;
          const qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= width || qy >= height) {
            continue;
          }
          const neighbor = qy * width + qx;
          if (mask[neighbor] === 1 && labels[neighbor] === -1) {
            labels[neighbor] = label;
            queue[queueEnd] = neighbor;
            queueEnd += 1;
          }
        }
      }
    }

    areas.push(area);
  }

  return { labels, areas };
};

/**
 * Removes components that are both absolutely small (below the spot-pitch
 * floor) and small relative to the dominant component, which is what rejects
 * background regions whose stain statistics resemble real tissue.
 */
export const removeSmallComponents = (
  mask: TissueBinaryMask,
  width: number,
  height: number,
  minArea: number,
) => {
  const { labels, areas } = labelComponents(mask, width, height);
  if (areas.length === 0) {
    return mask;
  }

  let largestArea = 0;
  for (const area of areas) {
    if (area > largestArea) {
      largestArea = area;
    }
  }

  const keepThreshold = Math.max(minArea, Math.ceil(largestArea * AUTO_COMPONENT_AREA_RATIO));
  const output = new Uint8Array(width * height);

  for (let index = 0; index < width * height; index += 1) {
    const label = labels[index];
    if (label >= 0 && areas[label] >= keepThreshold) {
      output[index] = 1;
    }
  }

  return output;
};

/** Fills background regions that are not reachable from the image border. */
export const fillMaskHoles = (mask: TissueBinaryMask, width: number, height: number) => {
  const reachBorder = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let queueStart = 0;
  let queueEnd = 0;

  const pushBackground = (index: number) => {
    if (mask[index] === 0 && reachBorder[index] === 0) {
      reachBorder[index] = 1;
      queue[queueEnd] = index;
      queueEnd += 1;
    }
  };

  for (let px = 0; px < width; px += 1) {
    pushBackground(px);
    pushBackground((height - 1) * width + px);
  }
  for (let py = 0; py < height; py += 1) {
    pushBackground(py * width);
    pushBackground(py * width + width - 1);
  }

  while (queueStart < queueEnd) {
    const index = queue[queueStart];
    queueStart += 1;

    const px = index % width;
    const py = (index - px) / width;

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= width || qy >= height) {
          continue;
        }
        pushBackground(qy * width + qx);
      }
    }
  }

  const output = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    output[index] = mask[index] === 1 || reachBorder[index] === 0 ? 1 : 0;
  }

  return output;
};

/**
 * Full auto mask pipeline over the eosin crop pixels:
 * pinkness stain channel → two-level Otsu → closing → hysteresis → hole fill
 * → area filter.
 */
export const buildAutoTissueMask = (
  data: Uint8ClampedArray | Uint8Array,
  options: AutoTissueMaskOptions,
): AutoTissueMaskResult => {
  const { width, height, spotPitchPx } = options;
  const total = width * height;

  if (total === 0) {
    return {
      mask: new Uint8Array(0),
      lowThreshold: 255,
      highThreshold: 255,
      hasStainSignal: false,
    };
  }

  const stain = computeStainChannel(data, width, height);
  const histogram = buildHistogram(stain);

  let stainedMass = 0;
  for (let bin = MIN_STAINED_STRENGTH_BIN; bin < 256; bin += 1) {
    stainedMass += histogram[bin];
  }

  if (stainedMass / total < MIN_STAINED_MASS_RATIO) {
    return {
      mask: new Uint8Array(total),
      lowThreshold: 255,
      highThreshold: 255,
      hasStainSignal: false,
    };
  }

  const { low, high } = twoLevelOtsuThresholds(histogram);

  const strong = new Uint8Array(total);
  const weak = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    const value = stain[index];
    if (value >= high) {
      strong[index] = 1;
    }
    if (value >= low) {
      weak[index] = 1;
    }
  }

  const radius = clamp(Math.round(spotPitchPx * AUTO_CLOSING_RADIUS_RATIO), 1, 12);
  const closedStrong = closeMask(strong, width, height, radius);
  const hysteretic = hysteresisMask(closedStrong, weak, width, height);
  const filled = fillMaskHoles(hysteretic, width, height);
  const minArea = Math.ceil(spotPitchPx * spotPitchPx * AUTO_MIN_COMPONENT_CELLS);
  const mask = removeSmallComponents(filled, width, height, minArea);

  return { mask, lowThreshold: low, highThreshold: high, hasStainSignal: true };
};
