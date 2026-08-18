import { describe, expect, it } from 'vitest';

import { normalizeProjectForWorkspace } from '@/app/built-in-admin/projectState';
import type { LegacyPreprocessProject, ProjectedSpot, TissueActivationValue } from '@/types/built-in-admin';

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

const createSourceImage = (kind: 'eosin' | 'he') => ({
  id: `${kind}-source`,
  kind,
  fileName: `${kind}.png`,
  mimeType: 'image/png',
  sizeBytes: 1,
  width: 2048,
  height: 2048,
  lastModified: 0,
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
    forceAccepted: false,
    failureReason: null,
    transform: null,
    previewDataUrl: null,
  },
  cropQc: {
    status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    eosinReferenceGeometry: null,
    heQcGeometry: null,
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
    spotDiameter: null,
    excludedRows: [],
    removeExcludedRowsFromExport: false,
    excludedColumns: [],
    barcodesByPosition: {},
    log2nGeneByPosition: {},
    csvFileName: null,
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

const applyCanonicalEmptyCropContract = (project: LegacyPreprocessProject) => {
  Object.assign(project.cropQc, {
    cropAssets: {
      eosin: null,
      he: null,
    },
    tissue_hires_scalef: null,
    tissue_lowres_scalef: null,
    spot_diameter_fullres: null,
    fiducial_diameter_fullres: null,
    checkerboardPreview: {
      dataUrl: null,
    },
    featureMatchesPreview: {
      dataUrl: null,
    },
  });
};

const removeRepairedCropGeometry = (project: LegacyPreprocessProject) => {
  const cropQc = project.cropQc as typeof project.cropQc & {
    eosinReferenceGeometry?: unknown;
    heQcGeometry?: unknown;
  };

  delete cropQc.eosinReferenceGeometry;
  delete cropQc.heQcGeometry;
};

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

  it('rewinds legacy projects on crop or later back to alignment when strict alignment acceptance is false', () => {
    const project = createLegacyProject();
    project.currentStep = 'cropQc';
    project.alignment.status = 'complete';
    project.alignment.qualityFlags.accepted = false;
    project.alignment.solveAccepted = false;
    applyCanonicalEmptyCropContract(project);

    const migrated = migratePreprocessProject(project);

    expect(migrated.currentStep).toBe('alignment');
    expect(migrated.alignment.status).not.toBe('complete');
  });

  it('preserves force-accepted alignment status and step on migration', () => {
    const project = createLegacyProject();
    project.workflowVersion = 3;
    project.storageVersion = PREPROCESS_STORAGE_SCHEMA_VERSION;
    project.sourceAssets.images = {
      eosin: createSourceImage('eosin') as never,
      he: createSourceImage('he') as never,
    };
    project.currentStep = 'cropQc';
    project.alignment.status = 'complete';
    project.alignment.qualityFlags.accepted = false;
    project.alignment.solveAccepted = true;
    project.alignment.forceAccepted = true;
    project.alignment.failureReason = null;
    applyCanonicalEmptyCropContract(project);

    const migrated = migratePreprocessProject(project);

    expect(migrated.alignment.status).toBe('complete');
    expect(migrated.alignment.solveAccepted).toBe(true);
    expect(migrated.alignment.forceAccepted).toBe(true);
    expect(migrated.currentStep).toBe('cropQc');
  });

  it('stales downstream slices when legacy alignment is complete-looking but strict acceptance is false', () => {
    const project = createLegacyProject();
    project.currentStep = 'tissueSelection';
    project.alignment.status = 'complete';
    project.alignment.qualityFlags.accepted = false;
    project.alignment.solveAccepted = false;
    project.cropQc.status = 'complete';
    project.cropQc.qcAccepted = true;
    project.chipConfig.status = 'complete';
    project.tissueSelection.status = 'complete';
    project.exportState.status = 'ready';
    applyCanonicalEmptyCropContract(project);

    const migrated = migratePreprocessProject(project);

    expect(migrated.currentStep).toBe('alignment');
    expect(migrated.cropQc.status).toBe('stale');
    expect(migrated.chipConfig.status).toBe('stale');
    expect(migrated.tissueSelection.status).toBe('stale');
    expect(migrated.exportState.status).toBe('stale');
  });

  it('keeps currentStep on alignment but still stales downstream slices for invalid legacy complete alignment', () => {
    const project = createLegacyProject();
    project.currentStep = 'alignment';
    project.alignment.status = 'complete';
    project.alignment.qualityFlags.accepted = false;
    project.alignment.solveAccepted = false;
    project.cropQc.status = 'complete';
    project.cropQc.qcAccepted = true;
    project.chipConfig.status = 'complete';
    project.tissueSelection.status = 'complete';
    project.exportState.status = 'ready';
    applyCanonicalEmptyCropContract(project);

    const migrated = migratePreprocessProject(project);

    expect(migrated.currentStep).toBe('alignment');
    expect(migrated.cropQc.status).toBe('stale');
    expect(migrated.chipConfig.status).toBe('stale');
    expect(migrated.tissueSelection.status).toBe('stale');
    expect(migrated.exportState.status).toBe('stale');
  });

  it('rewinds completed legacy projects missing repaired crop metadata back to cropQc and clears downstream derived state', () => {
    const project = createLegacyProject();
    project.currentStep = 'exportState';
    project.sourceAssets.images = {
      eosin: createSourceImage('eosin'),
      he: createSourceImage('he'),
    };
    project.alignment.solveAccepted = true;
    project.alignment.qualityFlags.accepted = true;
    project.cropQc.cropRect = {
      x: 0.25,
      y: 0,
      width: 0.75,
      height: 0.95,
    };
    project.cropQc.cropWidth = 1799;
    project.cropQc.cropHeight = 2413;
    project.cropQc.qcAccepted = true;
    project.tissueSelection.selectedSpotIds = ['spot-a'];
    applyCanonicalEmptyCropContract(project);
    removeRepairedCropGeometry(project);

    const migrated = migratePreprocessProject(project);

		expect(migrated.currentStep).toBe('cropQc');
		expect(migrated.cropQc.status).toBe('stale');
		expect(migrated.cropQc.eosinReferenceGeometry).toBeNull();
		expect(migrated.cropQc.heQcGeometry).toBeNull();
		expect(migrated.cropQc.cropRect).toBeNull();
		expect(migrated.cropQc.cropWidth).toBeNull();
		expect(migrated.cropQc.cropHeight).toBeNull();
		expect(migrated.chipConfig.status).toBe('stale');
		expect(migrated.chipConfig.projectedSpots).toBeNull();
		expect(migrated.tissueSelection.status).toBe('stale');
		expect(migrated.tissueSelection.matrix).toBeNull();
    expect(migrated.tissueSelection.selectedSpotIds).toBeNull();
    expect(migrated.tissueSelection.supportState).toBe('unsupported');
    expect(migrated.exportState.status).toBe('stale');
    expect(migrated.exportState.lastExportedAt).toBeNull();
  });

  it('preserves localization and heFocus bounds when migrating legacy rotated or flipped transforms', () => {
    const project = createLegacyProject();
    const heFocus = project.heFocus as NonNullable<typeof project.heFocus>;
    project.localization.chipBounds = {
      x: 0.12,
      y: 0.26,
      width: 0.24,
      height: 0.24,
    };
    project.localization.imageTransform = {
      rotationDegrees: 90,
      flipHorizontal: true,
      flipVertical: false,
      scale: 1.25,
    };
    heFocus.chipBounds = {
      x: 0.18,
      y: 0.3,
      width: 0.2,
      height: 0.2,
    };
    heFocus.imageTransform = {
      rotationDegrees: -90,
      flipHorizontal: false,
      flipVertical: true,
      scale: 0.75,
    };

    const migrated = migratePreprocessProject(project);

    expect(migrated.localization.chipBounds).toEqual(project.localization.chipBounds);
    expect(migrated.localization.imageTransform).toEqual(project.localization.imageTransform);
    expect(migrated.heFocus.chipBounds).toEqual(heFocus.chipBounds);
    expect(migrated.heFocus.imageTransform).toEqual(heFocus.imageTransform);
  });

	it('preserves fully outside HEFocus bounds when legacy projects normalize into workspace state', () => {
		const project = createLegacyProject();
		const heFocus = project.heFocus as NonNullable<typeof project.heFocus>;
		const heFocusBounds = {
			x: 1.18,
			y: 1.12,
			width: 0.24,
			height: 0.24,
		};

		heFocus.chipBounds = heFocusBounds;
		heFocus.handles = [];

		expect(normalizeProjectForWorkspace(project).heFocus.chipBounds).toEqual(
			heFocusBounds,
		);
	});
});
