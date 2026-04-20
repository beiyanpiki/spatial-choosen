import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PreprocessProject, ProjectedSpot } from '@/types/preprocess';

import { serializePreprocessProject } from './package';
import { getPreprocessProject, upsertPreprocessProjectMetadata } from './storage';

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

const createIndexedDbMock = () => {
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
      const store = ensureStore(storeName);
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

      store.size;
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
    vi.unstubAllGlobals();
  });

  it('persists canonical matrix and support metadata while stripping runtime selectedSpotIds', () => {
    const project = createProject();

    upsertPreprocessProjectMetadata(project);

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
    expect(storedTissue.matrix).toEqual(project.tissueSelection.matrix);
    expect(storedTissue.selectedSpotIds).toBeNull();
  });

  it('hydrates selectedSpotIds from canonical matrix truth instead of persisted runtime ids', async () => {
    const project = createProject();

    upsertPreprocessProjectMetadata(project);
    const hydrated = await getPreprocessProject(project.id);

    expect(hydrated?.tissueSelection.selectedSpotIds).toEqual(['spot-a']);
    expect(Object.hasOwn(hydrated?.tissueSelection ?? {}, 'forcedInSpotIds')).toBe(false);
    expect(Object.hasOwn(hydrated?.tissueSelection ?? {}, 'forcedOutSpotIds')).toBe(false);
    expect(Object.hasOwn(hydrated?.tissueSelection ?? {}, 'regions')).toBe(false);
    expect(Object.hasOwn(hydrated?.tissueSelection ?? {}, 'selectedRegionId')).toBe(false);
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

  it('preserves canonical matrix truth on storage round-trip when autoSelectedSpotIds do not imply the active cells', async () => {
    const project = createProject();
    project.tissueSelection.autoSelectedSpotIds = [];
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 65 ? 1 : 0 as const)),
    };
    project.tissueSelection.selectedSpotIds = ['runtime-only-spot'];

    upsertPreprocessProjectMetadata(project);
    const hydrated = await getPreprocessProject(project.id);

    expect(hydrated?.tissueSelection.matrix).toEqual(project.tissueSelection.matrix);
    expect(hydrated?.tissueSelection.autoSelectedSpotIds).toEqual([]);
    expect(hydrated?.tissueSelection.selectedSpotIds).toEqual(['spot-b']);
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
    project.tissueSelection.matrix = {
      rows: 64,
      columns: 64,
      values: Array.from({ length: 4096 }, (_, index) => (index === 65 ? 1 : 0 as const)),
    };
    project.tissueSelection.selectedSpotIds = ['runtime-only-spot'];

    upsertPreprocessProjectMetadata(project);

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
});
