import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  LegacyPreprocessProject,
  PreprocessProject,
  ProjectedSpot,
  TissueActivationValue,
  TissueRegion,
} from '@/types/built-in-admin';

import type { ChipConfigData } from './chipConfigs';
import { migratePreprocessProject } from './migrations';
import {
  deserializePreprocessProject,
  PACKAGE_VERSION,
  serializePreprocessProject,
} from './package';
import { projectSpotsForCrop } from './spotProjection';
import { applyExclusionLockToMatrix } from './exclusion';

const mockLoadChipConfigData = vi.hoisted(() => vi.fn());

vi.mock('./chipConfigs', () => ({
  loadChipConfigData: mockLoadChipConfigData,
}));

vi.mock('./tissueRegions', () => ({
  deriveSelectedSpotIdsFromRegions: () => ['spot-b'],
}));

import { exportPreprocessZip, getPreprocessZipExportReadiness } from './exportBundle';

const FULLRES_DIMENSIONS_UNAVAILABLE_ERROR = 'Full-resolution H&E crop image dimensions are unavailable. Regenerate crop QC before export.';

const createPngBytes = (width: number, height: number) => {
  const bytes = new Uint8Array(24);

  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);

  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);

  return bytes;
};

const createDataUrlFromBytes = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;

const createPngDataUrl = (width: number, height: number) => createDataUrlFromBytes(createPngBytes(width, height));

const readPngDimensions = (bytes: Uint8Array) => {
  expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(String.fromCharCode(...bytes.slice(12, 16))).toBe('IHDR');

  return {
    width: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16),
    height: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20),
  };
};

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

const createMock15umChipConfigData = (): ChipConfigData => ({
  manifest: {
    id: '15um',
    label: 'Square grid 15um',
    gridRows: 96,
    gridCols: 96,
    spotDiameter: 25,
    spotGap: 15,
    barcodeTemplatePath: '/unused/tissue_positions.csv',
    tissuePositionsPath: '/unused/tissue_positions.csv',
  },
  templateEntries: [
    {
      barcode: 'barcode-15um-spot-a',
      arrayRow: 1,
      arrayCol: 1,
      pxl_row_in_fullres: 33,
      pxl_col_in_fullres: 33,
    },
    {
      barcode: 'barcode-15um-spot-b',
      arrayRow: 1,
      arrayCol: 2,
      pxl_row_in_fullres: 33,
      pxl_col_in_fullres: 73,
    },
    {
      barcode: 'barcode-15um-spot-c',
      arrayRow: 2,
      arrayCol: 1,
      pxl_row_in_fullres: 73,
      pxl_col_in_fullres: 33,
    },
    {
      barcode: 'barcode-15um-spot-d',
      arrayRow: 96,
      arrayCol: 96,
      pxl_row_in_fullres: 3833,
      pxl_col_in_fullres: 3833,
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
  dataUrl: createPngDataUrl(1, 1),
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
  // Normalized coordinates (0-1 range) for a 640x640 crop with 6300-pixel chip template span
  // The chip template coordinates span from 75 to 6375 (6300 pixels)
  // Normalized: 75/640 ≈ 0.117, 6300/640 ≈ 9.844 (the rect can exceed 1.0)
  rect: { x: 75 / 640, y: 75 / 640, width: 6300 / 640, height: 6300 / 640 },
  width: 640,
  height: 640,
} as const;

const defaultHeQcGeometry = {
  rect: { x: 35 / 640, y: 80 / 640, width: 6300 / 640, height: 6300 / 640 },
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
          fullres: { dataUrl: createPngDataUrl(640, 640) },
          hires: { dataUrl: createPngDataUrl(640, 640) },
          lowres: { dataUrl: createPngDataUrl(640, 640) },
        },
        he: {
          fullres: { dataUrl: createPngDataUrl(640, 640) },
          hires: { dataUrl: createPngDataUrl(640, 640) },
          lowres: { dataUrl: createPngDataUrl(640, 640) },
        },
      },
      tissue_hires_scalef: 0.5,
      tissue_lowres_scalef: 0.25,
      spot_diameter_fullres: 18,
      fiducial_diameter_fullres: 27,
      eosinPreviewDataUrl: createPngDataUrl(640, 640),
      previewDataUrl: createPngDataUrl(640, 640),
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
      spotDiameter: null,
      excludedRows: [],
      removeExcludedRowsFromExport: false,
      excludedColumns: [],
      barcodesByPosition: {},
      log2nGeneByPosition: {},
      csvFileName: null,
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

const create15umProject = (): PreprocessProject => {
  const project = createBaseProject();

  return {
    ...project,
    localization: {
      ...project.localization,
      chipType: '15um',
    },
    chipConfig: {
      ...project.chipConfig,
      chipType: '15um',
      rows: 96,
      columns: 96,
      pitchX: 15,
      pitchY: 15,
      projectedSpots: [
        createProjectedSpot('15um-spot-a', 1, 1),
        createProjectedSpot('15um-spot-b', 1, 2),
        createProjectedSpot('15um-spot-c', 2, 1),
        createProjectedSpot('15um-spot-d', 96, 96),
      ],
    },
    tissueSelection: {
      ...project.tissueSelection,
      autoSelectedSpotIds: [],
      matrix: createMatrix(96, 96, [
        [1, 1],
        [96, 96],
      ]),
      selectedSpotIds: [],
      regions: [],
      selectedRegionId: null,
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

const readExportedPngDimensions = async (blob: Blob, fileName: string) => {
  const archive = await JSZip.loadAsync(await blob.arrayBuffer());
  const file = archive.file(fileName);
  if (!file) {
    throw new Error(`Missing file in archive: ${fileName}`);
  }

  return readPngDimensions(await file.async('uint8array'));
};

const readZipBytes = async (blob: Blob, fileName: string) => {
  const archive = await JSZip.loadAsync(await blob.arrayBuffer());
  const file = archive.file(fileName);
  if (!file) {
    throw new Error(`Missing file in archive: ${fileName}`);
  }

  return file.async('uint8array');
};

const toExportArrayRow = (rows: number, runtimeArrayRow: number) => rows + 1 - runtimeArrayRow;

const createExpectedExportedTissuePositionRow = (args: {
  barcode: string;
  inTissue: number;
  rows: number;
  runtimeArrayRow: number;
  arrayCol: number;
  pxl_row_in_fullres: number;
  pxl_col_in_fullres: number;
}) => ({
  barcode: args.barcode,
  in_tissue: args.inTissue,
  array_row: toExportArrayRow(args.rows, args.runtimeArrayRow),
  array_col: args.arrayCol,
  pxl_row_in_fullres: args.pxl_row_in_fullres,
  pxl_col_in_fullres: args.pxl_col_in_fullres,
} satisfies ExportedTissuePositionRow);

const sortExportedTissuePositionRowsByArrayPosition = (rows: ExportedTissuePositionRow[]) => [...rows].sort((left, right) => (
  left.array_row - right.array_row || left.array_col - right.array_col
));

const stripMembershipFromExportedTissuePositionRow = (row: ExportedTissuePositionRow) => ({
  barcode: row.barcode,
  array_row: row.array_row,
  array_col: row.array_col,
  pxl_row_in_fullres: row.pxl_row_in_fullres,
  pxl_col_in_fullres: row.pxl_col_in_fullres,
});

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

const exportProjectWithAlignedImage = async (project: PreprocessProject) => exportPreprocessZip({
  project,
  includeAlignedImage: true,
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

  it('uses CSV barcodes in tissue_positions.csv and keeps template placeholders for missing positions', async () => {
    const project = createBaseProject();
    // Barcodes captured from the tissue activation CSV, keyed by in-memory
    // image-top array position (spot-a: row 1 col 1, spot-d: row 64 col 64).
    project.chipConfig.barcodesByPosition = {
      '1:1': 'real-barcode-a',
      '64:64': 'real-barcode-d',
    };

    const result = await exportProject(project);
    const rows = await readExportedTissuePositions(result.blob);

    // Exported rows use bottom-left array_row: spot-a (runtime row 1) exports
    // as array_row 64; the CSV barcode replaces the template placeholder.
    expect(rows.find((row) => row.array_col === 1 && row.array_row === 64)?.barcode).toBe('real-barcode-a');
    expect(rows.find((row) => row.array_col === 64 && row.array_row === 1)?.barcode).toBe('real-barcode-d');
    // Positions absent from the CSV keep the template placeholder barcodes.
    expect(rows.find((row) => row.array_col === 2 && row.array_row === 64)?.barcode).toBe('barcode-spot-b');
    expect(rows.find((row) => row.array_col === 1 && row.array_row === 63)?.barcode).toBe('barcode-spot-c');
  });

  it('keeps excluded rows in the full-grid tissue_positions.csv with in_tissue=0', async () => {
    const project = createBaseProject();
    // Simulate the Step 2 exclusion lock: row 1 cells forced inactive while
    // the grid keeps every array position (no compaction, no renumbering).
    project.chipConfig.excludedRows = [1];
    const matrix = project.tissueSelection.matrix;
    if (!matrix) throw new Error('fixture matrix missing');
    project.tissueSelection.matrix = applyExclusionLockToMatrix(matrix, {
      excludedRows: [1],
      excludedColumns: [],
    });

    const result = await exportProject(project);
    const rows = await readExportedTissuePositions(result.blob);

    // Full grid retained: all four spots present with unchanged array rows.
    expect(rows.map((row) => row.barcode)).toEqual([
      'barcode-spot-d',
      'barcode-spot-c',
      'barcode-spot-a',
      'barcode-spot-b',
    ]);
    // spot-a (row 1) was active in the matrix before the lock; excluded rows
    // export as in_tissue=0 while remaining in the CSV.
    expect(rows.find((row) => row.barcode === 'barcode-spot-a')?.in_tissue).toBe(0);
    // Unaffected rows keep their matrix truth.
    expect(rows.find((row) => row.barcode === 'barcode-spot-d')?.in_tissue).toBe(1);
  });

  it('removes excluded rows from tissue_positions.csv, compacts the grid, and renumbers the lower-left origin when the export toggle is on', async () => {
    const project = createBaseProject();
    project.chipConfig.excludedRows = [1];
    project.chipConfig.removeExcludedRowsFromExport = true;

    const result = await exportProject(project);
    const rows = await readExportedTissuePositions(result.blob);

    // Row 1 spots (spot-a, spot-b) are dropped entirely; the remaining grid is
    // compacted and array_row restarts at the bottom-most valid row.
    expect(rows.map((row) => row.barcode)).toEqual([
      'barcode-spot-d',
      'barcode-spot-c',
    ]);
    // spot-c: original row 2 → compressed row 1 → array_row 63.
    expect(rows.find((row) => row.barcode === 'barcode-spot-c')?.array_row).toBe(63);
    // spot-d: original row 64 → compressed row 63 → array_row 1 (new origin).
    expect(rows.find((row) => row.barcode === 'barcode-spot-d')?.array_row).toBe(1);
    // Pixel coordinates stay at the physical template positions (mapped into
    // the emitted fullres frame by the existing layout pipeline).
    expect(rows.find((row) => row.barcode === 'barcode-spot-d')).toMatchObject({
      pxl_row_in_fullres: 640,
      pxl_col_in_fullres: 640,
    });
  });

  it('drops excluded rows from tissue_matrix.csv when the export toggle is on', async () => {
    const project = createBaseProject();
    project.chipConfig.excludedRows = [1];
    project.chipConfig.removeExcludedRowsFromExport = true;

    const result = await exportProject(project);
    const matrixCsv = await readZipText(result.blob, 'tissue_matrix.csv');
    const rows = matrixCsv.trim().split('\n').map((line) => line.split(','));

    // 64 rows minus the excluded top row; each line still has 64 columns.
    expect(rows).toHaveLength(63);
    expect(rows.every((line) => line.length === 64)).toBe(true);
    // Original row 1 ([1,1] active) is gone; row 10 moved up to line 8 and
    // row 64 to line 62.
    expect(rows[0]?.[0]).toBe('0');
    expect(rows[8]?.[9]).toBe('1');
    expect(rows[62]?.[63]).toBe('1');
  });

  it('keeps excluded bottom rows removed with array_row renumbered when the export toggle is on', async () => {
    const project = createBaseProject();
    project.chipConfig.excludedRows = [64];
    project.chipConfig.removeExcludedRowsFromExport = true;

    const result = await exportProject(project);
    const rows = await readExportedTissuePositions(result.blob);

    // spot-d (bottom row) dropped; spot-a/b stay at compressed row 1 (array_row
    // 63) and spot-c at compressed row 2 (array_row 62).
    expect(rows.map((row) => row.barcode)).toEqual([
      'barcode-spot-c',
      'barcode-spot-a',
      'barcode-spot-b',
    ]);
    expect(rows.find((row) => row.barcode === 'barcode-spot-c')?.array_row).toBe(62);
    expect(rows.find((row) => row.barcode === 'barcode-spot-a')?.array_row).toBe(63);
    expect(rows.find((row) => row.barcode === 'barcode-spot-a')?.in_tissue).toBe(1);
  });

  it('remaps CSV barcodes to compressed rows when the export toggle is on', async () => {
    const project = createBaseProject();
    project.chipConfig.excludedRows = [1];
    project.chipConfig.removeExcludedRowsFromExport = true;
    project.chipConfig.barcodesByPosition = {
      '1:1': 'real-barcode-a',
      '2:1': 'real-barcode-c',
    };

    const result = await exportProject(project);
    const rows = await readExportedTissuePositions(result.blob);

    // Barcode of the dropped row is gone; the surviving row 2 barcode follows
    // its spot onto compressed row 1 (array_row 63).
    expect(rows.some((row) => row.barcode === 'real-barcode-a')).toBe(false);
    expect(rows.find((row) => row.barcode === 'real-barcode-c')?.array_row).toBe(63);
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

  it('writes 50um tissue_positions.csv sorted by exported array position with bottom-left array rows and emitted fullres image coordinates', async () => {
    const project = createBaseProject();

    const result = await exportProject(project);
    const rows = await readExportedTissuePositions(result.blob);

    expect(rows).toEqual(sortExportedTissuePositionRowsByArrayPosition(rows));
    expect(rows.map((row) => row.barcode)).toEqual([
      'barcode-spot-d',
      'barcode-spot-c',
      'barcode-spot-a',
      'barcode-spot-b',
    ]);
    // Template coordinates [75, 6375] are mapped to emitted fullres frame [0, 640]
    // Formula: output = (template - 75) / 6300 * 640
    expect(rows).toEqual(sortExportedTissuePositionRowsByArrayPosition([
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-spot-a',
        inTissue: 1,
        rows: 64,
        runtimeArrayRow: 1,
        arrayCol: 1,
        // (75 - 75) / 6300 * 640 = 0
        pxl_row_in_fullres: 0,
        pxl_col_in_fullres: 0,
      }),
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-spot-b',
        inTissue: 0,
        rows: 64,
        runtimeArrayRow: 1,
        arrayCol: 2,
        // Row: (75 - 75) / 6300 * 640 = 0
        // Col: (175 - 75) / 6300 * 640 = 10
        pxl_row_in_fullres: 0,
        pxl_col_in_fullres: 10,
      }),
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-spot-c',
        inTissue: 0,
        rows: 64,
        runtimeArrayRow: 2,
        arrayCol: 1,
        // Row: (175 - 75) / 6300 * 640 = 10
        // Col: (75 - 75) / 6300 * 640 = 0
        pxl_row_in_fullres: 10,
        pxl_col_in_fullres: 0,
      }),
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-spot-d',
        inTissue: 1,
        rows: 64,
        runtimeArrayRow: 64,
        arrayCol: 64,
        // (6375 - 75) / 6300 * 640 = 640
        pxl_row_in_fullres: 640,
        pxl_col_in_fullres: 640,
      }),
    ]));
  });

  it('writes tissue_positions.csv in the emitted fullres image coordinate frame when crop metadata is stale', async () => {
    const project = createBaseProject();
    const staleCropWidth = 1050;
    const emittedFullresWidth = 5705;
    const emittedFullresHeight = 5705;
    const emittedFullresDataUrl = createPngDataUrl(emittedFullresWidth, emittedFullresHeight);

    project.cropQc.cropWidth = staleCropWidth;
    project.cropQc.cropHeight = staleCropWidth;
    if (!project.cropQc.cropAssets?.eosin || !project.cropQc.cropAssets?.he) {
      throw new Error('Expected canonical crop assets in test fixture.');
    }
    project.cropQc.cropAssets.eosin.fullres.dataUrl = emittedFullresDataUrl;
    project.cropQc.cropAssets.eosin.hires.dataUrl = emittedFullresDataUrl;
    project.cropQc.cropAssets.eosin.lowres.dataUrl = emittedFullresDataUrl;
    project.cropQc.cropAssets.he.fullres.dataUrl = emittedFullresDataUrl;
    project.cropQc.cropAssets.he.hires.dataUrl = emittedFullresDataUrl;
    project.cropQc.cropAssets.he.lowres.dataUrl = emittedFullresDataUrl;
    project.cropQc.eosinPreviewDataUrl = emittedFullresDataUrl;
    project.cropQc.previewDataUrl = emittedFullresDataUrl;

    const result = await exportProject(project);
    const archive = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const rows = await readExportedTissuePositions(result.blob);
    const dimensions = await readExportedPngDimensions(result.blob, 'tissue_fullres_image.png');

    expect(dimensions).toEqual({ width: emittedFullresWidth, height: emittedFullresHeight });
    expect(rows).toEqual(sortExportedTissuePositionRowsByArrayPosition(rows));
    expect(rows.map((row) => row.barcode)).toEqual([
      'barcode-spot-d',
      'barcode-spot-c',
      'barcode-spot-a',
      'barcode-spot-b',
    ]);
    expect(rows).toEqual(sortExportedTissuePositionRowsByArrayPosition([
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-spot-a',
        inTissue: 1,
        rows: 64,
        runtimeArrayRow: 1,
        arrayCol: 1,
        pxl_row_in_fullres: 0,
        pxl_col_in_fullres: 0,
      }),
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-spot-b',
        inTissue: 0,
        rows: 64,
        runtimeArrayRow: 1,
        arrayCol: 2,
        pxl_row_in_fullres: 0,
        pxl_col_in_fullres: 91,
      }),
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-spot-c',
        inTissue: 0,
        rows: 64,
        runtimeArrayRow: 2,
        arrayCol: 1,
        pxl_row_in_fullres: 91,
        pxl_col_in_fullres: 0,
      }),
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-spot-d',
        inTissue: 1,
        rows: 64,
        runtimeArrayRow: 64,
        arrayCol: 64,
        pxl_row_in_fullres: 5705,
        pxl_col_in_fullres: 5705,
      }),
    ]));
    expect(archive.file('tissue_fullres_image.png')).toBeTruthy();
  });

  it('does not swap row and column scaling for asymmetric emitted fullres images', async () => {
    const project = createBaseProject();
    const emittedFullresWidth = 4200;
    const emittedFullresHeight = 5705;
    const emittedFullresDataUrl = createPngDataUrl(emittedFullresWidth, emittedFullresHeight);

    project.cropQc.cropWidth = 1050;
    project.cropQc.cropHeight = 1050;
    if (!project.cropQc.cropAssets?.eosin || !project.cropQc.cropAssets?.he) {
      throw new Error('Expected canonical crop assets in test fixture.');
    }
    project.cropQc.cropAssets.eosin.fullres.dataUrl = emittedFullresDataUrl;
    project.cropQc.cropAssets.eosin.hires.dataUrl = emittedFullresDataUrl;
    project.cropQc.cropAssets.eosin.lowres.dataUrl = emittedFullresDataUrl;
    project.cropQc.cropAssets.he.fullres.dataUrl = emittedFullresDataUrl;
    project.cropQc.cropAssets.he.hires.dataUrl = emittedFullresDataUrl;
    project.cropQc.cropAssets.he.lowres.dataUrl = emittedFullresDataUrl;
    project.cropQc.eosinPreviewDataUrl = emittedFullresDataUrl;
    project.cropQc.previewDataUrl = emittedFullresDataUrl;

    const result = await exportProject(project);
    const rows = await readExportedTissuePositions(result.blob);
    const dimensions = await readExportedPngDimensions(result.blob, 'tissue_fullres_image.png');

    expect(dimensions).toEqual({ width: emittedFullresWidth, height: emittedFullresHeight });
    expect(rows).toEqual(sortExportedTissuePositionRowsByArrayPosition(rows));
    expect(rows.map((row) => row.barcode)).toEqual([
      'barcode-spot-d',
      'barcode-spot-c',
      'barcode-spot-a',
      'barcode-spot-b',
    ]);
    expect(rows).toEqual(sortExportedTissuePositionRowsByArrayPosition([
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-spot-a',
        inTissue: 1,
        rows: 64,
        runtimeArrayRow: 1,
        arrayCol: 1,
        pxl_row_in_fullres: 0,
        pxl_col_in_fullres: 0,
      }),
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-spot-b',
        inTissue: 0,
        rows: 64,
        runtimeArrayRow: 1,
        arrayCol: 2,
        pxl_row_in_fullres: 0,
        pxl_col_in_fullres: 67,
      }),
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-spot-c',
        inTissue: 0,
        rows: 64,
        runtimeArrayRow: 2,
        arrayCol: 1,
        pxl_row_in_fullres: 91,
        pxl_col_in_fullres: 0,
      }),
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-spot-d',
        inTissue: 1,
        rows: 64,
        runtimeArrayRow: 64,
        arrayCol: 64,
        pxl_row_in_fullres: 5705,
        pxl_col_in_fullres: 4200,
      }),
    ]));
  });

  it('changes only matrix-derived in_tissue flags while keeping exported barcode order, array coordinates, and top-left pxl coordinates identical', async () => {
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

    expect(changedMembershipRows.map((row) => row.barcode)).toEqual(baselineRows.map((row) => row.barcode));
    expect(changedMembershipRows.map(stripMembershipFromExportedTissuePositionRow)).toEqual(
      baselineRows.map(stripMembershipFromExportedTissuePositionRow),
    );
    expect(changedMembershipRowsByBarcode.get('barcode-spot-a')?.in_tissue).toBe(0);
    expect(changedMembershipRowsByBarcode.get('barcode-spot-b')?.in_tissue).toBe(1);
    expect(changedMembershipRowsByBarcode.get('barcode-spot-c')?.in_tissue).toBe(0);
    expect(changedMembershipRowsByBarcode.get('barcode-spot-d')?.in_tissue).toBe(1);
  });

  it('writes 15um tissue_positions.csv using the runtime row count for array_row inversion with emitted fullres coordinates', async () => {
    mockLoadChipConfigData.mockResolvedValue(createMock15umChipConfigData());
    const project = create15umProject();

    const result = await exportProject(project);
    const rows = await readExportedTissuePositions(result.blob);

    expect(rows).toEqual(sortExportedTissuePositionRowsByArrayPosition(rows));
    expect(rows.map((row) => row.barcode)).toEqual([
      'barcode-15um-spot-d',
      'barcode-15um-spot-c',
      'barcode-15um-spot-a',
      'barcode-15um-spot-b',
    ]);
    // 15um template range [33, 3833] mapped to emitted fullres frame [0, 640]
    // Formula: output = (template - 33) / 3800 * 640
    expect(rows).toEqual(sortExportedTissuePositionRowsByArrayPosition([
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-15um-spot-a',
        inTissue: 1,
        rows: 96,
        runtimeArrayRow: 1,
        arrayCol: 1,
        // (33 - 33) / 3800 * 640 = 0
        pxl_row_in_fullres: 0,
        pxl_col_in_fullres: 0,
      }),
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-15um-spot-b',
        inTissue: 0,
        rows: 96,
        runtimeArrayRow: 1,
        arrayCol: 2,
        // Row: (33 - 33) / 3800 * 640 = 0
        // Col: (73 - 33) / 3800 * 640 = 7
        pxl_row_in_fullres: 0,
        pxl_col_in_fullres: 7,
      }),
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-15um-spot-c',
        inTissue: 0,
        rows: 96,
        runtimeArrayRow: 2,
        arrayCol: 1,
        // Row: (73 - 33) / 3800 * 640 = 7
        // Col: (33 - 33) / 3800 * 640 = 0
        pxl_row_in_fullres: 7,
        pxl_col_in_fullres: 0,
      }),
      createExpectedExportedTissuePositionRow({
        barcode: 'barcode-15um-spot-d',
        inTissue: 1,
        rows: 96,
        runtimeArrayRow: 96,
        arrayCol: 96,
        // (3833 - 33) / 3800 * 640 = 640
        pxl_row_in_fullres: 640,
        pxl_col_in_fullres: 640,
      }),
    ]));
  });

  it('derives spot_diameter_fullres from export geometry instead of persisted crop/QC metadata', async () => {
    const project = createBaseProject();

    const result = await exportProject(project);
    const scalefactors = await readExportedScalefactors(result.blob);

    expect(scalefactors.spot_diameter_fullres).toBeCloseTo(5.08, 1);
  });

  it('writes 64 rows with 64 columns per row for supported 50um exports', async () => {
    const project = createBaseProject();

    const result = await exportProject(project);
    const matrixCsv = await readZipText(result.blob, 'tissue_matrix.csv');
    const rows = matrixCsv.trim().split('\n');

    expect(rows).toHaveLength(64);
    expect(rows.every((line) => line.split(',').length === 64)).toBe(true);
  });

  it('writes aligned_tissue_image.png from the accepted checkerboard Crop/QC image', async () => {
    const checkerboardBytes = createPngBytes(32, 48);
    const checkerboardDataUrl = createDataUrlFromBytes(checkerboardBytes);
    const project = createBaseProject();
    const checkerboardPreview = project.cropQc.checkerboardPreview;
    if (!checkerboardPreview) {
      throw new Error('Test fixture is missing checkerboard preview state.');
    }
    checkerboardPreview.dataUrl = checkerboardDataUrl;
    project.cropQc.checkerboardPreviewDataUrl = checkerboardDataUrl;

    const result = await exportProjectWithAlignedImage(project);

    await expect(readZipBytes(result.blob, 'aligned_tissue_image.png')).resolves.toEqual(checkerboardBytes);
    await expect(readZipBytes(result.blob, 'tissue_fullres_image.png')).resolves.not.toEqual(checkerboardBytes);
  });

  it('blocks aligned image export when accepted checkerboard Crop/QC data is missing', async () => {
    const project = createBaseProject();

    const readiness = getPreprocessZipExportReadiness(project, { includeAlignedImage: true });

    expect(readiness).toEqual({
      canExport: false,
      reason: 'Registered H&E image export requires checkerboard crop QC data.',
    });
    await expect(exportProjectWithAlignedImage(project)).rejects.toThrow('Registered H&E image export requires checkerboard crop QC data.');
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
    // Template coordinates [75, 6375] mapped to emitted fullres frame [0, 640]
    expect(positionsByBarcode.get('barcode-spot-a')).toEqual(createExpectedExportedTissuePositionRow({
      barcode: 'barcode-spot-a',
      inTissue: 0,
      rows: 64,
      runtimeArrayRow: 1,
      arrayCol: 1,
      // (75 - 75) / 6300 * 640 = 0
      pxl_row_in_fullres: 0,
      pxl_col_in_fullres: 0,
    }));
    expect(positionsByBarcode.get('barcode-spot-b')).toEqual(createExpectedExportedTissuePositionRow({
      barcode: 'barcode-spot-b',
      inTissue: 0,
      rows: 64,
      runtimeArrayRow: 1,
      arrayCol: 2,
      // Row: (75 - 75) / 6300 * 640 = 0
      // Col: (175 - 75) / 6300 * 640 = 10
      pxl_row_in_fullres: 0,
      pxl_col_in_fullres: 10,
    }));
    expect(positionsByBarcode.get('barcode-spot-c')).toEqual(createExpectedExportedTissuePositionRow({
      barcode: 'barcode-spot-c',
      inTissue: 0,
      rows: 64,
      runtimeArrayRow: 2,
      arrayCol: 1,
      // Row: (175 - 75) / 6300 * 640 = 10
      // Col: (75 - 75) / 6300 * 640 = 0
      pxl_row_in_fullres: 10,
      pxl_col_in_fullres: 0,
    }));
    expect(positionsByBarcode.get('barcode-spot-d')).toEqual(createExpectedExportedTissuePositionRow({
      barcode: 'barcode-spot-d',
      inTissue: 1,
      rows: 64,
      runtimeArrayRow: 64,
      arrayCol: 64,
      // (6375 - 75) / 6300 * 640 = 640
      pxl_row_in_fullres: 640,
      pxl_col_in_fullres: 640,
    }));
    expect(scalefactors.spot_diameter_fullres).toBeCloseTo(5.08, 1);
  });

  it('falls back to export geometry for spot diameter after canonical package round-trip with eosin reference geometry', async () => {
    const project = createBaseProject();
    project.cropQc.spot_diameter_fullres = null;
    // eosinReferenceGeometry maps to the emitted fullres frame bounds
    project.cropQc.eosinReferenceGeometry = {
      rect: { x: 0, y: 0, width: 1, height: 1 },
      width: 640,
      height: 640,
    };
    project.cropQc.heQcGeometry = null;

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
    // Template coordinates [75, 6375] mapped to emitted fullres frame [0, 640]
    expect(positionsByBarcode.get('barcode-spot-a')).toMatchObject({
      array_row: toExportArrayRow(64, 1),
      array_col: 1,
      // (75 - 75) / 6300 * 640 = 0
      pxl_row_in_fullres: 0,
      pxl_col_in_fullres: 0,
    });
    expect(positionsByBarcode.get('barcode-spot-b')).toMatchObject({
      array_row: toExportArrayRow(64, 1),
      array_col: 2,
      // Row: 0, Col: (175 - 75) / 6300 * 640 = 10
      pxl_row_in_fullres: 0,
      pxl_col_in_fullres: 10,
    });
    expect(positionsByBarcode.get('barcode-spot-c')).toMatchObject({
      array_row: toExportArrayRow(64, 2),
      array_col: 1,
      // Row: (175 - 75) / 6300 * 640 = 10, Col: 0
      pxl_row_in_fullres: 10,
      pxl_col_in_fullres: 0,
    });
    expect(positionsByBarcode.get('barcode-spot-d')).toMatchObject({
      array_row: toExportArrayRow(64, 64),
      array_col: 64,
      // (6375 - 75) / 6300 * 640 = 640
      pxl_row_in_fullres: 640,
      pxl_col_in_fullres: 640,
    });
    // With eosinReferenceGeometry mapping to the emitted fullres frame (640px):
    // - Template span: 6300px, emitted fullres span: 640px
    // - Spot pitch: (100 / 6300) * 640 ≈ 10.16px
    // - Diameter: 10.16 * 0.5 ≈ 5.08px
    expect(scalefactors.spot_diameter_fullres).toBeCloseTo(5.08, 1);
  });

  it('throws a clear error when data URL fullres PNG dimensions are unavailable', async () => {
    const project = createBaseProject();
    const malformedPngBytes = createPngBytes(0, 1);
    if (!project.cropQc.cropAssets?.eosin || !project.cropQc.cropAssets?.he) {
      throw new Error('Expected canonical crop assets in test fixture.');
    }
    project.cropQc.cropAssets.he.fullres.dataUrl = createDataUrlFromBytes(malformedPngBytes);

    await expect(exportProject(project)).rejects.toThrow(FULLRES_DIMENSIONS_UNAVAILABLE_ERROR);
  });

  it('throws a clear error when blob URL fullres PNG dimensions are unavailable', async () => {
    const malformedPngBytes = createPngBytes(3, 5);
    malformedPngBytes.set([0x42, 0x41, 0x44, 0x21], 12);
    const blob = new Blob([malformedPngBytes], { type: 'image/png' });
    const blobUrl = URL.createObjectURL(blob);

    const project = createBaseProject();
    if (!project.cropQc.cropAssets?.eosin || !project.cropQc.cropAssets?.he) {
      throw new Error('Expected canonical crop assets in test fixture.');
    }
    project.cropQc.cropAssets.he.fullres.dataUrl = blobUrl;

    try {
      await expect(exportProject(project)).rejects.toThrow(FULLRES_DIMENSIONS_UNAVAILABLE_ERROR);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  });

  it('exports successfully when crop assets use blob: URLs from IndexedDB hydration', async () => {
    const pngBytes = createPngBytes(3, 5);
    const blob = new Blob([pngBytes], { type: 'image/png' });
    const blobUrl = URL.createObjectURL(blob);

    const project = createBaseProject();
    if (!project.cropQc.cropAssets?.eosin || !project.cropQc.cropAssets?.he) {
      throw new Error('Expected canonical crop assets in test fixture.');
    }
    project.cropQc.cropAssets.he.fullres.dataUrl = blobUrl;
    project.cropQc.cropAssets.he.hires.dataUrl = blobUrl;
    project.cropQc.cropAssets.he.lowres.dataUrl = blobUrl;

    const result = await exportProject(project);

    expect(result.blob).toBeInstanceOf(Blob);
    const archive = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const fullresFile = archive.file('tissue_fullres_image.png');
    expect(fullresFile).toBeTruthy();
    expect(archive.file('tissue_hires_image.png')).toBeTruthy();
    expect(archive.file('tissue_lowres_image.png')).toBeTruthy();

    if (!fullresFile) {
      throw new Error('Missing file in archive: tissue_fullres_image.png');
    }

    const fullresData = await fullresFile.async('uint8array');
    expect(readPngDimensions(fullresData)).toEqual({ width: 3, height: 5 });
    expect(fullresData).toEqual(pngBytes);

    URL.revokeObjectURL(blobUrl);
  });
});
