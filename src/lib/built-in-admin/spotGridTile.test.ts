import { describe, expect, it, vi } from 'vitest';

import {
  buildNormalizedExpressionByPosition,
  buildSpotGridTile,
  computeGridCellLayout,
  EXCLUDED_CELL_FILL,
  gridSignature,
  NEUTRAL_CELL_FILL,
} from './spotGridTile';

describe('buildNormalizedExpressionByPosition', () => {
  it('normalizes present values over the grid extent', () => {
    const normalized = buildNormalizedExpressionByPosition(
      { '1:1': 8, '2:3': 10, '4:4': 6, '99:1': 99 },
      4,
      4,
    );
    expect(normalized).toEqual({ '1:1': 0.5, '2:3': 1, '4:4': 0 });
    expect(normalized['99:1']).toBeUndefined();
  });

  it('maps a degenerate range to the midpoint and drops non-finite values', () => {
    expect(buildNormalizedExpressionByPosition({ '1:1': 7, '2:2': 7 }, 2, 2))
      .toEqual({ '1:1': 0.5, '2:2': 0.5 });
    expect(buildNormalizedExpressionByPosition({ '1:1': Number.NaN }, 2, 2))
      .toEqual({});
    expect(buildNormalizedExpressionByPosition({}, 2, 2)).toEqual({});
  });
});

describe('computeGridCellLayout', () => {
  it('mirrors the projectSpotsForCrop relative layout', () => {
    // 2x2 chip with spotDiameter 50, spotGap 50, tile 400px.
    const layout = computeGridCellLayout(2, 2, 50, 50, 400);
    const extent = 2 * 50 + 3 * 50; // 250 chip units
    const scale = 400 / extent;
    const spotPx = 50 * scale;
    const gapPx = 50 * scale;

    expect(layout.scale).toBeCloseTo(scale);
    expect(layout.spotPx).toBeCloseTo(spotPx);
    expect(layout.gapPx).toBeCloseTo(gapPx);

    // Row 1 (image-top) has the smallest y; col 1 the smallest x.
    const topLeft = layout.centers.find((c) => c.arrayRow === 1 && c.arrayCol === 1);
    const bottomRight = layout.centers.find((c) => c.arrayRow === 2 && c.arrayCol === 2);
    expect(topLeft).toMatchObject({
      x: gapPx + spotPx / 2,
      y: gapPx + spotPx / 2,
    });
    expect(bottomRight).toMatchObject({
      x: gapPx + (spotPx + gapPx) + spotPx / 2,
      y: gapPx + (spotPx + gapPx) + spotPx / 2,
    });
    expect(layout.centers).toHaveLength(4);
  });
});

describe('gridSignature', () => {
  it('changes when exclusions or expression values change', () => {
    const base: Parameters<typeof gridSignature>[0] = {
      rows: 2,
      columns: 2,
      spotDiameter: 50,
      spotGap: 50,
      normalizedByPosition: { '1:1': 0.5 },
      excludedRows: [],
      excludedColumns: [],
    };
    const withExclusion = { ...base, excludedRows: [2] };
    const withValue = { ...base, normalizedByPosition: { '1:1': 0.25 } };

    expect(gridSignature(base)).not.toBe(gridSignature(withExclusion));
    expect(gridSignature(base)).not.toBe(gridSignature(withValue));
    expect(gridSignature(base)).toBe(gridSignature({ ...base }));
  });
});

describe('buildSpotGridTile', () => {
  const createMockContext = () => {
    const calls: string[] = [];
    return {
      context: {
        get fillStyle() {
          return '';
        },
        set fillStyle(value: string) {
          calls.push(`style:${value}`);
        },
        fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
          calls.push(`rect:${x},${y},${w},${h}`);
        }),
      },
      calls,
    };
  };

  const config = {
    rows: 2,
    columns: 2,
    spotDiameter: 50,
    spotGap: 50,
    normalizedByPosition: { '1:1': 0, '2:2': 1 },
    excludedRows: [],
    excludedColumns: [],
  };

  it('renders heatmap cells for valued positions, neutral for the rest', () => {
    const { context, calls } = createMockContext();
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => context,
      }),
    });

    buildSpotGridTile(config, 400);

    const styles = calls.filter((call) => call.startsWith('style:'));
    // 4 cells: 2 heatmap (one per distinct normalized value) + 2 neutral.
    expect(styles).toHaveLength(4);
    expect(styles[0]).toMatch(/^style:#[0-9a-f]{6}b3$/);
    expect(styles.some((style) => style === `style:${NEUTRAL_CELL_FILL}`)).toBe(true);
    expect(calls.filter((call) => call.startsWith('rect:')).length).toBe(4);
  });

  it('dims excluded cells instead of coloring them', () => {
    const { context, calls } = createMockContext();
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => context,
      }),
    });

    buildSpotGridTile({ ...config, excludedColumns: [1] }, 400);

    const styles = calls.filter((call) => call.startsWith('style:'));
    expect(styles.filter((style) => style === `style:${EXCLUDED_CELL_FILL}`)).toHaveLength(2);
  });
});
