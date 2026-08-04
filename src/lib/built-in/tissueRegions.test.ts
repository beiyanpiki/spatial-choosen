import { describe, expect, it } from 'vitest';
import type { ProjectedSpot, TissueRegion } from '@/types/built-in';
import {
  AUTO_TISSUE_REGION_ID,
  buildDefaultTissueRegionFromDetectedSpots,
  deriveSelectedSpotIdsFromRegions,
} from './tissueRegions';

const PROJECTED_SPOTS: ProjectedSpot[] = [
  {
    id: 'left',
    barcode: 'left',
    arrayRow: 0,
    arrayCol: 0,
    x: 0.25,
    y: 0.25,
    width: 0.2,
    height: 0.2,
    diameterX: 0.2,
    diameterY: 0.2,
  },
  {
    id: 'right',
    barcode: 'right',
    arrayRow: 0,
    arrayCol: 1,
    x: 0.5,
    y: 0.25,
    width: 0.2,
    height: 0.2,
    diameterX: 0.2,
    diameterY: 0.2,
  },
  {
    id: 'bottom',
    barcode: 'bottom',
    arrayRow: 1,
    arrayCol: 0,
    x: 0.25,
    y: 0.5,
    width: 0.2,
    height: 0.2,
    diameterX: 0.2,
    diameterY: 0.2,
  },
];

describe('tissue region helpers', () => {
  it('keeps auto-generated region selection parity with the detected spot ids', () => {
    const region = buildDefaultTissueRegionFromDetectedSpots({
      projectedSpots: PROJECTED_SPOTS,
      selectedSpotIds: ['left', 'right'],
    });

    expect(region).not.toBeNull();
    expect(deriveSelectedSpotIdsFromRegions(region ? [region] : [], PROJECTED_SPOTS)).toEqual(['left', 'right']);
  });

  it('keeps manual hole regions distinct from detected tissue region behavior', () => {
    const manualRegion: TissueRegion = {
      id: AUTO_TISSUE_REGION_ID,
      label: 'Detected tissue',
      color: '#000',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.7, y: 0.1 },
        { x: 0.7, y: 0.7 },
        { x: 0.1, y: 0.7 },
      ],
      paths: [
        [
          { x: 0.1, y: 0.1 },
          { x: 0.7, y: 0.1 },
          { x: 0.7, y: 0.7 },
          { x: 0.1, y: 0.7 },
        ],
        [
          { x: 0.38, y: 0.13 },
          { x: 0.62, y: 0.13 },
          { x: 0.62, y: 0.37 },
          { x: 0.38, y: 0.37 },
        ],
      ],
    };

    expect(deriveSelectedSpotIdsFromRegions([manualRegion], PROJECTED_SPOTS)).toEqual(['left', 'bottom']);
  });
});
