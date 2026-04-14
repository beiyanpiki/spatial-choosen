import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PreprocessProject, ProjectedSpot } from '@/types/preprocess';

import { deserializePreprocessProject, PACKAGE_VERSION } from './package';

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

const createProject = (): PreprocessProject => ({
  id: 'package-project',
  name: 'Package Project',
  createdAt: '2026-04-14T00:00:00.000Z',
  updatedAt: '2026-04-14T00:00:00.000Z',
  workflowVersion: 3,
  storageVersion: 5,
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
    chipType: '50um',
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
    cropAssets: {
      eosin: null,
      he: null,
    },
    tissue_hires_scalef: null,
    tissue_lowres_scalef: null,
    spot_diameter_fullres: null,
    fiducial_diameter_fullres: null,
    eosinPreviewDataUrl: null,
    previewDataUrl: null,
    checkerboardPreviewDataUrl: null,
    checkerboardPreview: {
      dataUrl: null,
    },
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
    chipType: '50um',
    rows: 64,
    columns: 64,
    pitchX: 50,
    pitchY: 50,
    origin: null,
    rotationDegrees: 0,
    projectedSpots: null,
  },
  tissueSelection: {
    status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    mode: 'matrix',
    thresholdMode: 'raw',
    activationThreshold: 0.1,
    blockThreshold: 135,
    dbscanEps: 0.03,
    dbscanMinSamples: 3,
    minConnectedSpotCount: 8,
    autoSelectedSpotIds: ['spot-a'],
    matrix: {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 0 ? 1 : 0 as const)),
    },
    supportState: 'supported',
    unsupportedReason: null,
    selectedSpotIds: null,
    paritySummary: null,
    warning: null,
    forcedInSpotIds: [],
    forcedOutSpotIds: [],
    overrideNotice: null,
    regions: [],
    selectedRegionId: null,
    previewDataUrl: null,
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

const createPackageBlob = (payload: Record<string, unknown>) => new Blob([
  JSON.stringify(payload),
], {
  type: 'application/x-spatial-preprocess+json',
});

const toCanonicalProjectPayload = (project: PreprocessProject) => {
  const {
    forcedInSpotIds: _forcedInSpotIds,
    forcedOutSpotIds: _forcedOutSpotIds,
    overrideNotice: _overrideNotice,
    regions: _regions,
    selectedRegionId: _selectedRegionId,
    ...canonicalTissueSelection
  } = project.tissueSelection;

  return {
    ...project,
    tissueSelection: canonicalTissueSelection,
  };
};

describe('preprocess package matrix-first validation', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts version 4 canonical matrix-first payloads', async () => {
    const project = createProject();

    const result = await deserializePreprocessProject(createPackageBlob({
      version: PACKAGE_VERSION,
      project: toCanonicalProjectPayload(project),
    }));

    expect(result.tissueSelection.mode).toBe('matrix');
    expect(result.tissueSelection.thresholdMode).toBe('raw');
    expect(result.tissueSelection.matrix?.values).toHaveLength(4096);
  });

  it('preserves canonical matrix truth on v4 round-trip even when autoSelectedSpotIds do not imply the active cells', async () => {
    const project = createProject();
    project.tissueSelection.autoSelectedSpotIds = [];
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 65 ? 1 : 0 as const)),
    };

    const result = await deserializePreprocessProject(createPackageBlob({
      version: PACKAGE_VERSION,
      project: toCanonicalProjectPayload(project),
    }));

    expect(result.tissueSelection.matrix).toEqual(project.tissueSelection.matrix);
    expect(result.tissueSelection.autoSelectedSpotIds).toEqual([]);
  });

  it('rejects invalid matrix lengths', async () => {
    const project = createProject();
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: [1, 0],
    };

    await expect(deserializePreprocessProject(createPackageBlob({
      version: PACKAGE_VERSION,
      project: toCanonicalProjectPayload(project),
    }))).rejects.toThrow(/matrix length/i);
  });

  it('rejects non-binary matrix values', async () => {
    const project = createProject();
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 0 ? 2 : 0)),
    };

    await expect(deserializePreprocessProject(createPackageBlob({
      version: PACKAGE_VERSION,
      project: toCanonicalProjectPayload(project),
    }))).rejects.toThrow(/binary/i);
  });

  it('rejects 50um payloads that still use legacy 2500-cell matrix dimensions', async () => {
    const project = createProject();
    project.chipConfig.rows = 50;
    project.chipConfig.columns = 50;
    project.tissueSelection.matrix = {
      rows: 50,
      columns: 50,
      values: Array.from({ length: 2500 }, () => 0 as const),
    };

    await expect(deserializePreprocessProject(createPackageBlob({
      version: PACKAGE_VERSION,
      project: toCanonicalProjectPayload(project),
    }))).rejects.toThrow(/64x64|50um/i);
  });

  it('rejects canonical version 4 payloads that still include region-first fields as current data', async () => {
    const project = createProject();

    await expect(deserializePreprocessProject(createPackageBlob({
      version: PACKAGE_VERSION,
      project: {
        ...project,
        tissueSelection: {
          ...project.tissueSelection,
          regions: [
            {
              id: 'region-1',
              label: 'Region 1',
              color: '#ff0000',
              points: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 },
              ],
            },
          ],
        },
      },
    }))).rejects.toThrow(/region-first|legacy/i);
  });

  it('still migrates older package versions through the legacy path', async () => {
    const project = createProject();

    const result = await deserializePreprocessProject(createPackageBlob({
      version: 3,
      project: {
        ...project,
        workflowVersion: 2,
        storageVersion: 4,
        chipConfig: {
          ...project.chipConfig,
          projectedSpots: [createProjectedSpot('spot-a', 1, 1)],
        },
        tissueSelection: {
          ...project.tissueSelection,
          mode: 'polygon',
          thresholdMode: 'dark',
          matrix: null,
          selectedSpotIds: ['spot-a'],
          supportState: undefined,
          unsupportedReason: undefined,
          forcedInSpotIds: [],
          forcedOutSpotIds: [],
          overrideNotice: null,
          regions: [],
          selectedRegionId: null,
          previewDataUrl: null,
        },
      },
    }));

    expect(result.workflowVersion).toBe(3);
    expect(result.tissueSelection.thresholdMode).toBe('gray-min');
    expect(result.tissueSelection.matrix?.values[0]).toBe(1);
  });
});
