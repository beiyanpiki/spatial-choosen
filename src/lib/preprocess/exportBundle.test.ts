import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  LegacyPreprocessProject,
  PreprocessProject,
  ProjectedSpot,
  TissueActivationValue,
  TissueRegion,
} from '@/types/preprocess';

import { migratePreprocessProject } from './migrations';
import { deserializePreprocessProject, PACKAGE_VERSION } from './package';

vi.mock('./tissueRegions', () => ({
  deriveSelectedSpotIdsFromRegions: () => ['spot-b'],
}));

import { exportPreprocessZip, getPreprocessZipExportReadiness } from './exportBundle';

const PNG_DATA_URL = 'data:image/png;base64,AA==';

const createProjectedSpot = (
  id: string,
  arrayRow: number,
  arrayCol: number,
): ProjectedSpot => ({
  id,
  barcode: `barcode-${id}`,
  arrayRow,
  arrayCol,
  x: arrayCol / 100,
  y: arrayRow / 100,
  width: 0.008,
  height: 0.008,
  diameterX: 0.008,
  diameterY: 0.008,
});

const createMatrix = (
  rows: number,
  columns: number,
  activeCells: Array<[number, number]>,
) => {
  const values = Array.from({ length: rows * columns }, () => 0 as TissueActivationValue);

  for (const [row, column] of activeCells) {
    values[(row - 1) * columns + (column - 1)] = 1;
  }

  return {
    rows,
    columns,
    values,
  };
};

const createRegionAroundSpot = (spot: ProjectedSpot): TissueRegion => ({
  id: 'legacy-region',
  label: 'Legacy region',
  color: '#ff0000',
  points: [
    { x: spot.x - 0.01, y: spot.y - 0.01 },
    { x: spot.x + 0.01, y: spot.y - 0.01 },
    { x: spot.x + 0.01, y: spot.y + 0.01 },
    { x: spot.x - 0.01, y: spot.y + 0.01 },
  ],
  paths: [],
});

const createBaseProject = (): PreprocessProject => {
  const projectedSpots = [
    createProjectedSpot('spot-a', 1, 1),
    createProjectedSpot('spot-b', 1, 2),
    createProjectedSpot('spot-c', 2, 1),
    createProjectedSpot('spot-d', 64, 64),
  ];
  const legacyRegionSpot = projectedSpots[1];

  if (!legacyRegionSpot) {
    throw new Error('Legacy region spot fixture is missing.');
  }

  return {
    id: 'export-project',
    name: 'Export Project',
    createdAt: '2026-04-14T00:00:00.000Z',
    updatedAt: '2026-04-14T00:00:00.000Z',
    workflowVersion: 3,
    storageVersion: 5,
    currentStep: 'export',
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
      cropWidth: 640,
      cropHeight: 640,
      paddingRatio: 0.02,
      checkerboardTileSize: 64,
      overlayOpacity: 0.5,
      qcAccepted: true,
      issues: [],
      cropAssets: {
        eosin: {
          fullres: { dataUrl: PNG_DATA_URL },
          hires: { dataUrl: PNG_DATA_URL },
          lowres: { dataUrl: PNG_DATA_URL },
        },
        he: {
          fullres: { dataUrl: PNG_DATA_URL },
          hires: { dataUrl: PNG_DATA_URL },
          lowres: { dataUrl: PNG_DATA_URL },
        },
      },
      tissue_hires_scalef: 0.5,
      tissue_lowres_scalef: 0.25,
      spot_diameter_fullres: 18,
      fiducial_diameter_fullres: 27,
      eosinPreviewDataUrl: PNG_DATA_URL,
      previewDataUrl: PNG_DATA_URL,
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
      projectedSpots,
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
      autoSelectedSpotIds: ['spot-c'],
      matrix: createMatrix(64, 64, [
        [1, 1],
        [10, 10],
        [64, 64],
      ]),
      supportState: 'supported',
      unsupportedReason: null,
      selectedSpotIds: ['spot-b'],
      paritySummary: null,
      warning: null,
      forcedInSpotIds: [],
      forcedOutSpotIds: [],
      overrideNotice: null,
      regions: [createRegionAroundSpot(legacyRegionSpot)],
      selectedRegionId: 'legacy-region',
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
  };
};

const createLegacy50umProject = (): LegacyPreprocessProject => {
  const project = createBaseProject();
  const { tissueSelection, ...rest } = project;

  return {
    ...rest,
    workflowVersion: 2,
    storageVersion: 4,
    currentStep: 'tissueSelection',
    tissueSelection: {
      status: 'complete',
      isStale: false,
      updatedAt: null,
      error: null,
      mode: 'polygon',
      thresholdMode: 'dark',
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
      selectedSpotIds: ['spot-d'],
    },
  };
};

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

const readZipText = async (blob: Blob, fileName: string) => {
  const archive = await JSZip.loadAsync(await blob.arrayBuffer());
  const file = archive.file(fileName);
  if (!file) {
    throw new Error(`Missing file in archive: ${fileName}`);
  }

  return file.async('string');
};

const exportProject = async (project: PreprocessProject) => exportPreprocessZip({
  project,
  includeAlignedImage: false,
  includeProjectJson: false,
});

describe('exportBundle canonical matrix exports', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes tissue_matrix.csv from canonical matrix truth for both active and inactive cells', async () => {
    const project = createBaseProject();

    const result = await exportProject(project);
    const matrixCsv = await readZipText(result.blob, 'tissue_matrix.csv');
    const rows = matrixCsv.trim().split('\n').map((line) => line.split(','));

    expect(rows[0]?.[0]).toBe('1');
    expect(rows[0]?.[1]).toBe('0');
    expect(rows[9]?.[9]).toBe('1');
    expect(rows[9]?.[10]).toBe('0');
    expect(rows[63]?.[63]).toBe('1');
  });

  it('writes tissue_positions.csv using only matrix-derived in_tissue flags', async () => {
    const project = createBaseProject();

    const result = await exportProject(project);
    const csv = await readZipText(result.blob, 'tissue_positions.csv');
    const [, ...lines] = csv.trim().split('\n');
    const flagsByBarcode = new Map(lines.map((line) => {
      const [barcode, inTissue] = line.split(',');
      return [barcode, inTissue];
    }));

    expect(flagsByBarcode.get('barcode-spot-a')).toBe('1');
    expect(flagsByBarcode.get('barcode-spot-b')).toBe('0');
    expect(flagsByBarcode.get('barcode-spot-c')).toBe('0');
    expect(flagsByBarcode.get('barcode-spot-d')).toBe('1');
  });

  it('writes 64 rows with 64 columns per row for supported 50um exports', async () => {
    const project = createBaseProject();

    const result = await exportProject(project);
    const matrixCsv = await readZipText(result.blob, 'tissue_matrix.csv');
    const rows = matrixCsv.trim().split('\n');

    expect(rows).toHaveLength(64);
    expect(rows.every((line) => line.split(',').length === 64)).toBe(true);
  });

  it('blocks export when tissue support state is unsupported', async () => {
    const project = createBaseProject();
    project.tissueSelection.supportState = 'unsupported';
    project.tissueSelection.unsupportedReason = 'Unsupported chip export.';

    const readiness = getPreprocessZipExportReadiness(project);

    expect(readiness.canExport).toBe(false);
    await expect(exportProject(project)).rejects.toThrow('Unsupported chip export.');
  });

  it('blocks export when matrix shape does not match chip rows and columns', async () => {
    const project = createBaseProject();
    project.tissueSelection.matrix = createMatrix(63, 64, [[63, 64]]);

    const readiness = getPreprocessZipExportReadiness(project);

    expect(readiness.canExport).toBe(false);
    await expect(exportProject(project)).rejects.toThrow(/matrix/i);
  });

  it('preserves 64x64 canonical truth for legacy 50um projects through migrate, package validation, and export', async () => {
    const legacyProject = createLegacy50umProject();

    const migratedProject = migratePreprocessProject(legacyProject);
    const packagedProject = new Blob([
      JSON.stringify({
        version: PACKAGE_VERSION,
        project: toCanonicalProjectPayload(migratedProject),
      }),
    ], {
      type: 'application/x-spatial-preprocess+json',
    });
    const validatedProject = await deserializePreprocessProject(packagedProject);
    const result = await exportProject(validatedProject);
    const matrixCsv = await readZipText(result.blob, 'tissue_matrix.csv');
    const rows = matrixCsv.trim().split('\n').map((line) => line.split(','));

    expect(validatedProject.tissueSelection.matrix).toEqual({
      rows: 64,
      columns: 64,
      values: expect.any(Array<TissueActivationValue>),
    });
    expect(validatedProject.tissueSelection.matrix?.values).toHaveLength(4096);
    expect(validatedProject.tissueSelection.matrix?.values[4095]).toBe(1);
    expect(rows).toHaveLength(64);
    expect(rows[63]).toHaveLength(64);
    expect(rows[63]?.[63]).toBe('1');
  });
});
