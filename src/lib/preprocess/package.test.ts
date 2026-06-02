import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	normalizeProjectForPersistence,
	normalizeProjectForWorkspace,
} from '@/app/preprocess/projectState';
import type { PreprocessProject, ProjectedSpot, TissueActivationValue } from '@/types/preprocess';

import { deserializePreprocessImport, deserializePreprocessProject, PACKAGE_VERSION } from './package';

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
      source: null,
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

  vi.stubGlobal('window', {
    Image: MockImage,
  });
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

const toCanonicalProjectPayload = (project: PreprocessProject) => {
  const {
    forcedInSpotIds,
    forcedOutSpotIds,
    overrideNotice,
    regions,
    selectedRegionId,
    ...canonicalTissueSelection
  } = project.tissueSelection;

  void forcedInSpotIds;
  void forcedOutSpotIds;
  void overrideNotice;
  void regions;
  void selectedRegionId;

  return {
    ...project,
    tissueSelection: canonicalTissueSelection,
  };
};

const toLegacyCropMetadataPayload = (project: PreprocessProject) => {
  const canonicalProject = toCanonicalProjectPayload(project) as PreprocessProject & {
    cropQc: PreprocessProject['cropQc'] & {
      eosinReferenceGeometry?: PreprocessProject['cropQc']['eosinReferenceGeometry'];
      heQcGeometry?: PreprocessProject['cropQc']['heQcGeometry'];
    };
  };

  const { eosinReferenceGeometry, heQcGeometry, ...legacyCropQc } = canonicalProject.cropQc;

  void eosinReferenceGeometry;
  void heQcGeometry;

  return {
    ...canonicalProject,
    cropQc: legacyCropQc,
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

  it('regenerates missing package working previews as JPEG proxies while retaining source blobs', async () => {
    installImageProxyMocks();
    const project = createProject();
    project.sourceAssets.images.eosin = {
      ...createSourceImage('eosin'),
      width: 4096,
      height: 2048,
    };

    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({
      version: PACKAGE_VERSION,
      project: toCanonicalProjectPayload(project),
    }));
    zip.file('source-assets/eosin', new Uint8Array(4096));
    const file = new File([await zip.generateAsync({ type: 'blob' })], 'project.zip', {
      type: 'application/zip',
    });

    const result = await deserializePreprocessImport(file);
    const image = result.sourceAssets.images.eosin;

    expect(image?.sourceBlob?.type).toBe('image/png');
    expect(image?.dataUrl).toBe('blob:image/png:4096');
    expect(image?.workingBlob?.type).toBe('image/jpeg');
    expect(image?.workingDataUrl).toBe('blob:image/jpeg:1024');
    expect(image?.workingWidth).toBe(2048);
    expect(image?.workingHeight).toBe(1024);
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
      values: Array.from({ length: 4096 }, (_, index) => (index === 0 ? 2 : 0)) as TissueActivationValue[],
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

	it('rejects canonical version 4 payloads that retain raw crop preview aliases', async () => {
	  const project = createProject();
	  project.cropQc.cropAssets = {
	    eosin: {
	      fullres: { dataUrl: 'data:image/png;base64,eosin-fullres' },
	      hires: { dataUrl: 'data:image/png;base64,eosin-hires' },
	      lowres: { dataUrl: 'data:image/png;base64,eosin-lowres' },
	    },
	    he: {
	      fullres: { dataUrl: 'data:image/png;base64,he-fullres' },
	      hires: { dataUrl: 'data:image/png;base64,he-hires' },
	      lowres: { dataUrl: 'data:image/png;base64,he-lowres' },
	    },
	  };
	  project.cropQc.tissue_hires_scalef = 0.5;
	  project.cropQc.tissue_lowres_scalef = 0.25;
	  project.cropQc.spot_diameter_fullres = 18;
	  project.cropQc.fiducial_diameter_fullres = 27;
	  project.cropQc.previewDataUrl = 'blob:legacy-preview';

	  await expect(deserializePreprocessProject(createPackageBlob({
	    version: PACKAGE_VERSION,
	    project: toCanonicalProjectPayload(project),
	  }))).rejects.toThrow(/cropQc\.previewDataUrl/i);
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

  it('downgrades canonical version 4 payloads missing repaired crop metadata to stale-from-crop on import', async () => {
    const project = createProject();
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

    const result = normalizeProjectForWorkspace(await deserializePreprocessProject(createPackageBlob({
      version: PACKAGE_VERSION,
      project: toLegacyCropMetadataPayload(project),
    })));

		expect(result.currentStep).toBe('cropQc');
		expect(result.cropQc.status).toBe('stale');
		expect(result.cropQc.eosinReferenceGeometry).toBeNull();
		expect(result.cropQc.heQcGeometry).toBeNull();
		expect(result.cropQc.cropRect).toBeNull();
		expect(result.cropQc.cropWidth).toBeNull();
		expect(result.cropQc.cropHeight).toBeNull();
		expect(result.chipConfig.status).toBe('stale');
		expect(result.chipConfig.projectedSpots).toBeNull();
		expect(result.tissueSelection.status).toBe('stale');
		expect(result.tissueSelection.matrix).toBeNull();
    expect(result.tissueSelection.selectedSpotIds).toBeNull();
    expect(result.tissueSelection.supportState).toBe('unsupported');
    expect(result.exportState.status).toBe('stale');
  });

  it('preserves localization and heFocus geometry through canonical package deserialization when transforms are rotated or flipped', async () => {
    const project = createProject();

    project.localization.chipBounds = {
      x: 0.14,
      y: 0.24,
      width: 0.32,
      height: 0.32,
    };
    project.localization.handles = [];
    project.localization.imageTransform = {
      rotationDegrees: 90,
      flipHorizontal: true,
      flipVertical: false,
      scale: 1.5,
    };

    project.heFocus.chipBounds = {
      x: 0.18,
      y: 0.28,
      width: 0.22,
      height: 0.22,
    };
    project.heFocus.handles = [];
    project.heFocus.imageTransform = {
      rotationDegrees: -90,
      flipHorizontal: false,
      flipVertical: true,
      scale: 0.75,
    };

    const result = await deserializePreprocessProject(createPackageBlob({
      version: PACKAGE_VERSION,
      project: toCanonicalProjectPayload(project),
    }));

    expect(result.localization.chipBounds).toEqual(project.localization.chipBounds);
    expect(result.localization.imageTransform).toEqual(project.localization.imageTransform);
    expect(result.heFocus.chipBounds).toEqual(project.heFocus.chipBounds);
    expect(result.heFocus.imageTransform).toEqual(project.heFocus.imageTransform);
  });

	it('preserves fully outside HEFocus bounds through canonical package import and workspace normalization', async () => {
		const project = createProject();
		const heFocusBounds = {
			x: 1.18,
			y: 1.12,
			width: 0.24,
			height: 0.24,
		};

		project.heFocus.chipBounds = heFocusBounds;
		project.heFocus.handles = [];

		const result = normalizeProjectForWorkspace(
			await deserializePreprocessProject(
				createPackageBlob({
					version: PACKAGE_VERSION,
					project: toCanonicalProjectPayload(
						normalizeProjectForPersistence(project),
					),
				}),
			),
		);

		expect(result.heFocus.chipBounds).toEqual(heFocusBounds);
	});
});
