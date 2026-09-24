import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeProjectForPersistence, normalizeProjectForWorkspace } from '@/app/preprocess/projectState';
import type { PreprocessProject, ProjectedSpot } from '@/types/preprocess';

import * as chipConfigs from './chipConfigs';
import { PREPROCESS_STORAGE_SCHEMA_VERSION } from './constants';
import { exportPreprocessZip } from './exportBundle';
import { serializePreprocessProject } from './package';
import { projectSpotsForCrop } from './spotProjection';
import {
  deletePreprocessProject,
  getPreprocessProject,
  parseTissueSelectionPayload,
  readPreprocessProjectSummaries,
  toStoredTissueSelectionPayload,
  upsertPreprocessProject,
  upsertPreprocessProjectMetadata,
} from './storage';

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

const createPngDataUrl = (width: number, height: number) => `data:image/png;base64,${Buffer.from(createPngBytes(width, height)).toString('base64')}`;

const PNG_DATA_URL = createPngDataUrl(200, 200);
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/2Q==';

const createCropAssetSet = () => ({
  fullres: { dataUrl: PNG_DATA_URL },
  hires: { dataUrl: PNG_DATA_URL },
  lowres: { dataUrl: PNG_DATA_URL },
});

const createCanonicalCropAssets = () => ({
  eosin: createCropAssetSet(),
  he: createCropAssetSet(),
});

const createSourceImage = (kind: 'eosin' | 'he') => ({
  id: `${kind}-source`,
  kind,
  fileName: `${kind}.png`,
  mimeType: 'image/png',
  sizeBytes: 1024,
  width: 4096,
  height: 2048,
  lastModified: 0,
});

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
  id: 'storage-project',
  name: 'Storage Project',
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
    chipType: '50um',
    rows: 64,
    columns: 64,
    pitchX: 50,
    pitchY: 50,
    origin: null,
    rotationDegrees: 0,
    projectedSpots: [
      createProjectedSpot('spot-a', 1, 1),
      createProjectedSpot('spot-b', 2, 2),
    ],
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
    paritySummary: null,
    warning: null,
    selectedSpotIds: ['spot-a', 'runtime-only-spot'],
    forcedInSpotIds: ['legacy-in'],
    forcedOutSpotIds: ['legacy-out'],
    overrideNotice: 'legacy',
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
    selectedRegionId: 'region-1',
    previewDataUrl: 'blob:legacy',
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

type ExportedTissuePositionRow = {
  barcode: string;
  in_tissue: number;
  array_row: number;
  array_col: number;
  pxl_row_in_fullres: number;
  pxl_col_in_fullres: number;
};

const readExportedTissuePositions = async (blob: Blob): Promise<ExportedTissuePositionRow[]> => {
  const archive = await JSZip.loadAsync(await blob.arrayBuffer());
  const file = archive.file('tissue_positions.csv');

  if (!file) {
    throw new Error('Missing tissue_positions.csv in export archive.');
  }

  return (await file.async('string'))
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
      };
    });
};

const indexRowsByBarcode = (rows: ExportedTissuePositionRow[]) => new Map(
  rows.map((row) => [row.barcode, row] as const),
);

class MemoryStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string) {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.map.set(key, value);
  }

  removeItem(key: string) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }
}

const createIndexedDbMock = (shouldFailPut: (storeName: string) => boolean = () => false) => {
  const stores = new Map<string, Map<string, string | Blob>>();

  const ensureStore = (name: string) => {
    if (!stores.has(name)) {
      stores.set(name, new Map());
    }

    const store = stores.get(name);
    if (!store) {
      throw new Error(`Missing mock IndexedDB store: ${name}`);
    }

    return store;
  };

  const database = {
    objectStoreNames: {
      contains: (name: string) => stores.has(name),
    },
    createObjectStore: (name: string) => ensureStore(name),
    transaction: (storeName: string) => {
      ensureStore(storeName);
      const tx: {
        oncomplete: (() => void) | null;
        onerror: (() => void) | null;
        onabort: (() => void) | null;
        error: Error | null;
        objectStore: (name: string) => {
          get: (key: string) => {
            onsuccess: (() => void) | null;
            onerror: (() => void) | null;
            result?: string | Blob;
            error: Error | null;
          };
          put: (value: string | Blob, key: string) => void;
          delete: (key: string) => void;
        };
        close: () => void;
      } = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        objectStore: (name: string) => {
          const target = ensureStore(name);

          return {
            get: (key: string) => {
              const request = {
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
                result: undefined as string | Blob | undefined,
                error: null,
              };

              queueMicrotask(() => {
                request.result = target.get(key);
                request.onsuccess?.();
                queueMicrotask(() => tx.oncomplete?.());
              });

              return request;
            },
            put: (value: string | Blob, key: string) => {
              if (shouldFailPut(name)) {
                tx.error = new Error(`Forced ${name} write failure`);
                queueMicrotask(() => tx.onerror?.());
                return;
              }
              target.set(key, value);
              queueMicrotask(() => tx.oncomplete?.());
            },
            delete: (key: string) => {
              target.delete(key);
              queueMicrotask(() => tx.oncomplete?.());
            },
          };
        },
        close: () => undefined,
      };

      return tx;
    },
    close: () => undefined,
  };

  return {
    open: () => {
      const request = {
        result: database,
        error: null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
      };

      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });

      return request;
    },
  };
};

describe('preprocess storage tissue metadata', () => {
  const localStorage = new MemoryStorage();

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('window', {
      localStorage,
      indexedDB: createIndexedDbMock(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const installImageProxyMocks = () => {
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 4096;
      naturalHeight = 2048;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }

    const currentWindow = window as typeof window & {
      Image?: typeof MockImage;
    };
    currentWindow.Image = MockImage;

    vi.stubGlobal('document', {
      createElement: (tagName: string) => {
        if (tagName !== 'canvas') {
          throw new Error(`Unexpected element requested: ${tagName}`);
        }

        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: vi.fn(),
          }),
          toBlob: (
            callback: BlobCallback,
            mimeType?: string,
          ) => {
            callback(new Blob([new Uint8Array(1024)], { type: mimeType ?? 'image/png' }));
          },
        };
      },
    });
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob) => `blob:${blob.type}:${blob.size}`);
  };

  it('hydrates legacy PNG working previews without regenerating them', async () => {
    const project = createProject();
    project.sourceAssets.images.eosin = createSourceImage('eosin');
    upsertPreprocessProjectMetadata(project);

    const stored = JSON.parse(localStorage.getItem('spatial-preprocess-projects') ?? '[]') as Array<{
      sourceAssets: {
        images: {
          eosin: Record<string, unknown>;
        };
      };
    }>;
    stored[0].sourceAssets.images.eosin = {
      ...stored[0].sourceAssets.images.eosin,
      dataUrl: PNG_DATA_URL,
      workingDataUrl: PNG_DATA_URL,
      workingWidth: 1000,
      workingHeight: 1000,
    };
    localStorage.setItem('spatial-preprocess-projects', JSON.stringify(stored));

    const hydrated = await getPreprocessProject(project.id);

    expect(hydrated?.sourceAssets.images.eosin?.dataUrl).toBe(PNG_DATA_URL);
    expect(hydrated?.sourceAssets.images.eosin?.workingDataUrl).toBe(PNG_DATA_URL);
    expect(hydrated?.sourceAssets.images.eosin?.workingWidth).toBe(1000);
    expect(hydrated?.sourceAssets.images.eosin?.workingHeight).toBe(1000);
  });

  it('regenerates missing working previews as JPEG proxies during hydration', async () => {
    installImageProxyMocks();
    const project = createProject();
    project.sourceAssets.images.eosin = createSourceImage('eosin');
    upsertPreprocessProjectMetadata(project);

    const stored = JSON.parse(localStorage.getItem('spatial-preprocess-projects') ?? '[]') as Array<{
      sourceAssets: {
        images: {
          eosin: Record<string, unknown>;
        };
      };
    }>;
    stored[0].sourceAssets.images.eosin = {
      ...stored[0].sourceAssets.images.eosin,
      dataUrl: PNG_DATA_URL,
      thumbnailDataUrl: JPEG_DATA_URL,
    };
    localStorage.setItem('spatial-preprocess-projects', JSON.stringify(stored));

    const hydrated = await getPreprocessProject(project.id);
    const image = hydrated?.sourceAssets.images.eosin;

    expect(image?.dataUrl).toBe(PNG_DATA_URL);
    expect(image?.workingBlob?.type).toBe('image/jpeg');
    expect(image?.workingDataUrl).toBe('blob:image/jpeg:1024');
    expect(image?.workingWidth).toBe(2048);
    expect(image?.workingHeight).toBe(1024);
  });

  it('parses valid versioned canonical tissue selection payloads', () => {
    const matrix = {
      rows: 2,
      columns: 2,
      values: [1, 0, 0, 1],
    };

    const result = parseTissueSelectionPayload(JSON.stringify({
      version: 1,
      tissueUpdatedAt: '2026-04-14T00:00:00.000Z',
      matrix,
      autoSelectedSpotIds: ['spot-a'],
    }));

    expect(result).toEqual({
      canonical: {
        version: 1,
        tissueUpdatedAt: '2026-04-14T00:00:00.000Z',
        matrix,
        autoSelectedSpotIds: ['spot-a'],
        spotStyle: { color: '#38A169', opacity: 0.8 },
      },
    });
  });

  it('creates versioned canonical tissue selection payloads from project tissue state', () => {
    const project = createProject();
    project.tissueSelection.updatedAt = '2026-04-15T00:00:00.000Z';

    expect(toStoredTissueSelectionPayload(project.tissueSelection)).toEqual({
      version: 1,
      tissueUpdatedAt: '2026-04-15T00:00:00.000Z',
      matrix: project.tissueSelection.matrix,
      autoSelectedSpotIds: ['spot-a'],
      spotStyle: { color: '#38A169', opacity: 0.8 },
    });

    project.tissueSelection.updatedAt = null;

    expect(toStoredTissueSelectionPayload(project.tissueSelection).tissueUpdatedAt).toBeNull();
  });

  it('parses null timestamp and null matrix canonical tissue selection payloads', () => {
    const result = parseTissueSelectionPayload(JSON.stringify({
      version: 1,
      tissueUpdatedAt: null,
      matrix: null,
      autoSelectedSpotIds: [],
    }));

    expect(result).toEqual({
      canonical: {
        version: 1,
        tissueUpdatedAt: null,
        matrix: null,
        autoSelectedSpotIds: [],
        spotStyle: { color: '#38A169', opacity: 0.8 },
      },
    });
  });

  it('detects legacy string-array tissue selection payloads', () => {
    expect(parseTissueSelectionPayload(JSON.stringify(['spot-a', 'spot-b']))).toEqual({
      legacy: ['spot-a', 'spot-b'],
    });
  });

  it.each([
    ['non-object payload', JSON.stringify('spot-a')],
    ['wrong version', JSON.stringify({ version: 2, tissueUpdatedAt: null, matrix: null, autoSelectedSpotIds: [] })],
    ['wrong matrix length', JSON.stringify({
      version: 1,
      tissueUpdatedAt: null,
      matrix: { rows: 2, columns: 2, values: [1, 0] },
      autoSelectedSpotIds: [],
    })],
    ['invalid timestamp type', JSON.stringify({ version: 1, tissueUpdatedAt: 123, matrix: null, autoSelectedSpotIds: [] })],
    ['non-binary matrix values', JSON.stringify({
      version: 1,
      tissueUpdatedAt: null,
      matrix: { rows: 2, columns: 2, values: [1, 0, 2, 0] },
      autoSelectedSpotIds: [],
    })],
    ['legacy array with non-string entries', JSON.stringify(['spot-a', 1])],
    ['invalid json', '{not-json'],
  ])('rejects malformed tissue selection payloads: %s', (_caseName, rawValue) => {
    expect(parseTissueSelectionPayload(rawValue)).toEqual({ invalid: true });
  });

  it('persists canonical matrix and support metadata while stripping runtime selectedSpotIds', async () => {
    const project = createProject();

    await upsertPreprocessProject(project);

    const stored = JSON.parse(localStorage.getItem('spatial-preprocess-projects') ?? '[]') as Array<Record<string, unknown>>;
    const storedChipConfig = stored[0]?.chipConfig as Record<string, unknown>;
    const storedTissue = stored[0]?.tissueSelection as Record<string, unknown>;

    expect(storedChipConfig.projectedSpots).toBeNull();
    expect(storedChipConfig.projectedSpotIndex).toEqual([
      { id: 'spot-a', arrayRow: 1, arrayCol: 1 },
      { id: 'spot-b', arrayRow: 2, arrayCol: 2 },
    ]);
    expect(Array.isArray(storedChipConfig.projectedSpots)).toBe(false);
    expect(storedTissue.supportState).toBe('supported');
    expect(storedTissue.unsupportedReason).toBeNull();
    // Matrix is stored as null in metadata and reconstructed during hydration from autoSelectedSpotIds
    expect(storedTissue.matrix).toBeNull();
    expect(storedTissue.selectedSpotIds).toBeNull();

    // Verify matrix is reconstructed during hydration
    const hydrated = await getPreprocessProject(project.id);
    expect(hydrated?.tissueSelection.matrix).toEqual(project.tissueSelection.matrix);
  });

  it('hydrates selectedSpotIds from canonical matrix truth instead of persisted runtime ids', async () => {
    const project = createProject();

    await upsertPreprocessProject(project);
    const hydrated = await getPreprocessProject(project.id);

    expect(hydrated?.tissueSelection.selectedSpotIds).toEqual(['spot-a']);
    expect(Object.hasOwn(hydrated?.tissueSelection ?? {}, 'forcedInSpotIds')).toBe(false);
    expect(Object.hasOwn(hydrated?.tissueSelection ?? {}, 'forcedOutSpotIds')).toBe(false);
    expect(Object.hasOwn(hydrated?.tissueSelection ?? {}, 'regions')).toBe(false);
    expect(Object.hasOwn(hydrated?.tissueSelection ?? {}, 'selectedRegionId')).toBe(false);
  });

  it('exports flipped serialized array_row values after storage hydration and runtime reprojection', async () => {
    const project = createProject();
    project.cropQc = {
      ...project.cropQc,
      cropWidth: 200,
      cropHeight: 200,
      heQcGeometry: {
        // Normalized coordinates - will be multiplied by cropWidth/cropHeight
        rect: {
          x: 75 / 200,
          y: 75 / 200,
          width: 100 / 200,
          height: 100 / 200,
        },
        width: 200,
        height: 200,
      },
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
    };

    const exportChipConfigData = {
      manifest: {
        id: '50um',
        label: '50um',
        gridRows: 64,
        gridCols: 64,
        spotDiameter: 50,
        spotGap: 50,
        barcodeTemplatePath: '/unused/template.csv',
        tissuePositionsPath: '/unused/template.csv',
      },
      templateEntries: [
        {
          barcode: 'spot-a',
          arrayRow: 1,
          arrayCol: 1,
          pxl_row_in_fullres: 75,
          pxl_col_in_fullres: 75,
        },
        {
          barcode: 'spot-b',
          arrayRow: 2,
          arrayCol: 2,
          pxl_row_in_fullres: 175,
          pxl_col_in_fullres: 175,
        },
      ],
    };
    const loadChipConfigDataSpy = vi.spyOn(chipConfigs, 'loadChipConfigData').mockResolvedValue(
      exportChipConfigData as Awaited<ReturnType<typeof chipConfigs.loadChipConfigData>>,
    );

    upsertPreprocessProjectMetadata(project);

    const stored = JSON.parse(localStorage.getItem('spatial-preprocess-projects') ?? '[]') as Array<Record<string, unknown>>;
    const storedChipConfig = stored[0]?.chipConfig as {
      projectedSpots: unknown;
      projectedSpotIndex: Array<{ id: string; arrayRow: number; arrayCol: number }>;
    };

    expect(storedChipConfig.projectedSpots).toBeNull();
    expect(storedChipConfig.projectedSpotIndex).toEqual([
      { id: 'spot-a', arrayRow: 1, arrayCol: 1 },
      { id: 'spot-b', arrayRow: 2, arrayCol: 2 },
    ]);

    const hydrated = await getPreprocessProject(project.id);

    expect(hydrated).toBeDefined();
    expect(hydrated?.chipConfig.projectedSpots).toBeNull();

    const projectedSpotsByArrayPosition = new Map(
      projectSpotsForCrop({
        chip: exportChipConfigData.manifest,
        templateEntries: exportChipConfigData.templateEntries,
        cropWidth: project.cropQc.cropWidth ?? 0,
        cropHeight: project.cropQc.cropHeight ?? 0,
      }).map((spot) => [`${spot.arrayRow}:${spot.arrayCol}`, spot] as const),
    );
    const runtimeProjectedSpots = storedChipConfig.projectedSpotIndex.map((entry) => {
      const projectedSpot = projectedSpotsByArrayPosition.get(`${entry.arrayRow}:${entry.arrayCol}`);

      if (!projectedSpot) {
        throw new Error(`Missing reconstructed spot geometry for ${entry.arrayRow}:${entry.arrayCol}.`);
      }

      return {
        ...projectedSpot,
        id: entry.id,
        barcode: entry.id,
      };
    });
    const runtimeProject: PreprocessProject = {
      ...(hydrated as PreprocessProject),
      cropQc: project.cropQc,
      chipConfig: {
        ...project.chipConfig,
        projectedSpots: runtimeProjectedSpots,
      },
      tissueSelection: project.tissueSelection,
    };

    const result = await exportPreprocessZip({
      project: runtimeProject,
      includeAlignedImage: false,
      includeProjectJson: false,
    });
    const rowsByBarcode = indexRowsByBarcode(await readExportedTissuePositions(result.blob));

	    expect(loadChipConfigDataSpy).toHaveBeenCalledWith('50um');
		expect(rowsByBarcode.get('spot-a')).toEqual({
			barcode: 'spot-a',
			in_tissue: 1,
			array_row: 64,
			array_col: 1,
			pxl_row_in_fullres: 75,
			pxl_col_in_fullres: 75,
		});
		expect(rowsByBarcode.get('spot-b')).toEqual({
			barcode: 'spot-b',
			in_tissue: 0,
			array_row: 63,
			array_col: 2,
			pxl_row_in_fullres: 175,
			pxl_col_in_fullres: 175,
		});
	});

  it('keeps a rejected alignment blocked after metadata round-trip hydration', async () => {
    const project = createProject();
    project.currentStep = 'alignment';
    project.alignment.status = 'error';
    project.alignment.error = 'Rejected alignment';
    project.alignment.qualityFlags = {
      ...project.alignment.qualityFlags,
      accepted: false,
    };
    project.alignment.solveAccepted = false;

    upsertPreprocessProjectMetadata(project);
    const hydrated = await getPreprocessProject(project.id);

    expect(hydrated?.alignment.status).toBe('error');
    expect(hydrated?.alignment.qualityFlags.accepted).toBe(false);
    expect(hydrated?.alignment.solveAccepted).toBe(false);
  });

	it('drops stale legacy blob focused H&E previews during hydration when no derived image blob survives', async () => {
		const project = createProject();
		project.heFocus.focusedImageDataUrl = 'blob:stale-focused-he-preview';
    project.chipConfig = {
      ...project.chipConfig,
      chipType: null,
      rows: null,
      columns: null,
      projectedSpots: null,
    };
    project.tissueSelection = {
      ...project.tissueSelection,
      matrix: null,
      selectedSpotIds: [],
    };

    upsertPreprocessProjectMetadata(project);
    const hydrated = await getPreprocessProject(project.id);

		expect(hydrated).toBeDefined();
		expect(hydrated?.heFocus.focusedImageDataUrl).toBeNull();
	});

	it('does not reconstruct stale crop geometry from legacy aliases when explicit repaired geometry is null', async () => {
		const project = createProject();

		upsertPreprocessProjectMetadata(project);

		const stored = JSON.parse(localStorage.getItem('spatial-preprocess-projects') ?? '[]') as Array<Record<string, unknown>>;
		stored[0] = {
			...stored[0],
			cropQc: {
				...(stored[0]?.cropQc as Record<string, unknown>),
				status: 'stale',
				eosinReferenceGeometry: null,
				heQcGeometry: {
					rect: {
						x: 0.1,
						y: 0.2,
						width: 0.3,
						height: 0.4,
					},
					width: 300,
					height: 400,
				},
				cropRect: {
					x: 0.25,
					y: 0,
					width: 0.75,
					height: 0.95,
				},
				cropWidth: 1799,
				cropHeight: 2413,
			},
		};
		localStorage.setItem('spatial-preprocess-projects', JSON.stringify(stored));

		const hydrated = await getPreprocessProject(project.id);

		expect(hydrated?.cropQc.status).toBe('stale');
		expect(hydrated?.cropQc.eosinReferenceGeometry).toBeNull();
		expect(hydrated?.cropQc.heQcGeometry).toBeNull();
		expect(hydrated?.cropQc.cropRect).toBeNull();
		expect(hydrated?.cropQc.cropWidth).toBeNull();
		expect(hydrated?.cropQc.cropHeight).toBeNull();
	});

  it('preserves emitted crop dimensions separately from eosin geometry evidence during metadata persistence', () => {
    const project = createProject();
    project.alignment = {
      ...project.alignment,
      status: 'ready',
    };
    const cropRect = {
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    };
    project.cropQc = {
      ...project.cropQc,
      status: 'complete',
      isStale: false,
      cropRect,
      cropWidth: 5705,
      cropHeight: 5705,
      cropAssets: createCanonicalCropAssets(),
      tissue_hires_scalef: 0.5,
      tissue_lowres_scalef: 0.25,
      spot_diameter_fullres: 18,
      fiducial_diameter_fullres: 27,
      checkerboardPreview: {
        dataUrl: null,
      },
      eosinReferenceGeometry: {
        rect: cropRect,
        width: 1050,
        height: 1050,
      },
    };

    upsertPreprocessProjectMetadata(project);

    const stored = JSON.parse(localStorage.getItem('spatial-preprocess-projects') ?? '[]') as Array<{
      cropQc?: {
        cropWidth?: unknown;
        cropHeight?: unknown;
        eosinReferenceGeometry?: {
          width?: unknown;
          height?: unknown;
        } | null;
      };
    }>;
    const storedCropQc = stored[0]?.cropQc;

    expect(storedCropQc?.cropWidth).toBe(5705);
    expect(storedCropQc?.cropHeight).toBe(5705);
    expect(storedCropQc?.eosinReferenceGeometry?.width).toBe(1050);
    expect(storedCropQc?.eosinReferenceGeometry?.height).toBe(1050);
  });

  it('preserves asymmetric emitted crop dimensions separately from eosin geometry evidence during hydration', async () => {
    const project = createProject();
    project.alignment = {
      ...project.alignment,
      status: 'ready',
    };
    const cropRect = {
      x: 0.05,
      y: 0.15,
      width: 0.7,
      height: 0.8,
    };
    project.cropQc = {
      ...project.cropQc,
      status: 'complete',
      isStale: false,
      cropRect,
      cropWidth: 4200,
      cropHeight: 5705,
      cropAssets: createCanonicalCropAssets(),
      tissue_hires_scalef: 0.5,
      tissue_lowres_scalef: 0.25,
      spot_diameter_fullres: 18,
      fiducial_diameter_fullres: 27,
      checkerboardPreview: {
        dataUrl: null,
      },
      eosinReferenceGeometry: {
        rect: cropRect,
        width: 1050,
        height: 900,
      },
    };

    await upsertPreprocessProject(project);

    const stored = JSON.parse(localStorage.getItem('spatial-preprocess-projects') ?? '[]') as Array<Record<string, unknown>>;
    stored[0] = {
      ...stored[0],
      cropQc: {
        ...(stored[0]?.cropQc as Record<string, unknown>),
        status: 'complete',
        isStale: false,
        cropRect,
        cropWidth: 4200,
        cropHeight: 5705,
        eosinReferenceGeometry: {
          rect: cropRect,
          width: 1050,
          height: 900,
        },
      },
    };
    localStorage.setItem('spatial-preprocess-projects', JSON.stringify(stored));

    const hydrated = await getPreprocessProject(project.id);

    expect(hydrated?.cropQc.cropRect).toEqual(cropRect);
    expect(hydrated?.cropQc.cropWidth).toBe(4200);
    expect(hydrated?.cropQc.cropHeight).toBe(5705);
    expect(hydrated?.cropQc.eosinReferenceGeometry?.width).toBe(1050);
    expect(hydrated?.cropQc.eosinReferenceGeometry?.height).toBe(900);
  });

  it('preserves canonical matrix truth on storage round-trip when autoSelectedSpotIds do not imply the active cells', async () => {
    const project = createProject();
    // Matrix has a 1 at index 65 which corresponds to row 2, col 2 (spot-b)
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 65 ? 1 : 0 as const)),
    };
    project.tissueSelection.selectedSpotIds = ['runtime-only-spot'];
    // autoSelectedSpotIds determines the matrix - must include spot-b which is at row 2, col 2
    project.tissueSelection.autoSelectedSpotIds = ['spot-b'];

    await upsertPreprocessProject(project);
    const hydrated = await getPreprocessProject(project.id);

    expect(hydrated?.tissueSelection.matrix).toEqual(project.tissueSelection.matrix);
    expect(hydrated?.tissueSelection.autoSelectedSpotIds).toEqual(['spot-b']);
    expect(hydrated?.tissueSelection.selectedSpotIds).toEqual(['spot-b']);
  });

  // ── Regression tests: matrix-vs-autoSelectedSpotIds disagreement ──────────
  // These expose the bug where hydration reconstructs the matrix from
  // autoSelectedSpotIds instead of persisting the canonical matrix independently.
  // When autoSelectedSpotIds disagrees with the matrix, the matrix should win.

  it('hydrates selectedSpotIds from canonical matrix when autoSelectedSpotIds is empty', async () => {
    const project = createProject();
    // Matrix has spot-b (index 65 = row 2, col 2) active
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 65 ? 1 : 0 as const)),
    };
    project.tissueSelection.autoSelectedSpotIds = [];
    project.tissueSelection.selectedSpotIds = ['spot-b'];

    await upsertPreprocessProject(project);

    const fetchMock = vi.fn(async (input: string) => {
      if (input === '/preprocess-chip-configs/50um/manifest.json') {
        return new Response(JSON.stringify({
          id: '50um',
          label: '50um',
          gridRows: 64,
          gridCols: 64,
          spotDiameter: 1,
          spotGap: 1,
          barcodeTemplatePath: '/template.csv',
          tissuePositionsPath: '/template.csv',
        }), { status: 200 });
      }
      if (input === '/template.csv') {
        return new Response([
          'barcode,array_row,array_col',
          'spot-a,1,1',
          'spot-b,2,2',
        ].join('\n'), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const hydrated = await getPreprocessProject(project.id);

    // Matrix must survive round-trip even when autoSelectedSpotIds is empty
    expect(hydrated?.tissueSelection.matrix).toEqual(project.tissueSelection.matrix);
    // selectedSpotIds must follow canonical matrix, not empty auto IDs
    expect(hydrated?.tissueSelection.selectedSpotIds).toEqual(['spot-b']);
    expect(hydrated?.tissueSelection.autoSelectedSpotIds).toEqual([]);
  });

  it('hydrates selectedSpotIds from canonical matrix when autoSelectedSpotIds disagree', async () => {
    const project = createProject();
    // Matrix has spot-b (index 65 = row 2, col 2) active
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 65 ? 1 : 0 as const)),
    };
    // autoSelectedSpotIds points at spot-a instead — this is stale auto-detection output
    // that no longer matches the user-edited (or imported) matrix
    project.tissueSelection.autoSelectedSpotIds = ['spot-a'];
    project.tissueSelection.selectedSpotIds = ['spot-b'];

    await upsertPreprocessProject(project);

    const fetchMock = vi.fn(async (input: string) => {
      if (input === '/preprocess-chip-configs/50um/manifest.json') {
        return new Response(JSON.stringify({
          id: '50um',
          label: '50um',
          gridRows: 64,
          gridCols: 64,
          spotDiameter: 1,
          spotGap: 1,
          barcodeTemplatePath: '/template.csv',
          tissuePositionsPath: '/template.csv',
        }), { status: 200 });
      }
      if (input === '/template.csv') {
        return new Response([
          'barcode,array_row,array_col',
          'spot-a,1,1',
          'spot-b,2,2',
        ].join('\n'), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const hydrated = await getPreprocessProject(project.id);

    // Matrix must be preserved exactly, overriding the conflicting auto IDs
    expect(hydrated?.tissueSelection.matrix).toEqual(project.tissueSelection.matrix);
    // selectedSpotIds must follow the canonical matrix, NOT autoSelectedSpotIds
    expect(hydrated?.tissueSelection.selectedSpotIds).toEqual(['spot-b']);
  });

  it('does not fall back to stale autoSelectedSpotIds when canonical matrix is all zeros', async () => {
    const project = createProject();
    // Matrix is all zeros — user manually cleared the selection
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: new Array(4096).fill(0 as const),
    };
    // autoSelectedSpotIds still has stale data from a previous auto-detection run
    project.tissueSelection.autoSelectedSpotIds = ['spot-a'];
    project.tissueSelection.selectedSpotIds = [];

    await upsertPreprocessProject(project);

    const fetchMock = vi.fn(async (input: string) => {
      if (input === '/preprocess-chip-configs/50um/manifest.json') {
        return new Response(JSON.stringify({
          id: '50um',
          label: '50um',
          gridRows: 64,
          gridCols: 64,
          spotDiameter: 1,
          spotGap: 1,
          barcodeTemplatePath: '/template.csv',
          tissuePositionsPath: '/template.csv',
        }), { status: 200 });
      }
      if (input === '/template.csv') {
        return new Response([
          'barcode,array_row,array_col',
          'spot-a,1,1',
          'spot-b,2,2',
        ].join('\n'), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const hydrated = await getPreprocessProject(project.id);

    // Matrix must not be resurrected by stale auto IDs
    expect(hydrated?.tissueSelection.matrix?.values.every((v) => v === 0)).toBe(true);
    // selectedSpotIds must be empty when the canonical matrix says no spots are active
    expect(hydrated?.tissueSelection.selectedSpotIds).toEqual([]);
  });

  it('removes canonical tissue selection payload when deleting a project', async () => {
    const project = createProject();
    project.tissueSelection.updatedAt = '2026-04-15T00:00:00.000Z';
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 65 ? 1 : 0 as const)),
    };
    project.tissueSelection.autoSelectedSpotIds = ['spot-b'];
    project.tissueSelection.selectedSpotIds = ['spot-b'];

    await upsertPreprocessProject(project);
    await deletePreprocessProject(project.id);

    const recreatedProject = createProject();
    recreatedProject.tissueSelection.updatedAt = '2026-04-16T00:00:00.000Z';
    recreatedProject.tissueSelection.matrix = null;
    recreatedProject.tissueSelection.autoSelectedSpotIds = [];
    recreatedProject.tissueSelection.selectedSpotIds = null;
    upsertPreprocessProjectMetadata(recreatedProject);

    const hydrated = await getPreprocessProject(project.id);

    expect(hydrated?.tissueSelection.matrix).toBeNull();
    expect(hydrated?.tissueSelection.autoSelectedSpotIds).toEqual([]);
    expect(hydrated?.tissueSelection.selectedSpotIds).toBeNull();
  });

  it('keeps newer canonical tissue payload when an older timestamp save arrives later', async () => {
    const project = createProject();
    project.name = 'Fresh metadata';
    project.updatedAt = '2026-04-15T00:00:00.000Z';
    project.tissueSelection.updatedAt = '2026-04-15T00:00:00.000Z';
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 65 ? 1 : 0 as const)),
    };
    project.tissueSelection.autoSelectedSpotIds = ['spot-b'];
    project.tissueSelection.selectedSpotIds = ['spot-b'];

    upsertPreprocessProjectMetadata(project);
    await upsertPreprocessProject(project, { mode: 'tissue' });

    const olderProject = createProject();
    olderProject.name = 'Stale metadata';
    olderProject.updatedAt = '2026-04-14T00:00:00.000Z';
    olderProject.tissueSelection.updatedAt = '2026-04-14T00:00:00.000Z';
    olderProject.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 0 ? 1 : 0 as const)),
    };
    olderProject.tissueSelection.autoSelectedSpotIds = ['spot-a'];
    olderProject.tissueSelection.selectedSpotIds = ['spot-a'];

    await upsertPreprocessProject(olderProject, { mode: 'tissue' });

    const hydrated = await getPreprocessProject(project.id);

    expect(hydrated?.name).toBe('Fresh metadata');
    expect(hydrated?.updatedAt).toBe('2026-04-15T00:00:00.000Z');
    expect(hydrated?.tissueSelection.matrix).toEqual(project.tissueSelection.matrix);
    expect(hydrated?.tissueSelection.autoSelectedSpotIds).toEqual(['spot-b']);
    expect(hydrated?.tissueSelection.selectedSpotIds).toEqual(['spot-b']);
  });

  it('creates metadata for a first tissue-only save', async () => {
    const project = createProject();
    project.name = 'Tissue first project';
    project.tissueSelection.updatedAt = '2026-04-15T00:00:00.000Z';
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 65 ? 1 : 0 as const)),
    };
    project.tissueSelection.autoSelectedSpotIds = ['spot-b'];
    project.tissueSelection.selectedSpotIds = ['spot-b'];

    await upsertPreprocessProject(project, { mode: 'tissue' });

    const summaries = await readPreprocessProjectSummaries();
    const hydrated = await getPreprocessProject(project.id);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.name).toBe('Tissue first project');
    expect(hydrated?.tissueSelection.matrix).toEqual(project.tissueSelection.matrix);
    expect(hydrated?.tissueSelection.autoSelectedSpotIds).toEqual(['spot-b']);
  });

  it('persists tissue metadata consistently with the tissue matrix', async () => {
    const project = createProject();
    project.storageVersion = PREPROCESS_STORAGE_SCHEMA_VERSION;
    await upsertPreprocessProject(project);

    project.updatedAt = '2026-04-15T00:00:00.000Z';
    project.tissueSelection.updatedAt = '2026-04-15T00:00:00.000Z';
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 65 ? 1 : 0 as const)),
    };
    project.tissueSelection.selectedSpotIds = ['spot-b'];
    project.tissueSelection.paritySummary = {
      selectedCount: 1,
      selectedPercent: 50,
      maskCoverage: 50,
    };
    project.exportState.status = 'stale';
    project.exportState.isStale = true;
    project.exportState.updatedAt = '2026-04-15T00:00:00.000Z';

    await upsertPreprocessProject(project, { mode: 'tissue' });
    const hydrated = await getPreprocessProject(project.id);

    expect(hydrated?.tissueSelection.matrix).toEqual(project.tissueSelection.matrix);
    expect(hydrated?.tissueSelection.selectedSpotIds).toEqual(['spot-b']);
    expect(hydrated?.tissueSelection.paritySummary).toEqual(project.tissueSelection.paritySummary);
    expect(hydrated?.exportState.status).toBe('stale');
    expect(hydrated?.exportState.isStale).toBe(true);
  });

  it('restores prior metadata when a tissue payload write fails', async () => {
    let failTissueWrite = false;
    vi.stubGlobal('window', {
      localStorage,
      indexedDB: createIndexedDbMock(
        (storeName) => failTissueWrite && storeName === 'preprocess-tissue-selection',
      ),
    });
    const project = createProject();
    project.storageVersion = PREPROCESS_STORAGE_SCHEMA_VERSION;
    await upsertPreprocessProject(project);
    const previousMetadata = localStorage.getItem('spatial-preprocess-projects');

    project.updatedAt = '2026-04-15T00:00:00.000Z';
    project.tissueSelection.updatedAt = '2026-04-15T00:00:00.000Z';
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 65 ? 1 : 0 as const)),
    };
    project.tissueSelection.selectedSpotIds = ['spot-b'];
    project.exportState.status = 'stale';
    project.exportState.isStale = true;
    failTissueWrite = true;

    await expect(upsertPreprocessProject(project, { mode: 'tissue' })).rejects.toThrow(
      'Forced preprocess-tissue-selection write failure',
    );

    expect(localStorage.getItem('spatial-preprocess-projects')).toBe(previousMetadata);
  });

  it('strips storage-only projectedSpotIndex from hydrated runtime projects and package serialization', async () => {
    const project = createProject();

    upsertPreprocessProjectMetadata(project);
    const hydrated = await getPreprocessProject(project.id);
    const blob = await serializePreprocessProject(hydrated as PreprocessProject);
    const parsed = JSON.parse(await blob.text()) as {
      project: {
        chipConfig: Record<string, unknown>;
      };
    };

    expect(hydrated).toBeDefined();
    expect(Object.hasOwn(hydrated?.chipConfig ?? {}, 'projectedSpotIndex')).toBe(false);
    expect(hydrated?.chipConfig.projectedSpots).toBeNull();
    expect(parsed.project.chipConfig.projectedSpots).toBeNull();
    expect(Object.hasOwn(parsed.project.chipConfig, 'projectedSpotIndex')).toBe(false);
  });

  it('hydrates pre-v5 stored metadata without projectedSpotIndex by repairing a compact index from chip config data', async () => {
    const project = createProject();
    // Matrix has a 1 at index 65 which corresponds to row 2, col 2 (spot-b)
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 65 ? 1 : 0 as const)),
    };
    project.tissueSelection.selectedSpotIds = ['runtime-only-spot'];
    // autoSelectedSpotIds must match the matrix - spot-b is at row 2, col 2
    project.tissueSelection.autoSelectedSpotIds = ['spot-b'];

    await upsertPreprocessProject(project);

    const stored = JSON.parse(localStorage.getItem('spatial-preprocess-projects') ?? '[]') as Array<Record<string, unknown>>;
    const legacyStored = {
      ...stored[0],
      storageVersion: 4,
      chipConfig: {
        ...(stored[0]?.chipConfig as Record<string, unknown>),
        projectedSpotIndex: null,
      },
    };
    localStorage.setItem('spatial-preprocess-projects', JSON.stringify([legacyStored]));

    const fetchMock = vi.fn(async (input: string) => {
      if (input === '/preprocess-chip-configs/50um/manifest.json') {
        return new Response(JSON.stringify({
          id: '50um',
          label: '50um',
          gridRows: 64,
          gridCols: 64,
          spotDiameter: 1,
          spotGap: 1,
          barcodeTemplatePath: '/template.csv',
          tissuePositionsPath: '/template.csv',
        }), { status: 200 });
      }

      if (input === '/template.csv') {
        return new Response([
          'barcode,array_row,array_col',
          'spot-a,1,1',
          'spot-b,2,2',
        ].join('\n'), { status: 200 });
      }

      return new Response(null, { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const hydrated = await getPreprocessProject(project.id);

    expect(fetchMock).toHaveBeenCalled();
    expect(hydrated?.tissueSelection.selectedSpotIds).toEqual(['spot-b']);
    expect(hydrated?.tissueSelection.matrix).toEqual(project.tissueSelection.matrix);
  });

	it('does not reintroduce legacy region-first tissue fields into canonical stored state after migration', () => {
	  const project = createProject();

    upsertPreprocessProjectMetadata(project);

    const stored = JSON.parse(localStorage.getItem('spatial-preprocess-projects') ?? '[]') as Array<Record<string, unknown>>;
    const storedTissue = stored[0]?.tissueSelection as Record<string, unknown>;

    expect(Object.hasOwn(storedTissue, 'regions')).toBe(false);
    expect(Object.hasOwn(storedTissue, 'forcedInSpotIds')).toBe(false);
    expect(Object.hasOwn(storedTissue, 'forcedOutSpotIds')).toBe(false);
    expect(Object.hasOwn(storedTissue, 'selectedRegionId')).toBe(false);
	  expect(Object.hasOwn(storedTissue, 'previewDataUrl')).toBe(true);
	  expect(storedTissue.previewDataUrl).toBeNull();
	});

	it('preserves out-of-bounds HEFocus bounds across normalized storage save and workspace load', async () => {
		const project = createProject();
		const heFocusBounds = {
			x: -0.18,
			y: -0.12,
			width: 1.24,
			height: 1.18,
		};

		project.heFocus.chipBounds = heFocusBounds;
		project.heFocus.handles = [];

		upsertPreprocessProjectMetadata(normalizeProjectForPersistence(project));

		const stored = JSON.parse(
			localStorage.getItem('spatial-preprocess-projects') ?? '[]',
		) as Array<Record<string, unknown>>;
		expect(
			(stored[0]?.heFocus as Record<string, unknown>).chipBounds,
		).toEqual(heFocusBounds);

		const hydrated = await getPreprocessProject(project.id);
		expect(hydrated).toBeDefined();

		const workspace = normalizeProjectForWorkspace(hydrated as PreprocessProject);
		expect(workspace.heFocus.chipBounds).toEqual(heFocusBounds);
	});

	it('keeps the previous derived payload when a preview blob URL was revoked instead of failing the snapshot save', async () => {
		const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL')
			.mockImplementation((blob: Blob) => `blob:restored:${blob.size}`);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchMock = vi.fn(async (input: string) => {
			if (typeof input === 'string' && input.startsWith('blob:')) {
				// Revoked blob URLs reject exactly like the browser's
				// net::ERR_FILE_NOT_FOUND on fetch(blob:...).
				throw new TypeError('Failed to fetch');
			}
			if (input === '/preprocess-chip-configs/50um/manifest.json') {
				return new Response(JSON.stringify({
					id: '50um',
					label: '50um',
					gridRows: 64,
					gridCols: 64,
					spotDiameter: 1,
					spotGap: 1,
					barcodeTemplatePath: '/template.csv',
					tissuePositionsPath: '/template.csv',
				}), { status: 200 });
			}
			if (input === '/template.csv') {
				return new Response([
					'barcode,array_row,array_col',
					'spot-a,1,1',
					'spot-b,2,2',
				].join('\n'), { status: 200 });
			}
			return new Response(null, { status: 404 });
		});
		vi.stubGlobal('fetch', fetchMock);

		try {
			const project = createProject();
			project.heFocus.focusedImageDataUrl = PNG_DATA_URL;
			await upsertPreprocessProject(project);

			// Simulate page code revoking the preview URL while the project still
			// points at it, then persisting again (the reported autosave failure).
			project.heFocus.focusedImageDataUrl = 'blob:revoked-preview';
			await expect(upsertPreprocessProject(project)).resolves.toBeUndefined();

			const hydrated = await getPreprocessProject(project.id);
			expect(hydrated).toBeDefined();
			// The previously stored payload survives and is re-exposed through a
			// fresh object URL on hydration.
			expect(hydrated?.heFocus.focusedImageDataUrl?.startsWith('blob:restored:')).toBe(true);
			expect(warnSpy).toHaveBeenCalled();
		} finally {
			createObjectUrlSpy.mockRestore();
			warnSpy.mockRestore();
		}
	});
});
