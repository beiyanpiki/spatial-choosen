import { describe, expect, it } from 'vitest';

import type { LegacyPreprocessProject, ProjectedSpot, TissueActivationValue } from '@/types/preprocess';

import { PREPROCESS_STORAGE_SCHEMA_VERSION } from './constants';
import { migratePreprocessProject } from './migrations';

const createProjectedSpot = (
  id: string,
  arrayRow: number,
  arrayCol: number,
): ProjectedSpot => ({
  id,
  barcode: id,
  arrayRow,
  arrayCol,
  x: arrayCol / 10,
  y: arrayRow / 10,
  width: 0.08,
  height: 0.08,
  diameterX: 0.08,
  diameterY: 0.08,
});

const createRegion = (spotIds: string[]) => ({
  id: 'region-1',
  label: 'Region 1',
  color: '#ff0000',
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ],
  paths: [],
  spotIds,
});

const createLegacyProject = (): LegacyPreprocessProject => ({
  id: 'legacy-project',
  name: 'Legacy Project',
  createdAt: '2026-04-14T00:00:00.000Z',
  updatedAt: '2026-04-14T00:00:00.000Z',
  workflowVersion: 2,
  storageVersion: 4,
  currentStep: 'tissueSelection',
  sourceAssets: {
    status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    activeImage: 'eosin',
    images: {
      eosin: null,
      he: null,
    },
    oversizedImageWarning: null,
  },
  localization: {
    status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    targetImage: 'eosin',
    chipType: '15um',
    method: 'manual',
    chipBounds: null,
    handles: [],
    boxColor: 'green',
    imageTransform: {
      rotationDegrees: 0,
      flipHorizontal: false,
      flipVertical: false,
      scale: 1,
    },
  },
  heFocus: {
    status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    targetImage: 'he',
    chipBounds: null,
    handles: [],
    imageTransform: {
      rotationDegrees: 0,
      flipHorizontal: false,
      flipVertical: false,
      scale: 1,
    },
    focusedImageDataUrl: null,
  },
  alignment: {
    status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    referenceImage: 'eosin',
    movingImage: 'he',
    movingImageTransform: {
      rotationDegrees: 0,
      flipHorizontal: false,
      flipVertical: false,
      scale: 1,
    },
    overlayOpacity: 0.5,
    controlPoints: [],
    inlierMask: null,
    affineMatrix: null,
    reprojectionRmse: null,
    inlierRatio: null,
    ransacReprojThreshold: null,
    qualityFlags: {
      minPairs: false,
      inlierRatio: false,
      rmse: false,
      finiteMatrix: false,
      scaleRange: false,
      accepted: false,
    },
    solveAccepted: false,
    failureReason: null,
    transform: null,
    previewDataUrl: null,
  },
  cropQc: {
    status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    cropRect: null,
    cropWidth: null,
    cropHeight: null,
    paddingRatio: 0.02,
    checkerboardTileSize: 64,
    overlayOpacity: 0.5,
    qcAccepted: false,
    issues: [],
    eosinPreviewDataUrl: null,
    previewDataUrl: null,
    checkerboardPreviewDataUrl: null,
    featureMatchesPreviewDataUrl: null,
    featureMatchesPreview: {
      dataUrl: null,
    },
  },
  chipConfig: {
    status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    chipType: '15um',
    rows: 96,
    columns: 96,
    pitchX: 15,
    pitchY: 15,
    origin: null,
    rotationDegrees: 0,
    projectedSpots: [
      createProjectedSpot('spot-a', 1, 1),
      createProjectedSpot('spot-b', 1, 2),
      createProjectedSpot('spot-c', 2, 1),
    ],
  },
  tissueSelection: {
    status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    mode: 'polygon',
    thresholdMode: 'gray-min',
    activationThreshold: 0.1,
    blockThreshold: 135,
    dbscanEps: 0.03,
    dbscanMinSamples: 3,
    minConnectedSpotCount: 8,
    autoSelectedSpotIds: [],
    forcedInSpotIds: [],
    forcedOutSpotIds: [],
    overrideNotice: null,
    paritySummary: null,
    warning: null,
    regions: [],
    selectedRegionId: null,
    previewDataUrl: null,
    selectedSpotIds: null,
  },
  exportState: {
    status: 'ready',
    isStale: false,
    updatedAt: null,
    error: null,
    requestedFormats: [],
    lastExportedAt: null,
    artifacts: [],
  },
});

describe('migratePreprocessProject tissue matrix migration', () => {
  it('migrates selectedSpotIds legacy state into canonical matrix-first tissue data', () => {
    const project = createLegacyProject();
    project.tissueSelection.selectedSpotIds = ['spot-a', 'spot-c'];
    project.tissueSelection.thresholdMode = 'dark';

    const migrated = migratePreprocessProject(project);
    const tissue = migrated.tissueSelection;

    expect(migrated.workflowVersion).toBe(3);
    expect(migrated.storageVersion).toBe(PREPROCESS_STORAGE_SCHEMA_VERSION);
    expect(tissue.mode).toBe('matrix');
    expect(tissue.thresholdMode).toBe('gray-min');
    expect(tissue.supportState).toBe('supported');
    expect(tissue.unsupportedReason).toBeNull();
    expect(tissue.matrix).toMatchObject({
      rows: 96,
      columns: 96,
    });
    expect(tissue.matrix?.values[0]).toBe(1);
    expect(tissue.matrix?.values[96]).toBe(1);
    expect(tissue.selectedSpotIds).toEqual(['spot-a', 'spot-c']);
    expect(tissue.regions).toEqual([]);
    expect(tissue.forcedInSpotIds).toEqual([]);
  });

  it('migrates region-only legacy state into canonical matrix-first tissue data', () => {
    const project = createLegacyProject();
    project.tissueSelection.regions = [createRegion(['spot-b'])];
    project.tissueSelection.thresholdMode = 'light';

    const migrated = migratePreprocessProject(project);

    expect(migrated.tissueSelection.thresholdMode).toBe('raw');
    expect(migrated.tissueSelection.matrix?.values[1]).toBe(1);
    expect(migrated.tissueSelection.selectedSpotIds).toEqual(['spot-b']);
  });

  it('migrates supported 50um projects to 64x64 canonical matrices with 4096 cells', () => {
    const project = createLegacyProject();
    project.localization.chipType = '50um';
    project.chipConfig.chipType = '50um';
    project.chipConfig.rows = 64;
    project.chipConfig.columns = 64;
    project.chipConfig.pitchX = 50;
    project.chipConfig.pitchY = 50;
    project.chipConfig.projectedSpots = [createProjectedSpot('spot-1', 64, 64)];
    project.tissueSelection.selectedSpotIds = ['spot-1'];

    const migrated = migratePreprocessProject(project);

    expect(migrated.tissueSelection.matrix).toEqual({
      rows: 64,
      columns: 64,
      values: expect.any(Array<TissueActivationValue>),
    });
    expect(migrated.tissueSelection.matrix?.values).toHaveLength(4096);
    expect(migrated.tissueSelection.matrix?.values[4095]).toBe(1);
  });

  it('migrates unsupported chips to disabled state with null matrix', () => {
    const project = createLegacyProject();
    project.localization.chipType = '25um';
    project.chipConfig.chipType = '25um';
    project.tissueSelection.selectedSpotIds = ['spot-a'];

    const migrated = migratePreprocessProject(project);

    expect(migrated.tissueSelection.supportState).toBe('unsupported');
    expect(migrated.tissueSelection.unsupportedReason).not.toBeNull();
    expect(migrated.tissueSelection.matrix).toBeNull();
    expect(migrated.tissueSelection.selectedSpotIds).toBeNull();
  });

  it('keeps canonical raw threshold mode for default/raw inputs', () => {
    const project = createLegacyProject();
    project.tissueSelection.thresholdMode = 'raw';

    const migrated = migratePreprocessProject(project);

    expect(migrated.tissueSelection.thresholdMode).toBe('raw');
  });

  it('falls back to an empty matrix and warning when region migration lacks projected spots', () => {
    const project = createLegacyProject();
    project.tissueSelection.regions = [createRegion(['spot-a'])];
    project.chipConfig.projectedSpots = null;

    const migrated = migratePreprocessProject(project);

    expect(migrated.tissueSelection.supportState).toBe('supported');
    expect(migrated.tissueSelection.matrix?.values.every((value) => value === 0)).toBe(true);
    expect(migrated.tissueSelection.selectedSpotIds).toEqual([]);
    expect(migrated.tissueSelection.warning).toMatch(/projected spots/i);
  });

  it('falls back to an empty matrix and warning when 50um dimensions are invalid legacy data', () => {
    const project = createLegacyProject();
    project.localization.chipType = '50um';
    project.chipConfig.chipType = '50um';
    project.chipConfig.rows = 50;
    project.chipConfig.columns = 50;
    project.tissueSelection.selectedSpotIds = ['spot-a'];

    const migrated = migratePreprocessProject(project);

    expect(migrated.tissueSelection.matrix).toEqual({
      rows: 50,
      columns: 50,
      values: Array.from({ length: 2500 }, () => 0),
    });
    expect(migrated.tissueSelection.selectedSpotIds).toEqual([]);
    expect(migrated.tissueSelection.warning).toMatch(/50um/i);
  });
});
