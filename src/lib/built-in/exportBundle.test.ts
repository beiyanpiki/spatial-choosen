import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import { buildEmptyPreprocessProject } from '@/app/built-in/projectState';
import type { PreprocessProject, ProjectedSpot } from '@/types/built-in';

const mockReencodeImageAsPngBlob = vi.hoisted(() => vi.fn());
const mockCreateThumbnailBlob = vi.hoisted(() => vi.fn());

vi.mock('./sourceImage', () => ({
  reencodeImageAsPngBlob: mockReencodeImageAsPngBlob,
  createThumbnailBlob: mockCreateThumbnailBlob,
  getDownsampledDimensions: (sourceWidth: number, sourceHeight: number, maxEdge: number) => {
    const longestEdge = Math.max(sourceWidth, sourceHeight);
    const scale = longestEdge > 0 ? Math.min(1, maxEdge / longestEdge) : 1;
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
    };
  },
}));

import { exportBuiltInZip, getBuiltInZipExportReadiness } from './exportBundle';

const createPngBlob = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02])], { type: 'image/png' });

const createSpot = (
  id: string,
  arrayRow: number,
  arrayCol: number,
  x: number,
  y: number,
): ProjectedSpot => ({
  id,
  barcode: id,
  arrayRow,
  arrayCol,
  x,
  y,
  width: 0.1,
  height: 0.2,
  diameterX: 0.1,
  diameterY: 0.2,
});

const createExportableProject = (): PreprocessProject => {
  const project = buildEmptyPreprocessProject('Built-in Export');
  project.sourceAssets = {
    ...project.sourceAssets,
    status: 'complete',
    images: {
      he: {
        id: 'he-source',
        kind: 'he',
        fileName: 'he.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        width: 4000,
        height: 2000,
        lastModified: 1,
        dataUrl: 'data:image/png;base64,AA==',
      },
    },
  };
  project.chipConfig = {
    ...project.chipConfig,
    status: 'complete',
    chipType: '15um',
    rows: 96,
    columns: 96,
    pitchX: 15,
    pitchY: 15,
    spotDiameter: 25,
    placement: { x: 0, y: 0, scale: 2 },
    excludedRows: [2],
    excludedColumns: [3],
    barcodesByPosition: {
      '1:1': 'BC-REAL-11',
      '3:2': 'BC-REAL-32',
    },
  };
  project.tissueSelection = {
    ...project.tissueSelection,
    status: 'complete',
    mode: 'matrix',
    matrix: {
      rows: 96,
      columns: 96,
      values: Array.from({ length: 96 * 96 }, () => 0 as 0 | 1),
    },
    supportState: 'supported',
    unsupportedReason: null,
  };
  // In-memory rows are grid-top origin; activation at positions (1,1) and (3,2).
  project.tissueSelection.matrix!.values[(1 - 1) * 96 + (1 - 1)] = 1;
  project.tissueSelection.matrix!.values[(3 - 1) * 96 + (2 - 1)] = 1;
  return project;
};

// In-memory rows are grid-top origin (projectSpotsForPlacement places arrayRow 1
// at the top), so the top row has the smallest y in image space.
const createExportableSpots = (): ProjectedSpot[] => [
  createSpot('spot-a', 1, 1, 0.1, 0.2),
  createSpot('spot-b', 1, 2, 0.5, 0.2),
  createSpot('spot-c', 1, 3, 0.9, 0.2),
  createSpot('spot-d', 2, 1, 0.1, 0.5),
  createSpot('spot-e', 3, 1, 0.1, 0.8),
  createSpot('spot-f', 3, 2, 0.5, 0.8),
];

describe('getBuiltInZipExportReadiness', () => {
  it('allows export for a complete project', () => {
    const readiness = getBuiltInZipExportReadiness(createExportableProject(), createExportableSpots());

    expect(readiness.canExport).toBe(true);
    if (readiness.canExport) {
      expect(readiness.data.spotDiameterFullres).toBe(50);
      expect(readiness.data.tissueHiresScale).toBe(0.5);
      expect(readiness.data.tissueLowresScale).toBe(0.2);
      // 96 rows minus excluded row 2; 96 cols minus excluded column 3.
      expect(readiness.data.visibleRows).toHaveLength(95);
      expect(readiness.data.visibleRows[0]).toBe(1);
      expect(readiness.data.visibleRows).not.toContain(2);
      expect(readiness.data.visibleCols).toHaveLength(95);
      expect(readiness.data.visibleCols).not.toContain(3);
    }
  });

  it('blocks export when the HE image is missing', () => {
    const project = createExportableProject();
    project.sourceAssets.images.he = null;

    const readiness = getBuiltInZipExportReadiness(project, createExportableSpots());

    expect(readiness).toMatchObject({ canExport: false, reason: expect.stringContaining('H&E source image is missing') });
  });

  it('blocks export when HE dimensions are unavailable', () => {
    const project = createExportableProject();
    project.sourceAssets.images.he!.width = null;

    const readiness = getBuiltInZipExportReadiness(project, createExportableSpots());

    expect(readiness).toMatchObject({ canExport: false, reason: expect.stringContaining('dimensions are unavailable') });
  });

  it('blocks export when the chip config is stale or incomplete', () => {
    const project = createExportableProject();
    project.chipConfig.status = 'idle';

    const readiness = getBuiltInZipExportReadiness(project, createExportableSpots());

    expect(readiness).toMatchObject({ canExport: false, reason: expect.stringContaining('Reapply the chip grid') });
  });

  it('blocks export when placement is missing', () => {
    const project = createExportableProject();
    project.chipConfig.placement = null;

    const readiness = getBuiltInZipExportReadiness(project, createExportableSpots());

    expect(readiness).toMatchObject({ canExport: false, reason: expect.stringContaining('Chip projection geometry') });
  });

  it('blocks export when no spots are projected', () => {
    const readiness = getBuiltInZipExportReadiness(createExportableProject(), []);

    expect(readiness).toMatchObject({ canExport: false, reason: expect.stringContaining('Chip projection geometry') });
  });

  it('blocks export when tissue selection is stale', () => {
    const project = createExportableProject();
    project.tissueSelection.status = 'stale';

    const readiness = getBuiltInZipExportReadiness(project, createExportableSpots());

    expect(readiness).toMatchObject({ canExport: false, reason: expect.stringContaining('Tissue selection is stale') });
  });

  it('blocks export when the matrix is missing', () => {
    const project = createExportableProject();
    project.tissueSelection.matrix = null;

    const readiness = getBuiltInZipExportReadiness(project, createExportableSpots());

    expect(readiness).toMatchObject({ canExport: false, reason: expect.stringContaining('Tissue matrix data is missing') });
  });

  it('blocks export when the matrix dimensions mismatch the grid', () => {
    const project = createExportableProject();
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 64 * 64 }, () => 0 as 0 | 1),
    };

    const readiness = getBuiltInZipExportReadiness(project, createExportableSpots());

    expect(readiness).toMatchObject({ canExport: false, reason: expect.stringContaining('must match the projected chip rows and columns') });
  });

  it('blocks export when every row or column is excluded', () => {
    const project = createExportableProject();
    project.chipConfig.excludedRows = Array.from({ length: 96 }, (_, index) => index + 1);

    const readiness = getBuiltInZipExportReadiness(project, createExportableSpots());

    expect(readiness).toMatchObject({ canExport: false, reason: expect.stringContaining('All chip rows or columns are excluded') });
  });
});

describe('exportBuiltInZip', () => {
  it('builds a zip with the preprocess file naming and formats', async () => {
    mockReencodeImageAsPngBlob.mockResolvedValue(createPngBlob());
    mockCreateThumbnailBlob.mockResolvedValue(createPngBlob());

    const output = await exportBuiltInZip({
      project: createExportableProject(),
      projectedSpots: createExportableSpots(),
    });

    expect(output.fileName).toBe('Built-in Export-preprocess.zip');

    const zip = await JSZip.loadAsync(await output.blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
    expect(names.sort()).toEqual([
      'scalefactors_json.json',
      'tissue_fullres_image.png',
      'tissue_hires_image.png',
      'tissue_lowres_image.png',
      'tissue_matrix.csv',
      'tissue_positions.csv',
    ]);

    const scalefactors = JSON.parse(await zip.file('scalefactors_json.json')!.async('string'));
    expect(scalefactors).toEqual({
      spot_diameter_fullres: 50,
      fiducial_diameter_fullres: 0.027,
      tissue_hires_scalef: 0.5,
      tissue_lowres_scalef: 0.2,
    });

    expect(mockReencodeImageAsPngBlob).toHaveBeenCalledWith('data:image/png;base64,AA==');
    expect(mockCreateThumbnailBlob).toHaveBeenCalledWith('data:image/png;base64,AA==', 2000);
    expect(mockCreateThumbnailBlob).toHaveBeenCalledWith('data:image/png;base64,AA==', 800);
  });

  it('emits imported barcodes, compacted continuous rows/cols, and placed pixels', async () => {
    mockReencodeImageAsPngBlob.mockResolvedValue(createPngBlob());
    mockCreateThumbnailBlob.mockResolvedValue(createPngBlob());

    const output = await exportBuiltInZip({
      project: createExportableProject(),
      projectedSpots: createExportableSpots(),
    });

    const zip = await JSZip.loadAsync(await output.blob.arrayBuffer());
    const csv = await zip.file('tissue_positions.csv')!.async('string');

    expect(csv.split('\n')[0]).toBe('barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres');
    // Excluded row 2 and column 3 are dropped; remaining spots are renumbered
    // contiguously. array_row/array_col are 1-based from the bottom-left grid
    // corner (array_row 1 = image bottom); pxl_row/col are 0-based from the
    // top-left image corner. Barcodes come from the imported CSV map keyed by
    // the spot's ORIGINAL position, placeholders otherwise.
    expect(csv.trimEnd().split('\n').slice(1)).toEqual([
      'spot-e,0,94,1,1600,400',
      'BC-REAL-32,1,94,2,1600,2000',
      'BC-REAL-11,1,95,1,400,400',
      'spot-b,0,95,2,400,2000',
    ]);
  });

  it('emits a compacted tissue matrix over the visible rows and columns', async () => {
    mockReencodeImageAsPngBlob.mockResolvedValue(createPngBlob());
    mockCreateThumbnailBlob.mockResolvedValue(createPngBlob());

    const output = await exportBuiltInZip({
      project: createExportableProject(),
      projectedSpots: createExportableSpots(),
    });

    const zip = await JSZip.loadAsync(await output.blob.arrayBuffer());
    const csv = await zip.file('tissue_matrix.csv')!.async('string');

    // Excluded row 2 and column 3 leave a 95x95 compacted matrix. Rows are
    // emitted bottom-first to match tissue_positions.csv: the last line is the
    // in-memory row 1 (carries the (1,1) activation) and the second-to-last is
    // in-memory row 3 (carries the (3,2) activation).
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(95);
    expect(lines[0]).toBe(Array(95).fill('0').join(','));
    expect(lines[93]).toBe(['0', '1', ...Array(93).fill('0')].join(','));
    expect(lines[94]).toBe(['1', ...Array(94).fill('0')].join(','));
  });

  it('falls back to the default zip name when the project has no name', async () => {
    mockReencodeImageAsPngBlob.mockResolvedValue(createPngBlob());
    mockCreateThumbnailBlob.mockResolvedValue(createPngBlob());

    const project = createExportableProject();
    project.name = '';

    const output = await exportBuiltInZip({ project, projectedSpots: createExportableSpots() });

    expect(output.fileName).toBe('built-in-project-preprocess.zip');
  });

  it('throws the readiness reason when export is blocked', async () => {
    const project = createExportableProject();
    project.chipConfig.placement = null;

    await expect(exportBuiltInZip({ project, projectedSpots: createExportableSpots() })).rejects.toThrow(
      'Chip projection geometry or spot diameter metadata is missing. Reapply the chip grid before export.',
    );
  });
});
