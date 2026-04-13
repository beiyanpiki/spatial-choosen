import { describe, expect, it } from 'vitest';
import type { ProjectedSpot, TissueSelectionSlice } from '@/types/preprocess';
import {
  buildManualTissueSelectionState,
  buildUpdatedProjectSnapshot,
} from './projectUpdates';

const PROJECTED_SPOTS: ProjectedSpot[] = [
  {
    id: 'spot-a',
    barcode: 'spot-a',
    arrayRow: 0,
    arrayCol: 0,
    x: 0.25,
    y: 0.25,
    width: 0.2,
    height: 0.2,
    diameterX: 0.2,
    diameterY: 0.2,
  },
];

const BASE_TISSUE_SELECTION: TissueSelectionSlice = {
  status: 'ready',
  isStale: false,
  updatedAt: '2026-04-13T00:00:00.000Z',
  error: null,
  mode: 'polygon',
  thresholdMode: 'gray-min',
  activationThreshold: 0.1,
  blockThreshold: 138,
  dbscanEps: 0.2,
  dbscanMinSamples: 2,
  minConnectedSpotCount: 2,
  autoSelectedSpotIds: ['spot-a'],
  forcedInSpotIds: [],
  forcedOutSpotIds: [],
  overrideNotice: null,
  paritySummary: null,
  warning: null,
  regions: [],
  selectedRegionId: null,
  previewDataUrl: null,
  selectedSpotIds: null,
};

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

  it('clears auto-selected spots when manual edits remove every region', () => {
    const next = buildManualTissueSelectionState({
      current: BASE_TISSUE_SELECTION,
      projectedSpots: PROJECTED_SPOTS,
      nextRegions: [],
      updatedAt: '2026-04-13T00:02:00.000Z',
    });

    expect(next.autoSelectedSpotIds).toEqual([]);
    expect(next.selectedSpotIds).toEqual([]);
    expect(next.paritySummary).toEqual({
      selectedCount: 0,
      selectedPercent: 0,
      maskCoverage: 0,
    });
  });

  it('preserves auto-selected ids while deriving manual region coverage', () => {
    const next = buildManualTissueSelectionState({
      current: BASE_TISSUE_SELECTION,
      projectedSpots: PROJECTED_SPOTS,
      nextRegions: [
        {
          id: 'manual-region',
          label: 'Manual region',
          color: '#00ff00',
          points: [
            { x: 0.1, y: 0.1 },
            { x: 0.4, y: 0.1 },
            { x: 0.4, y: 0.4 },
            { x: 0.1, y: 0.4 },
          ],
          paths: [[
            { x: 0.1, y: 0.1 },
            { x: 0.4, y: 0.1 },
            { x: 0.4, y: 0.4 },
            { x: 0.1, y: 0.4 },
          ]],
        },
      ],
      updatedAt: '2026-04-13T00:03:00.000Z',
    });

    expect(next.autoSelectedSpotIds).toEqual(['spot-a']);
    expect(next.selectedSpotIds).toEqual(['spot-a']);
    expect(next.paritySummary?.selectedCount).toBe(1);
  });
});
