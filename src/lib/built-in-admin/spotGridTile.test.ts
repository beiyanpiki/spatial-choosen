import { describe, expect, it, vi } from 'vitest';

import {
  buildNormalizedExpressionByPosition,
  buildSpotGridTile,
  compactSpotGridForDisplay,
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

  it('clips extreme outliers so the mid-range uses the full color scale', () => {
    // 100 normal cells spread 5.00..9.95 plus one extreme low outlier.
    const values: Record<string, number> = { '1:1': -1000 };
    for (let col = 2; col <= 101; col += 1) {
      values[`1:${col}`] = 5 + (col - 2) * 0.05;
    }

    const normalized = buildNormalizedExpressionByPosition(values, 1, 101);

    // P2 = sorted[2] = 5.05, P98 = sorted[98] = 9.85 → the mid-range value
    // 7.5 lands near 0.51 instead of ~0.997 that a plain min-max over the
    // full 1009.95 range would produce (everything crushed into the hottest
    // color band).
    expect(normalized['1:52']).toBeGreaterThan(0.45);
    expect(normalized['1:52']).toBeLessThan(0.55);
    // Outliers clip to the endpoints instead of dominating the scale.
    expect(normalized['1:1']).toBe(0);
    expect(normalized['1:101']).toBe(1);
  });

  it('ignores excluded positions when scaling the heatmap', () => {
    // Extreme lows live on row 2; excluding that row must remove them from
    // the normalization set entirely.
    const values: Record<string, number> = { '2:1': -1000, '2:2': 4, '2:3': 8 };
    for (let col = 1; col <= 3; col += 1) {
      values[`1:${col}`] = 1 + col;
    }

    const normalized = buildNormalizedExpressionByPosition(
      values,
      2,
      3,
      { excludedRows: [2], excludedColumns: [] },
    );

    expect(normalized['2:1']).toBeUndefined();
    expect(normalized['2:2']).toBeUndefined();
    expect(normalized['2:3']).toBeUndefined();
    // Row 1 normalizes over {2, 3, 4} only.
    expect(normalized['1:1']).toBe(0);
    expect(normalized['1:2']).toBeCloseTo(0.5, 10);
    expect(normalized['1:3']).toBe(1);
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

describe('compactSpotGridForDisplay', () => {
  const baseConfig = {
    rows: 3,
    columns: 3,
    spotDiameter: 50,
    spotGap: 50,
    normalizedByPosition: {
      '1:1': 0,
      '1:2': 0.25,
      '2:2': 1,
      '2:3': 0.75,
      '3:3': 0.5,
    },
    excludedRows: [],
    excludedColumns: [],
  };

  it('returns the same config when nothing is excluded', () => {
    expect(compactSpotGridForDisplay(baseConfig)).toBe(baseConfig);
  });

  it('drops excluded rows/columns and remaps expression keys to compact indices', () => {
    const compacted = compactSpotGridForDisplay({
      ...baseConfig,
      excludedRows: [2],
      excludedColumns: [2],
    });

    expect(compacted.rows).toBe(2);
    expect(compacted.columns).toBe(2);
    expect(compacted.excludedRows).toEqual([]);
    expect(compacted.excludedColumns).toEqual([]);
    // Remaining positions are 1:1 and 3:3 (the 2:2 and 2:3 cells were on the
    // excluded row/column); they renumber to 1:1 and 2:2 in compact space.
    expect(compacted.normalizedByPosition).toEqual({
      '1:1': 0,
      '2:2': 0.5,
    });
  });

  it('compacts when only rows or only columns are excluded', () => {
    const rowsOnly = compactSpotGridForDisplay({
      ...baseConfig,
      excludedRows: [1],
    });
    expect(rowsOnly.rows).toBe(2);
    expect(rowsOnly.columns).toBe(3);
    // Original row 2 becomes compact row 1, so '2:2' (value 1) renumbers to '1:2'.
    expect(rowsOnly.normalizedByPosition).toEqual({
      '1:2': 1,
      '1:3': 0.75,
      '2:3': 0.5,
    });

    const columnsOnly = compactSpotGridForDisplay({
      ...baseConfig,
      excludedColumns: [3],
    });
    expect(columnsOnly.rows).toBe(3);
    expect(columnsOnly.columns).toBe(2);
    // Original col 2 becomes compact col 2 unchanged; '2:2' (value 1) stays.
    expect(columnsOnly.normalizedByPosition['2:2']).toBe(1);
  });

  it('renders a re-fit tile without the excluded fill and with larger spots', () => {
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

    const { context, calls } = createMockContext();
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => context,
      }),
    });

    const compacted = compactSpotGridForDisplay({
      ...baseConfig,
      excludedRows: [2],
      excludedColumns: [2],
    });
    buildSpotGridTile(compacted, 400);

    const styles = calls.filter((call) => call.startsWith('style:'));
    // 2x2 compacted grid: the excluded dark fill is gone; the two unvalued
    // cells fall back to the neutral fill instead.
    expect(styles).toHaveLength(4);
    expect(styles.some((style) => style === `style:${EXCLUDED_CELL_FILL}`)).toBe(false);
    expect(styles.filter((style) => style === `style:${NEUTRAL_CELL_FILL}`)).toHaveLength(2);

    // Re-fit: the 2x2 grid's extent is 250 chip units vs 350 for the full
    // 3x3, so the tile scale grows and the spots get bigger.
    const compactLayout = computeGridCellLayout(2, 2, 50, 50, 400);
    const fullLayout = computeGridCellLayout(3, 3, 50, 50, 400);
    expect(compactLayout.spotPx).toBeGreaterThan(fullLayout.spotPx);
    expect(calls.filter((call) => call.startsWith('rect:')).length).toBe(4);
  });
});
