import { describe, expect, it } from 'vitest';

import type { PreprocessPoint, ProjectedSpot, TissueSelectionSlice } from '@/types/built-in-admin';

import {
  buildInvertedTissueSelectionState,
  buildManualTissueSelectionState,
  buildUpdatedProjectSnapshot,
} from './projectUpdates';
import { createEmptyMatrix } from './tissueMatrix';

const PROJECTED_SPOTS: ProjectedSpot[] = [
  {
    id: 'spot-a',
    barcode: 'spot-a',
    arrayRow: 1,
    arrayCol: 1,
    x: 0.25,
    y: 0.25,
    width: 0.2,
    height: 0.2,
    diameterX: 0.2,
    diameterY: 0.2,
  },
  {
    id: 'spot-b',
    barcode: 'spot-b',
    arrayRow: 1,
    arrayCol: 2,
    x: 0.75,
    y: 0.25,
    width: 0.2,
    height: 0.2,
    diameterX: 0.2,
    diameterY: 0.2,
  },
  {
    id: 'spot-c',
    barcode: 'spot-c',
    arrayRow: 2,
    arrayCol: 1,
    x: 0.25,
    y: 0.75,
    width: 0.2,
    height: 0.2,
    diameterX: 0.2,
    diameterY: 0.2,
  },
  {
    id: 'spot-d',
    barcode: 'spot-d',
    arrayRow: 2,
    arrayCol: 2,
    x: 0.75,
    y: 0.75,
    width: 0.2,
    height: 0.2,
    diameterX: 0.2,
    diameterY: 0.2,
  },
];

const rect = (left: number, top: number, right: number, bottom: number): PreprocessPoint[] => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
];

const createTissueSelection = (
  overrides: Partial<TissueSelectionSlice> = {},
): TissueSelectionSlice => ({
  status: 'ready',
  isStale: true,
  updatedAt: '2026-04-13T00:00:00.000Z',
  error: 'stale error',
  mode: 'matrix',
  thresholdMode: 'raw',
  activationThreshold: 0.1,
  blockThreshold: 138,
  dbscanEps: 0.2,
  dbscanMinSamples: 2,
  minConnectedSpotCount: 2,
  autoSelectedSpotIds: ['spot-d'],
  matrix: createEmptyMatrix(2, 2),
  supportState: 'supported',
  unsupportedReason: null,
  selectedSpotIds: ['spot-d'],
  paritySummary: {
    selectedCount: 1,
    selectedPercent: 25,
    maskCoverage: 25,
  },
  warning: 'stale warning',
  overrideNotice: 'legacy override notice',
  previewDataUrl: 'data:image/png;base64,legacy',
  ...overrides,
});

describe('projectUpdates helpers', () => {
  it('returns the same object for no-op project updates', () => {
    const current = {
      id: 'project-1',
      updatedAt: '2026-04-13T00:00:00.000Z',
      name: 'Perf project',
    };

    const next = buildUpdatedProjectSnapshot(current, (value) => value, '2026-04-13T00:01:00.000Z');

    expect(next).toBe(current);
  });

  it('re-derives selected ids and parity summary from the updated matrix after an activate edit', () => {
    const current = createTissueSelection({
      autoSelectedSpotIds: ['spot-c'],
      selectedSpotIds: null,
    });

    const next = buildManualTissueSelectionState({
      current,
      projectedSpots: PROJECTED_SPOTS,
      editArea: rect(0.1, 0.1, 0.9, 0.3),
      nextValue: 1,
      updatedAt: '2026-04-13T00:02:00.000Z',
    });

    expect(next.matrix).toEqual({
      rows: 2,
      columns: 2,
      values: [1, 1, 0, 0],
    });
    expect(next.selectedSpotIds).toEqual(['spot-a', 'spot-b']);
    expect(next.paritySummary).toEqual({
      selectedCount: 2,
      selectedPercent: 50,
      maskCoverage: 50,
    });
    expect(next.autoSelectedSpotIds).toEqual(['spot-c']);
    expect(next.mode).toBe('matrix');
    expect(next.overrideNotice).toBeNull();
    expect(next.status).toBe('complete');
    expect(next.isStale).toBe(false);
    expect(next.warning).toBeNull();
    expect(next.error).toBeNull();
  });

  it('toggles one inactive spot on without changing adjacent cells', () => {
    const next = buildManualTissueSelectionState({
      current: createTissueSelection({
        matrix: createEmptyMatrix(2, 2),
        selectedSpotIds: [],
      }),
      projectedSpots: PROJECTED_SPOTS,
      spotId: 'spot-a',
      rows: 2,
      columns: 2,
      updatedAt: '2026-04-13T00:02:15.000Z',
    });

    expect(next.matrix?.values).toEqual([1, 0, 0, 0]);
    expect(next.selectedSpotIds).toEqual(['spot-a']);
  });

  it('toggles one active spot off without changing adjacent cells', () => {
    const next = buildManualTissueSelectionState({
      current: createTissueSelection({
        matrix: {
          rows: 2,
          columns: 2,
          values: [1, 0, 0, 0],
        },
        selectedSpotIds: ['spot-a'],
      }),
      projectedSpots: PROJECTED_SPOTS,
      spotId: 'spot-a',
      rows: 2,
      columns: 2,
      updatedAt: '2026-04-13T00:02:20.000Z',
    });

    expect(next.matrix?.values).toEqual([0, 0, 0, 0]);
    expect(next.selectedSpotIds).toEqual([]);
  });

  it('returns the current tissue selection when the target spot has invalid matrix coordinates', () => {
    const current = createTissueSelection({
      matrix: createEmptyMatrix(2, 2),
      selectedSpotIds: [],
    });
    const invalidSpot: ProjectedSpot = {
      id: 'invalid-spot',
      barcode: 'invalid-spot',
      arrayRow: 3,
      arrayCol: 1,
      x: 0.5,
      y: 0.5,
      width: 0.2,
      height: 0.2,
      diameterX: 0.2,
      diameterY: 0.2,
    };

    const next = buildManualTissueSelectionState({
      current,
      projectedSpots: [...PROJECTED_SPOTS, invalidSpot],
      spotId: invalidSpot.id,
      rows: 2,
      columns: 2,
      updatedAt: '2026-04-13T00:02:25.000Z',
    });

    expect(next).toBe(current);
  });

  it('returns the current tissue selection object for empty-space edits that do not change the matrix', () => {
    const current = createTissueSelection({
      matrix: {
        rows: 2,
        columns: 2,
        values: [1, 0, 1, 0],
      },
      selectedSpotIds: ['spot-a', 'spot-c'],
      paritySummary: {
        selectedCount: 2,
        selectedPercent: 50,
        maskCoverage: 50,
      },
    });

    const next = buildManualTissueSelectionState({
      current,
      projectedSpots: PROJECTED_SPOTS,
      editArea: rect(0.4, 0.4, 0.6, 0.6),
      nextValue: 1,
      updatedAt: '2026-04-13T00:02:30.000Z',
    });

    expect(next).toBe(current);
    expect(next.matrix).toBe(current.matrix);
  });

  it('returns the current tissue selection object for boundary-only edits that do not change the matrix', () => {
    const current = createTissueSelection({
      matrix: {
        rows: 2,
        columns: 2,
        values: [0, 0, 0, 0],
      },
      selectedSpotIds: [],
      paritySummary: {
        selectedCount: 0,
        selectedPercent: 0,
        maskCoverage: 0,
      },
    });

    const next = buildManualTissueSelectionState({
      current,
      projectedSpots: PROJECTED_SPOTS,
      editArea: rect(0.35, 0.15, 0.45, 0.35),
      nextValue: 1,
      updatedAt: '2026-04-13T00:02:45.000Z',
    });

    expect(next).toBe(current);
    expect(next.matrix).toBe(current.matrix);
  });

  it('re-derives selected ids from the matrix after each deactivate edit', () => {
    const activated = buildManualTissueSelectionState({
      current: createTissueSelection(),
      projectedSpots: PROJECTED_SPOTS,
      editArea: rect(0.1, 0.1, 0.9, 0.3),
      nextValue: 1,
      updatedAt: '2026-04-13T00:03:00.000Z',
    });

    const deactivated = buildManualTissueSelectionState({
      current: activated,
      projectedSpots: PROJECTED_SPOTS,
      editArea: rect(0.65, 0.15, 0.85, 0.35),
      nextValue: 0,
      updatedAt: '2026-04-13T00:04:00.000Z',
    });

    expect(deactivated.matrix).toEqual({
      rows: 2,
      columns: 2,
      values: [1, 0, 0, 0],
    });
    expect(deactivated.selectedSpotIds).toEqual(['spot-a']);
    expect(deactivated.paritySummary).toEqual({
      selectedCount: 1,
      selectedPercent: 25,
      maskCoverage: 25,
    });
    expect(deactivated.warning).toBeNull();
    expect(deactivated.error).toBeNull();
  });

  it('sets a single spot to the activate-tool value instead of toggling', () => {
    const next = buildManualTissueSelectionState({
      current: createTissueSelection({
        matrix: createEmptyMatrix(2, 2),
        selectedSpotIds: [],
      }),
      projectedSpots: PROJECTED_SPOTS,
      spotId: 'spot-a',
      nextValue: 1,
      rows: 2,
      columns: 2,
      updatedAt: '2026-04-13T00:02:15.000Z',
    });

    expect(next.matrix?.values).toEqual([1, 0, 0, 0]);
    expect(next.selectedSpotIds).toEqual(['spot-a']);
  });

  it('sets a single spot to the deactivate-tool value even when the spot is already inactive', () => {
    const current = createTissueSelection({
      matrix: {
        rows: 2,
        columns: 2,
        values: [0, 0, 0, 0],
      },
      selectedSpotIds: [],
    });

    const next = buildManualTissueSelectionState({
      current,
      projectedSpots: PROJECTED_SPOTS,
      spotId: 'spot-a',
      nextValue: 0,
      rows: 2,
      columns: 2,
      updatedAt: '2026-04-13T00:02:20.000Z',
    });

    // Toggle semantics would have ACTIVATED the spot; the tool value keeps it
    // inactive and the slice is returned unchanged.
    expect(next).toBe(current);
    expect(next.matrix?.values).toEqual([0, 0, 0, 0]);
  });

  it('deactivates a previously active spot via the deactivate tool', () => {
    const next = buildManualTissueSelectionState({
      current: createTissueSelection({
        matrix: {
          rows: 2,
          columns: 2,
          values: [1, 0, 0, 0],
        },
        selectedSpotIds: ['spot-a'],
      }),
      projectedSpots: PROJECTED_SPOTS,
      spotId: 'spot-a',
      nextValue: 0,
      rows: 2,
      columns: 2,
      updatedAt: '2026-04-13T00:02:25.000Z',
    });

    expect(next.matrix?.values).toEqual([0, 0, 0, 0]);
    expect(next.selectedSpotIds).toEqual([]);
  });

  it('does not invert a selection before any detection has run', () => {
    const current = createTissueSelection({
      matrix: null,
      selectedSpotIds: null,
      autoSelectedSpotIds: [],
    });

    const next = buildInvertedTissueSelectionState({
      current,
      projectedSpots: PROJECTED_SPOTS,
      rows: 2,
      columns: 2,
      updatedAt: '2026-04-13T00:06:00.000Z',
    });

    expect(next).toBe(current);
    expect(next.matrix).toBeNull();
  });

  it('inverts an existing matrix and re-derives the selection', () => {
    const next = buildInvertedTissueSelectionState({
      current: createTissueSelection({
        matrix: {
          rows: 2,
          columns: 2,
          values: [1, 0, 0, 1],
        },
        selectedSpotIds: ['spot-a', 'spot-d'],
      }),
      projectedSpots: PROJECTED_SPOTS,
      rows: 2,
      columns: 2,
      updatedAt: '2026-04-13T00:06:00.000Z',
    });

    expect(next.matrix?.values).toEqual([0, 1, 1, 0]);
    expect(next.selectedSpotIds).toEqual(['spot-b', 'spot-c']);
    expect(next.status).toBe('complete');
  });

  it('keeps auto-selected ids as debug-only state and does not let them override manual matrix truth', () => {
    const next = buildManualTissueSelectionState({
      current: createTissueSelection({
        autoSelectedSpotIds: ['spot-d'],
        matrix: {
          rows: 2,
          columns: 2,
          values: [1, 0, 0, 0],
        },
        selectedSpotIds: ['spot-a'],
        paritySummary: {
          selectedCount: 1,
          selectedPercent: 25,
          maskCoverage: 25,
        },
      }),
      projectedSpots: PROJECTED_SPOTS,
      editArea: rect(0.15, 0.15, 0.35, 0.35),
      nextValue: 0,
      updatedAt: '2026-04-13T00:05:00.000Z',
    });

    expect(next.autoSelectedSpotIds).toEqual(['spot-d']);
    expect(next.matrix).toEqual({
      rows: 2,
      columns: 2,
      values: [0, 0, 0, 0],
    });
    expect(next.selectedSpotIds).toEqual([]);
    expect(next.paritySummary).toEqual({
      selectedCount: 0,
      selectedPercent: 0,
      maskCoverage: 0,
    });
  });
});
