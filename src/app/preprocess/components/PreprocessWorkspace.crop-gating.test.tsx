import { ChakraProvider } from '@chakra-ui/react';
import { act, render, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PreprocessProject } from '@/types/preprocess';

const mockRunCropQc = vi.fn();
const mockLoadOpenCv = vi.fn();
let latestProject: PreprocessProject | null = null;
type CapturedCropQcPanelProps = {
  canRun: boolean;
  onRunCrop: () => void;
};
let capturedCropQcPanelProps: CapturedCropQcPanelProps | null = null;

vi.mock('../../../lib/preprocess/alignment', () => ({
  normalizeAlignmentSlice: (value: unknown) => value,
}));

vi.mock('../../../lib/preprocess/cropQc', () => ({
  runCropQc: (...args: unknown[]) => mockRunCropQc(...args),
}));

vi.mock('../../../lib/preprocess/exportBundle', () => ({
  exportPreprocessZip: vi.fn(),
  getPreprocessZipExportReadiness: () => ({ canExport: false, reason: 'Not used in this test.' }),
}));

vi.mock('../../../lib/preprocess/invalidation', () => ({
  invalidateOnAlignmentChange: (project: unknown) => project,
  invalidateOnCropQcChange: (project: unknown) => project,
  invalidateOnHeFocusChange: (project: unknown) => project,
  invalidateOnLocalizationChange: (project: unknown) => project,
  invalidateOnSourceAssetsChange: (project: unknown) => project,
}));

vi.mock('../../../lib/preprocess/loadOpenCv', () => ({
  loadOpenCv: (...args: unknown[]) => mockLoadOpenCv(...args),
}));

vi.mock('../../../lib/preprocess/localization', () => ({
  buildLocalizationHandles: () => [],
  clampNormalizedSquareRect: (value: unknown) => value,
  computeLocalizationStatus: () => 'complete',
  createDefaultChipBounds: () => null,
  DEFAULT_LOCALIZATION_IMAGE_TRANSFORM: {
    rotationDegrees: 0,
    flipHorizontal: false,
    flipVertical: false,
    scale: 1,
  },
  normalizeLocalizationImageTransform: (value: unknown) => value,
  normalizeLocalizationSlice: (value: unknown) => value,
}));

vi.mock('../../../lib/preprocess/sourceImage', () => ({
  buildSourceImage: vi.fn(),
  createThumbnailBlob: vi.fn(),
}));

vi.mock('../../../lib/preprocess/spotProjection', () => ({
  projectSpotsForCrop: vi.fn(),
  resolveAuthoritativeSpotDiameterFullres: vi.fn(),
}));

vi.mock('../../../lib/preprocess/tissuePipeline', () => ({
  runTissueAutoSelection: vi.fn(),
}));

vi.mock('../../../lib/preprocess/chipConfigs', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/preprocess/chipConfigs')>('../../../lib/preprocess/chipConfigs');
  return {
    ...actual,
    loadAllChipConfigManifests: vi.fn(async () => []),
    loadChipConfigData: vi.fn(async () => null),
  };
});

vi.mock('./AlignmentPanel', () => ({
  AlignmentPanel: () => null,
}));

vi.mock('./CanvasStage', () => ({
  CanvasStage: () => null,
}));

vi.mock('./CropQcPanel', () => ({
  CropQcPanel: (props: CapturedCropQcPanelProps) => {
    capturedCropQcPanelProps = props;
    return null;
  },
}));

vi.mock('./ExportPanel', () => ({
  ExportPanel: () => null,
}));

vi.mock('./StepSidebar', () => ({
  StepSidebar: () => null,
}));

vi.mock('./TissueSelectionControls', () => ({
  TissueSelectionControls: () => null,
}));

vi.mock('./TissueSelectionPanel', () => ({
  TissueSelectionPanel: () => null,
}));

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

const { theme } = await import('../../../theme');
const { PreprocessWorkspace } = await import('./PreprocessWorkspace');

const baseRunResult = {
  eosinReferenceGeometry: {
    rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    width: 30,
    height: 40,
  },
  heQcGeometry: {
    rect: { x: 0.15, y: 0.25, width: 0.2, height: 0.3 },
    width: 20,
    height: 30,
  },
  cropRect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  cropWidth: 30,
  cropHeight: 40,
  cropAssets: {
    eosin: {
      fullres: { dataUrl: 'data:image/png;base64,eosin-fullres', width: 30, height: 40 },
      hires: { dataUrl: 'data:image/png;base64,eosin-hires', width: 15, height: 20 },
      lowres: { dataUrl: 'data:image/png;base64,eosin-lowres', width: 8, height: 10 },
    },
    he: {
      fullres: { dataUrl: 'data:image/png;base64,he-fullres', width: 30, height: 40 },
      hires: { dataUrl: 'data:image/png;base64,he-hires', width: 15, height: 20 },
      lowres: { dataUrl: 'data:image/png;base64,he-lowres', width: 8, height: 10 },
    },
  },
  tissue_hires_scalef: 0.5,
  tissue_lowres_scalef: 0.25,
  spot_diameter_fullres: null,
  fiducial_diameter_fullres: 90,
  checkerboardPreview: {
    dataUrl: 'data:image/png;base64,checkerboard',
  },
  featureMatchesPreview: {
    dataUrl: 'data:image/png;base64,feature-matches',
  },
  eosinCropDataUrl: 'data:image/png;base64,eosin-fullres',
  heWarpedCropDataUrl: 'data:image/png;base64,he-fullres',
  checkerboardDataUrl: 'data:image/png;base64,checkerboard',
  featureMatchesDataUrl: 'data:image/png;base64,feature-matches',
};

const defaultLocalizationChipBounds = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

const createProject = (overrides?: {
  alignmentStatus?: PreprocessProject['alignment']['status'];
  alignmentAccepted?: boolean;
  solveAccepted?: boolean;
  alignmentSource?: PreprocessProject['alignment']['source'];
  heFocusChipBounds?: PreprocessProject['heFocus']['chipBounds'];
}): PreprocessProject => ({
  id: 'workspace-crop-gating-project',
  name: 'Workspace crop gating project',
  createdAt: '2026-04-15T00:00:00.000Z',
  updatedAt: '2026-04-15T00:00:00.000Z',
  workflowVersion: 3,
  storageVersion: 5,
  currentStep: 'cropQc',
  sourceAssets: {
    status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    activeImage: 'eosin',
    images: {
      eosin: {
        id: 'eosin-source',
        kind: 'eosin',
        fileName: 'eosin.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        width: 100,
        height: 100,
        lastModified: 1,
        dataUrl: 'data:image/png;base64,eosin',
        sourceBlob: undefined,
        thumbnailBlob: undefined,
        objectUrl: undefined,
        thumbnailObjectUrl: undefined,
        thumbnailDataUrl: undefined,
      },
      he: {
        id: 'he-source',
        kind: 'he',
        fileName: 'he.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        width: 100,
        height: 100,
        lastModified: 1,
        dataUrl: 'data:image/png;base64,he',
        sourceBlob: undefined,
        thumbnailBlob: undefined,
        objectUrl: undefined,
        thumbnailObjectUrl: undefined,
        thumbnailDataUrl: undefined,
      },
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
    chipBounds: defaultLocalizationChipBounds,
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
    status: 'ready',
    isStale: false,
    updatedAt: null,
    error: null,
    targetImage: 'he',
    chipBounds: overrides?.heFocusChipBounds ?? null,
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
    status: overrides?.alignmentStatus ?? 'complete',
    isStale: false,
    updatedAt: null,
    error: overrides?.alignmentStatus === 'error' ? 'Rejected alignment' : null,
    referenceImage: 'eosin',
    movingImage: 'he',
    movingImageTransform: {
      rotationDegrees: 0,
      flipHorizontal: false,
      flipVertical: false,
      scale: 1,
    },
    overlayOpacity: 0.5,
    source: overrides?.alignmentSource ?? null,
    controlPoints: [
      {
        id: 'point-a',
        source: { x: 0.5, y: 0.5 },
        target: { x: 0.5, y: 0.5 },
      },
    ],
    inlierMask: [true],
    affineMatrix: [1, 0, 0, 0, 1, 0],
    reprojectionRmse: 0,
    inlierRatio: 1,
    ransacReprojThreshold: 6,
    qualityFlags: {
      minPairs: true,
      inlierRatio: true,
      rmse: true,
      finiteMatrix: true,
      scaleRange: true,
      accepted: overrides?.alignmentAccepted ?? true,
    },
    solveAccepted: overrides?.solveAccepted ?? true,
    failureReason: null,
    transform: null,
    previewDataUrl: null,
  },
  cropQc: {
    status: 'ready',
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
    checkerboardPreview: {
      dataUrl: null,
    },
    featureMatchesPreviewDataUrl: null,
    featureMatchesPreview: {
      dataUrl: null,
    },
  },
  chipConfig: {
    status: 'idle',
    isStale: false,
    updatedAt: null,
    error: null,
    chipType: null,
    rows: null,
    columns: null,
    pitchX: null,
    pitchY: null,
    origin: null,
    rotationDegrees: 0,
    projectedSpots: null,
  },
  tissueSelection: {
    status: 'idle',
    isStale: false,
    updatedAt: null,
    error: null,
    mode: 'matrix',
    thresholdMode: 'raw',
    activationThreshold: 0.1,
    blockThreshold: 135,
    dbscanEps: 0.03,
    dbscanMinSamples: 5,
    minConnectedSpotCount: 2,
    autoSelectedSpotIds: [],
    matrix: null,
    supportState: 'supported',
    unsupportedReason: null,
    selectedSpotIds: [],
    paritySummary: null,
    warning: null,
  },
  exportState: {
    status: 'idle',
    isStale: false,
    updatedAt: null,
    error: null,
    requestedFormats: [],
    lastExportedAt: null,
    artifacts: [],
  },
});

function WorkspaceHarness({ initialProject }: { initialProject: PreprocessProject }) {
  const [project, setProject] = useState(initialProject);

  useEffect(() => {
    latestProject = project;
  }, [project]);

  return (
    <ChakraProvider theme={theme}>
      <PreprocessWorkspace
        autosaveStatus='saved'
        autosaveDetail={null}
        isLoading={false}
        loadError={null}
        onBackToLanding={vi.fn()}
        onProjectMutate={(updater: (current: PreprocessProject) => PreprocessProject) => {
          setProject((current) => updater(current));
        }}
        onProjectNameChange={vi.fn()}
        onStepChange={vi.fn()}
        project={project}
      />
    </ChakraProvider>
  );
}

describe('PreprocessWorkspace crop gating contract', () => {
  beforeEach(() => {
    mockLoadOpenCv.mockReset();
    mockRunCropQc.mockReset();
    capturedCropQcPanelProps = null;
    latestProject = null;
    mockLoadOpenCv.mockResolvedValue({ cv: {} });
    mockRunCropQc.mockResolvedValue(baseRunResult);
  });

  it('keeps crop run disabled when alignment is blocked', () => {
    render(<WorkspaceHarness initialProject={createProject({ alignmentStatus: 'error' })} />);

    expect(capturedCropQcPanelProps?.canRun).toBe(false);
  });

	it('keeps crop run disabled when strict quality acceptance is false, even if solve accepted marks complete (consumer-boundary phase)', () => {
		render(
			<WorkspaceHarness
				initialProject={createProject({
          alignmentStatus: 'complete',
          alignmentAccepted: false,
          solveAccepted: true,
        })}
      />,
    );

    expect(capturedCropQcPanelProps?.canRun).toBe(false);
  });

  it('forwards solveAccepted=false when the handed-off run callback is invoked for rejected alignment output', async () => {
    render(
      <WorkspaceHarness
        initialProject={createProject({
          alignmentStatus: 'complete',
          alignmentAccepted: false,
          solveAccepted: false,
        })}
      />,
    );

    expect(capturedCropQcPanelProps).not.toBeNull();

    await act(async () => {
      capturedCropQcPanelProps?.onRunCrop();
    });

    await waitFor(() => {
      expect(mockLoadOpenCv).toHaveBeenCalledTimes(1);
      expect(mockRunCropQc).toHaveBeenCalledTimes(1);
    });

    const [request] = mockRunCropQc.mock.calls[0] as Array<Record<string, unknown>>;
    expect(request.solveAccepted).toBe(false);
    expect(request.alignmentAccepted).toBeUndefined();

    await act(async () => {
      await Promise.resolve();
    });
  });

  it('keeps localization crop authority even when accepted HEFocus bounds extend beyond the image', async () => {
    const outOfBoundsHeFocus = { x: -0.12, y: 0.91, width: 0.36, height: 0.36 };

    render(
      <WorkspaceHarness
        initialProject={createProject({
          alignmentSource: 'manual',
          heFocusChipBounds: outOfBoundsHeFocus,
        })}
      />,
    );

    await act(async () => {
      capturedCropQcPanelProps?.onRunCrop();
    });

    await waitFor(() => {
      expect(mockRunCropQc).toHaveBeenCalledTimes(1);
    });

    const [request] = mockRunCropQc.mock.calls[0] as Array<Record<string, unknown>>;
    expect(request.chipBounds).toEqual(defaultLocalizationChipBounds);
    expect(request.acceptedChipBounds).toEqual(outOfBoundsHeFocus);
  });

  it('uses localization geometry for crop authority while forwarding manual H&E bounds as QC evidence', async () => {
    const acceptedChipBounds = { x: 0.31, y: 0.34, width: 0.22, height: 0.16 };

    render(
      <WorkspaceHarness
        initialProject={createProject({
          alignmentSource: 'manual',
          heFocusChipBounds: acceptedChipBounds,
        })}
      />,
    );

    await act(async () => {
      capturedCropQcPanelProps?.onRunCrop();
    });

    await waitFor(() => {
      expect(mockRunCropQc).toHaveBeenCalledTimes(1);
    });

    const [manualRequest] = mockRunCropQc.mock.calls[0] as Array<Record<string, unknown>>;
    expect(manualRequest.chipBounds).toEqual(defaultLocalizationChipBounds);
    expect(manualRequest.acceptedChipBounds).toEqual(acceptedChipBounds);
    expect(manualRequest.solveAccepted).toBe(true);
  });

  it('stores the lighter HE hires preview in the crop preview alias after crop/QC completes', async () => {
    render(<WorkspaceHarness initialProject={createProject()} />);

    await act(async () => {
      capturedCropQcPanelProps?.onRunCrop();
    });

    await waitFor(() => {
      expect(mockRunCropQc).toHaveBeenCalledTimes(1);
      expect(latestProject?.cropQc.previewDataUrl).toBe(baseRunResult.cropAssets.he.hires.dataUrl);
    });

    expect(latestProject?.cropQc.cropAssets?.he?.fullres.dataUrl).toBe(baseRunResult.cropAssets.he.fullres.dataUrl);
  });

	it('preserves emitted Crop/QC export-frame dimensions instead of overwriting them with eosinReferenceGeometry evidence', async () => {
		mockRunCropQc.mockResolvedValueOnce({
			...baseRunResult,
			eosinReferenceGeometry: {
				...baseRunResult.eosinReferenceGeometry,
				width: 30,
				height: 40,
			},
			cropWidth: 64,
			cropHeight: 96,
			cropAssets: {
				...baseRunResult.cropAssets,
				he: {
					...baseRunResult.cropAssets.he,
					fullres: { dataUrl: 'data:image/png;base64,he-fullres-64x96' },
				},
			},
		});

		render(<WorkspaceHarness initialProject={createProject()} />);

		await act(async () => {
			capturedCropQcPanelProps?.onRunCrop();
		});

		await waitFor(() => {
			expect(mockRunCropQc).toHaveBeenCalledTimes(1);
			expect(latestProject?.cropQc.cropWidth).toBe(64);
			expect(latestProject?.cropQc.cropHeight).toBe(96);
		});

		expect(latestProject?.cropQc.eosinReferenceGeometry?.width).toBe(30);
		expect(latestProject?.cropQc.eosinReferenceGeometry?.height).toBe(40);
	});
});
