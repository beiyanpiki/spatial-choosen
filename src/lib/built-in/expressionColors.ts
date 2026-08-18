import type { ProjectedSpot } from '@/types/built-in';

/**
 * Normalize `Log2_nGene_Spatial` values to [0, 1] with a min-max scale over
 * the values actually present on the given (projected) spots, keyed by spot
 * id. Spots without an imported value are omitted, so the canvas falls back
 * to the neutral fill. A degenerate range (all values equal) maps every value
 * to the scale midpoint; an empty input produces an empty map.
 */
export function buildNormalizedExpressionById(args: {
  log2nGeneByPosition: Record<string, number>;
  spots: ProjectedSpot[];
}): Map<string, number> {
  const { log2nGeneByPosition, spots } = args;
  const valuesByPosition = log2nGeneByPosition ?? {};
  const rawBySpotId = new Map<string, number>();
  for (const spot of spots) {
    const value = valuesByPosition[`${spot.arrayRow}:${spot.arrayCol}`];
    if (typeof value === 'number' && Number.isFinite(value)) {
      rawBySpotId.set(spot.id, value);
    }
  }
  if (rawBySpotId.size === 0) {
    return new Map();
  }

  let min = Infinity;
  let max = -Infinity;
  for (const value of rawBySpotId.values()) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min;

  const normalizedById = new Map<string, number>();
  for (const [id, value] of rawBySpotId) {
    normalizedById.set(id, range > 0 ? (value - min) / range : 0.5);
  }
  return normalizedById;
}

const HEATMAP_STOPS: ReadonlyArray<{ position: number; red: number; green: number; blue: number }> = [
  { position: 0, red: 0x31, green: 0x36, blue: 0x95 }, // dark blue
  { position: 0.25, red: 0x45, green: 0x75, blue: 0xb4 }, // blue
  { position: 0.5, red: 0xfe, green: 0xe0, blue: 0x90 }, // yellow
  { position: 0.75, red: 0xfc, green: 0x8d, blue: 0x59 }, // orange
  { position: 1, red: 0xd7, green: 0x30, blue: 0x27 }, // red
];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const channelHex = (value: number) => Math.round(value).toString(16).padStart(2, '0');

/**
 * Map a normalized [0, 1] expression value to an 8-digit hex color
 * (`#rrggbbaa`, alpha as a hex suffix) by linearly interpolating through the
 * cold-to-hot gradient. Out-of-range values are clamped.
 */
export function heatmapColor(normalized: number, alphaHex = 'e6'): string {
  const t = clamp01(normalized);
  let lower = HEATMAP_STOPS[0];
  let upper = HEATMAP_STOPS[HEATMAP_STOPS.length - 1];
  for (let index = 0; index < HEATMAP_STOPS.length - 1; index += 1) {
    if (t >= HEATMAP_STOPS[index].position && t <= HEATMAP_STOPS[index + 1].position) {
      lower = HEATMAP_STOPS[index];
      upper = HEATMAP_STOPS[index + 1];
      break;
    }
  }

  const span = upper.position - lower.position;
  const blend = span > 0 ? (t - lower.position) / span : 0;
  const channel = (key: 'red' | 'green' | 'blue') =>
    channelHex(lower[key] + (upper[key] - lower[key]) * blend);

  return `#${channel('red')}${channel('green')}${channel('blue')}${alphaHex}`;
}
