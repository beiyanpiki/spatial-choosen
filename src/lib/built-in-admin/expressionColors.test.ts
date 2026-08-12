import { describe, expect, it } from 'vitest';

import type { ProjectedSpot } from '@/types/built-in-admin';
import { buildNormalizedExpressionById, heatmapColor } from './expressionColors';

const createSpot = (id: string, arrayRow: number, arrayCol: number): ProjectedSpot => ({
  id,
  barcode: id,
  arrayRow,
  arrayCol,
  x: 0.5,
  y: 0.5,
  width: 0.1,
  height: 0.1,
  diameterX: 0.1,
  diameterY: 0.1,
});

describe('buildNormalizedExpressionById', () => {
  it('min-max normalizes values over the spots present', () => {
    const normalized = buildNormalizedExpressionById({
      log2nGeneByPosition: { '1:1': 2, '1:2': 6, '2:1': 4 },
      spots: [
        createSpot('a', 1, 1),
        createSpot('b', 1, 2),
        createSpot('c', 2, 1),
      ],
    });

    expect(normalized.get('a')).toBe(0);
    expect(normalized.get('b')).toBe(1);
    expect(normalized.get('c')).toBe(0.5);
  });

  it('omits spots without an imported value', () => {
    const normalized = buildNormalizedExpressionById({
      log2nGeneByPosition: { '1:1': 2 },
      spots: [createSpot('a', 1, 1), createSpot('b', 2, 2)],
    });

    expect(normalized.has('a')).toBe(true);
    expect(normalized.has('b')).toBe(false);
  });

  it('returns an empty map for no data or no spots', () => {
    expect(buildNormalizedExpressionById({ log2nGeneByPosition: {}, spots: [] }).size).toBe(0);
    expect(
      buildNormalizedExpressionById({
        log2nGeneByPosition: { '1:1': 2 },
        spots: [createSpot('a', 2, 2)],
      }).size,
    ).toBe(0);
  });

  it('maps a degenerate range to the scale midpoint', () => {
    const normalized = buildNormalizedExpressionById({
      log2nGeneByPosition: { '1:1': 5, '1:2': 5 },
      spots: [createSpot('a', 1, 1), createSpot('b', 1, 2)],
    });

    expect(normalized.get('a')).toBe(0.5);
    expect(normalized.get('b')).toBe(0.5);
  });
});

describe('heatmapColor', () => {
  it('maps the gradient endpoints and midpoint', () => {
    expect(heatmapColor(0)).toBe('#313695e6');
    expect(heatmapColor(1)).toBe('#d73027e6');
    expect(heatmapColor(0.5)).toBe('#fee090e6');
  });

  it('interpolates between adjacent stops', () => {
    // Midway between the dark-blue (0) and blue (0.25) stops.
    expect(heatmapColor(0.125)).toBe('#3b56a5e6');
  });

  it('clamps out-of-range values', () => {
    expect(heatmapColor(-0.5)).toBe('#313695e6');
    expect(heatmapColor(1.5)).toBe('#d73027e6');
  });

  it('accepts a custom alpha suffix', () => {
    expect(heatmapColor(0, '80')).toBe('#31369580');
  });
});
