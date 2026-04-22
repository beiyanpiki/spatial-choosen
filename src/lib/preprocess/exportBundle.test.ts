import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  LegacyPreprocessProject,
  PreprocessProject,
  ProjectedSpot,
  TissueActivationValue,
  TissueRegion,
} from '@/types/preprocess';

import type { ChipConfigData } from './chipConfigs';
import { migratePreprocessProject } from './migrations';
import {
  deserializePreprocessProject,
  PACKAGE_VERSION,
  serializePreprocessProject,
} from './package';
import { projectSpotsForCrop } from './spotProjection';

const mockLoadChipConfigData = vi.hoisted(() => vi.fn());

vi.mock('./chipConfigs', () => ({
  loadChipConfigData: mockLoadChipConfigData,
}));

vi.mock('./tissueRegions', () => ({
  deriveSelectedSpotIdsFromRegions: () => ['spot-b'],
}));

import { exportPreprocessZip, getPreprocessZipExportReadiness } from './exportBundle';

const PNG_DATA_URL = 'data:image/png;base64,AA==';

const createMockChipConfigData = (): ChipConfigData => ({
  manifest: {
    id: '50um',
    label: 'Square grid 50um',
    gridRows: 64,
    gridCols: 64,
    spotDiameter: 50,
    spotGap: 50,
    barcodeTemplatePath: '/unused/tissue_positions.csv',
    tissuePositionsPath: '/unused/tissue_positions.csv',
  },
  templateEntries: [
    {
      barcode: 'barcode-spot-a',
      arrayRow: 1,
      arrayCol: 1,
      pxl_row_in_fullres: 75,
      pxl_col_in_fullres: 75,
    },
    {
      barcode: 'barcode-spot-b',
      arrayRow: 1,
      arrayCol: 2,
      pxl_row_in_fullres: 75,
      pxl_col_in_fullres: 175,
    },
    {
      barcode: 'barcode-spot-c',
      arrayRow: 2,
      arrayCol: 1,
      pxl_row_in_fullres: 175,
      pxl_col_in_fullres: 75,
    },
    {
      barcode: 'barcode-spot-d',
      arrayRow: 64,
      arrayCol: 64,
      pxl_row_in_fullres: 6375,
      pxl_col_in_fullres: 6375,
    },
  ],
});

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

const createSourceImage = (kind: 'eosin' | 'he') => ({
  id: `source-${kind}`,
  kind,
  fileName: `${kind}.png`,
  mimeType: 'image/png',
  sizeBytes: 1,
  width: 1,
  height: 1,
  lastModified: 0,
  dataUrl: PNG_DATA_URL,
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

const defaultEosinReferenceGeometry = {
  rect: { x: 75, y: 75, width: 6300, height: 6300 },
  width: 640,
  height: 640,
} as const;

const defaultHeQcGeometry = {
  rect: { x: 35, y: 80, width: 6300, height: 6300 },
  width: 640,
  height: 640,
} as const;

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
    currentStep: 'exportState',
    sourceAssets: {
      status: 'complete',
      isStale: false,
      updatedAt: null,
      error: null,
      activeImage: 'eosin',
      images: {
        eosin: createSourceImage('eosin'),
        he: createSourceImage('he'),
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
      chipBounds: { ...defaultHeQcGeometry.rect },
      handles: [],
      imageTransform: {
        rotationDegrees: 0,
        flipHorizontal: false,
        flipVertical: false,
        scale: 1,
      },
      autoProposal: {
        status: 'idle',
        method: null,
        coarseBounds: null,
        refinedBounds: null,
        refinedQuad: null,
        rotationDegrees: null,
        eccCorrelation: null,
        failureReason: null,
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
      source: null,
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
        accepted: true,
      },
      solveAccepted: true,
      failureReason: null,
      transform: null,
      previewDataUrl: null,
    },
    cropQc: {
      status: 'complete',
      isStale: false,
      updatedAt: null,
      error: null,
      eosinReferenceGeometry: { ...defaultEosinReferenceGeometry, rect: { ...defaultEosinReferenceGeometry.rect } },
      heQcGeometry: { ...defaultHeQcGeometry, rect: { ...defaultHeQcGeometry.rect } },
      cropRect: { ...defaultEosinReferenceGeometry.rect },
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

  return {
    ...project,
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

const readZipText = async (blob: Blob, fileName: string) => {
  const archive = await JSZip.loadAsync(await blob.arrayBuffer());
  const file = archive.file(fileName);
  if (!file) {
    throw new Error(`Missing file in archive: ${fileName}`);
  }

  return file.async('string');
};

type ExportedTissuePositionRow = {
  barcode: string;
  in_tissue: number;
  array_row: number;
  array_col: number;
  pxl_row_in_fullres: number;
  pxl_col_in_fullres: number;
};

type ExportedScalefactors = {
  spot_diameter_fullres: number;
  fiducial_diameter_fullres: number;
  tissue_hires_scalef: number;
  tissue_lowres_scalef: number;
};

const parseTissuePositionsCsv = (csv: string): ExportedTissuePositionRow[] => csv
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => {
    const [barcode, in_tissue, array_row, array_col, pxl_row_in_fullres, pxl_col_in_fullres] = line.split(',');

    return {
      barcode: barcode ?? '',
      in_tissue: Number(in_tissue),
      array_row: Number(array_row),
      array_col: Number(array_col),
      pxl_row_in_fullres: Number(pxl_row_in_fullres),
      pxl_col_in_fullres: Number(pxl_col_in_fullres),
    } satisfies ExportedTissuePositionRow;
  });

const readExportedTissuePositions = async (blob: Blob) => parseTissuePositionsCsv(
  await readZipText(blob, 'tissue_positions.csv'),
);

const readExportedScalefactors = async (blob: Blob) => JSON.parse(
  await readZipText(blob, 'scalefactors_json.json'),
) as ExportedScalefactors;

type PackagedProjectPayload = {
  version: number;
  project: {
    chipConfig: Record<string, unknown>;
  };
};

const indexRowsByBarcode = (rows: ExportedTissuePositionRow[]) => new Map(
  rows.map((row) => [row.barcode, row] as const),
);

const exportProject = async (project: PreprocessProject) => exportPreprocessZip({
  project,
  includeAlignedImage: false,
  includeProjectJson: false,
});

const rebuildRuntimeProjection = (project: PreprocessProject): PreprocessProject => {
  const cropWidth = project.cropQc.cropWidth;
  const cropHeight = project.cropQc.cropHeight;

  if (typeof cropWidth !== 'number' || cropWidth <= 0 || typeof cropHeight !== 'number' || cropHeight <= 0) {
    throw new Error('Runtime chip projection reconstruction requires crop dimensions.');
  }

  const chipConfigData = createMockChipConfigData();

  return {
    ...project,
    chipConfig: {
      ...project.chipConfig,
      projectedSpots: projectSpotsForCrop({
        chip: chipConfigData.manifest,
        templateEntries: chipConfigData.templateEntries,
        cropWidth,
        cropHeight,
      }),
    },
  };
};

describe('exportBundle canonical matrix exports', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
    mockLoadChipConfigData.mockReset();
    mockLoadChipConfigData.mockResolvedValue(createMockChipConfigData());
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

  it('writes tissue_positions.csv using canonical 50um full-resolution coordinates and matrix-derived in_tissue flags', async () => {
    const project = createBaseProject();

    const result = await exportProject(project);
    const rowsByBarcode = indexRowsByBarcode(await readExportedTissuePositions(result.blob));

    expect(rowsByBarcode.get('barcode-spot-a')).toEqual({
      barcode: 'barcode-spot-a',
      in_tissue: 1,
      array_row: 1,
      array_col: 1,
      pxl_row_in_fullres: 75,
      pxl_col_in_fullres: 75,
    });
    expect(rowsByBarcode.get('barcode-spot-b')).toEqual({
      barcode: 'barcode-spot-b',
      in_tissue: 0,
      array_row: 1,
      array_col: 2,
      pxl_row_in_fullres: 75,
      pxl_col_in_fullres: 175,
    });
    expect(rowsByBarcode.get('barcode-spot-c')).toEqual({
      barcode: 'barcode-spot-c',
      in_tissue: 0,
      array_row: 2,
      array_col: 1,
      pxl_row_in_fullres: 175,
      pxl_col_in_fullres: 75,
    });
    expect(rowsByBarcode.get('barcode-spot-d')).toEqual({
      barcode: 'barcode-spot-d',
      in_tissue: 1,
      array_row: 64,
      array_col: 64,
      pxl_row_in_fullres: 6375,
      pxl_col_in_fullres: 6375,
    });
  });

  it('changes only matrix-derived in_tissue flags while keeping exported pxl coordinates identical', async () => {
    const baselineProject = createBaseProject();
    const changedMembershipProject = createBaseProject();
    changedMembershipProject.tissueSelection.matrix = createMatrix(64, 64, [
      [1, 2],
      [64, 64],
    ]);

    const baselineResult = await exportProject(baselineProject);
    const changedMembershipResult = await exportProject(changedMembershipProject);
    const baselineRows = await readExportedTissuePositions(baselineResult.blob);
    const changedMembershipRows = await readExportedTissuePositions(changedMembershipResult.blob);
    const changedMembershipRowsByBarcode = indexRowsByBarcode(changedMembershipRows);

    expect(getPreprocessZipExportReadiness(baselineProject)).toMatchObject({
      canExport: true,
    });
    expect(getPreprocessZipExportReadiness(changedMembershipProject)).toMatchObject({
      canExport: true,
    });

    expect(changedMembershipRows.map((row) => ({
      barcode: row.barcode,
      array_row: row.array_row,
      array_col: row.array_col,
      pxl_row_in_fullres: row.pxl_row_in_fullres,
      pxl_col_in_fullres: row.pxl_col_in_fullres,
    }))).toEqual(baselineRows.map((row) => ({
      barcode: row.barcode,
      array_row: row.array_row,
      array_col: row.array_col,
      pxl_row_in_fullres: row.pxl_row_in_fullres,
      pxl_col_in_fullres: row.pxl_col_in_fullres,
    })));
    expect(changedMembershipRowsByBarcode.get('barcode-spot-a')?.in_tissue).toBe(0);
    expect(changedMembershipRowsByBarcode.get('barcode-spot-b')?.in_tissue).toBe(1);
    expect(changedMembershipRowsByBarcode.get('barcode-spot-c')?.in_tissue).toBe(0);
    expect(changedMembershipRowsByBarcode.get('barcode-spot-d')?.in_tissue).toBe(1);
  });

  it('preserves the persisted crop/QC spot diameter in scalefactors_json.json when it is valid', async () => {
    const project = createBaseProject();

    const result = await exportProject(project);
    const scalefactors = await readExportedScalefactors(result.blob);

    expect(scalefactors.spot_diameter_fullres).toBe(18);
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
    const packagedProject = await serializePreprocessProject(migratedProject);
    const packagedPayload = JSON.parse(await packagedProject.text()) as PackagedProjectPayload;

    expect(packagedPayload.version).toBe(PACKAGE_VERSION);
    expect(packagedPayload.project.chipConfig.projectedSpots).toBeNull();
    expect(Object.hasOwn(packagedPayload.project.chipConfig, 'projectedSpotIndex')).toBe(false);

    const validatedProject = await deserializePreprocessProject(packagedProject);

    expect(validatedProject.chipConfig.projectedSpots).toBeNull();
    expect(Object.hasOwn(validatedProject.chipConfig, 'projectedSpotIndex')).toBe(false);

    const runtimeProject = rebuildRuntimeProjection(validatedProject);

    expect(getPreprocessZipExportReadiness(runtimeProject)).toMatchObject({ canExport: true });

    const result = await exportProject(runtimeProject);
    const matrixCsv = await readZipText(result.blob, 'tissue_matrix.csv');
    const rows = matrixCsv.trim().split('\n').map((line) => line.split(','));
    const positionsByBarcode = indexRowsByBarcode(await readExportedTissuePositions(result.blob));
    const scalefactors = await readExportedScalefactors(result.blob);

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
    expect(positionsByBarcode.get('barcode-spot-a')).toEqual({
      barcode: 'barcode-spot-a',
      in_tissue: 0,
      array_row: 1,
      array_col: 1,
      pxl_row_in_fullres: 75,
      pxl_col_in_fullres: 75,
    });
    expect(positionsByBarcode.get('barcode-spot-b')).toEqual({
      barcode: 'barcode-spot-b',
      in_tissue: 0,
      array_row: 1,
      array_col: 2,
      pxl_row_in_fullres: 75,
      pxl_col_in_fullres: 175,
    });
    expect(positionsByBarcode.get('barcode-spot-c')).toEqual({
      barcode: 'barcode-spot-c',
      in_tissue: 0,
      array_row: 2,
      array_col: 1,
      pxl_row_in_fullres: 175,
      pxl_col_in_fullres: 75,
    });
    expect(positionsByBarcode.get('barcode-spot-d')).toEqual({
      barcode: 'barcode-spot-d',
      in_tissue: 1,
      array_row: 64,
      array_col: 64,
      pxl_row_in_fullres: 6375,
      pxl_col_in_fullres: 6375,
    });
    expect(scalefactors.spot_diameter_fullres).toBe(18);
  });

  it('falls back to export geometry for spot diameter after canonical package round-trip with rotated eosin reference geometry', async () => {
    const project = createBaseProject();
    project.cropQc.spot_diameter_fullres = null;
    project.cropQc.eosinReferenceGeometry = {
      rect: {
        x: 80,
        y: 35,
        width: 6300,
        height: 6300,
      },
      width: 640,
      height: 640,
    };
    project.cropQc.cropRect = {
      x: 80,
      y: 35,
      width: 6300,
      height: 6300,
    };
    project.heFocus.chipBounds = {
      x: 35,
      y: 80,
      width: 6300,
      height: 6300,
    };
    project.cropQc.heQcGeometry = {
      rect: { ...project.heFocus.chipBounds },
      width: 640,
      height: 640,
    };

    const packagedProject = await serializePreprocessProject(project);
    const packagedPayload = JSON.parse(await packagedProject.text()) as PackagedProjectPayload;
    const hydratedProject = await deserializePreprocessProject(packagedProject);
    const runtimeProject = rebuildRuntimeProjection(hydratedProject);

    expect(packagedPayload.version).toBe(PACKAGE_VERSION);
    expect(packagedPayload.project.chipConfig.projectedSpots).toBeNull();
    expect(Object.hasOwn(packagedPayload.project.chipConfig, 'projectedSpotIndex')).toBe(false);
    expect(hydratedProject.chipConfig.projectedSpots).toBeNull();
    expect(Object.hasOwn(hydratedProject.chipConfig, 'projectedSpotIndex')).toBe(false);
    expect(getPreprocessZipExportReadiness(runtimeProject)).toMatchObject({ canExport: true });

    const result = await exportProject(runtimeProject);
    const archive = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const positionsByBarcode = indexRowsByBarcode(await readExportedTissuePositions(result.blob));
    const scalefactors = await readExportedScalefactors(result.blob);

    expect(Object.keys(archive.files).sort()).toEqual([
      'scalefactors_json.json',
      'tissue_fullres_image.png',
      'tissue_hires_image.png',
      'tissue_lowres_image.png',
      'tissue_matrix.csv',
      'tissue_positions.csv',
    ]);
    expect(positionsByBarcode.get('barcode-spot-a')).toMatchObject({
      array_row: 1,
      array_col: 1,
      pxl_row_in_fullres: 35,
      pxl_col_in_fullres: 80,
    });
    expect(positionsByBarcode.get('barcode-spot-b')).toMatchObject({
      array_row: 1,
      array_col: 2,
      pxl_row_in_fullres: 35,
      pxl_col_in_fullres: 180,
    });
    expect(positionsByBarcode.get('barcode-spot-c')).toMatchObject({
      array_row: 2,
      array_col: 1,
      pxl_row_in_fullres: 135,
      pxl_col_in_fullres: 80,
    });
    expect(positionsByBarcode.get('barcode-spot-d')).toMatchObject({
      array_row: 64,
      array_col: 64,
      pxl_row_in_fullres: 6335,
      pxl_col_in_fullres: 6380,
    });
    expect(scalefactors.spot_diameter_fullres).toBe(50);
  });
});
