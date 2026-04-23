import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LegacyPreprocessProject, PreprocessProject } from '@/types/preprocess';

type MockExportReadinessArgs = {
  includeAlignedImage?: boolean;
};

type CapturedExportPanelProps = {
  includeAlignedImage: boolean;
  canExport: boolean;
  onToggleIncludeAlignedImage: (value: boolean) => void;
  onDownload: () => void;
};

const mockExportPreprocessZip = vi.fn();
const mockGetPreprocessZipExportReadiness = vi.fn((_: unknown, options?: MockExportReadinessArgs) => (
  options?.includeAlignedImage
    ? { canExport: false, reason: 'Aligned tissue image export requires checkerboard Crop/QC data.' }
    : {
        canExport: true,
        data: {
          cropWidth: 100,
          cropHeight: 100,
          heCropAssets: {
            fullres: { dataUrl: 'data:image/png;base64,AA==' },
            hires: { dataUrl: 'data:image/png;base64,AA==' },
            lowres: { dataUrl: 'data:image/png;base64,AA==' },
          },
          projectedSpots: [],
          rows: 1,
          columns: 1,
          matrixValues: [1],
          selectedSpotIds: new Set<string>(),
          spotDiameterFullres: 1,
          tissueHiresScale: 1,
          tissueLowresScale: 1,
        },
      }
));
let capturedExportPanelProps: CapturedExportPanelProps | null = null;

vi.mock('../../../lib/preprocess/alignment', () => ({
  applyAcceptedAutoAlignment: (...args: unknown[]) => mockApplyAcceptedAutoAlignment(...args),
  classifyAutoRefinementOutcome: ({
    coarseBounds,
    eccCorrelation,
    acceptedTransform,
    failureReason,
  }: {
    coarseBounds: unknown;
    eccCorrelation: number | null;
    acceptedTransform: unknown;
    failureReason: string | null;
  }) => {
    if (!coarseBounds || failureReason === 'no-coarse-match') {
      return { accepted: false, fallbackReason: 'no-proposal' };
    }

    if (failureReason === 'ecc-failed') {
      return { accepted: false, fallbackReason: 'ecc-failed' };
    }

    if (
      failureReason === 'ecc-below-threshold'
      || typeof eccCorrelation !== 'number'
      || !Number.isFinite(eccCorrelation)
      || eccCorrelation < 0.75
    ) {
      return { accepted: false, fallbackReason: 'ecc-rejected' };
    }

    if (acceptedTransform) {
      return { accepted: true, fallbackReason: null };
    }

    return { accepted: false, fallbackReason: 'manual-required' };
  },
  computeAlignmentStatus: () => 'ready',
  normalizeAlignmentSlice: (value: Record<string, unknown>) => value,
}));

vi.mock('../../../lib/preprocess/cropQc', () => ({
  runCropQc: vi.fn(),
}));

vi.mock('../../../lib/preprocess/exportBundle', () => ({
  exportPreprocessZip: (...args: unknown[]) => mockExportPreprocessZip(...args),
  getPreprocessZipExportReadiness: (...args: unknown[]) => mockGetPreprocessZipExportReadiness(...args),
}));

vi.mock('../../../lib/preprocess/invalidation', () => ({
  invalidateOnAlignmentChange: (project: unknown) => project,
  invalidateOnCropQcChange: (project: unknown) => project,
  invalidateOnHeFocusAutoProposalChange: (project: unknown) => project,
  invalidateOnHeFocusChange: (project: unknown) => project,
  invalidateOnHeFocusChipBoundsChange: (project: unknown) => project,
  invalidateOnLocalizationChange: (project: unknown) => project,
  invalidateOnSourceAssetsChange: (project: unknown) => project,
}));

const mockRunHeAutoLocalization = vi.fn();
const mockApplyAcceptedAutoAlignment = vi.fn();

vi.mock('../../../lib/preprocess/heAutoLocalization', () => ({
  runHeAutoLocalization: (...args: unknown[]) => mockRunHeAutoLocalization(...args),
}));

vi.mock('../../../lib/preprocess/loadOpenCv', () => ({
  loadOpenCv: vi.fn(),
}));

vi.mock('../../../lib/preprocess/localization', () => ({
  buildLocalizationHandles: () => [],
  clampNormalizedSquareRect: (value: unknown) => value,
  computeLocalizationStatus: () => 'complete',
  createDefaultChipBounds: () => ({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }),
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

const mockRunTissueAutoSelection = vi.fn();
const mockLoadAllChipConfigManifests = vi.fn();
const mockLoadChipConfigData = vi.fn();

vi.mock('../../../lib/preprocess/tissuePipeline', () => ({
  runTissueAutoSelection: (...args: unknown[]) => mockRunTissueAutoSelection(...args),
}));

vi.mock('../../../lib/preprocess/chipConfigs', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/preprocess/chipConfigs')>('../../../lib/preprocess/chipConfigs');

  return {
    ...actual,
    loadAllChipConfigManifests: (...args: unknown[]) => mockLoadAllChipConfigManifests(...args),
    loadChipConfigData: (...args: unknown[]) => mockLoadChipConfigData(...args),
  };
});

vi.mock('./AlignmentPanel', () => ({
  AlignmentPanel: (props: {
    autoProposalMethod?: string | null;
    autoProposalStatus?: string;
    onRecomputeAutoLocalization?: () => void;
  }) => (
    <div data-testid="alignment-panel-mock">
      <div data-testid="alignment-panel-auto-status">{props.autoProposalStatus ?? 'missing-status'}</div>
      <div data-testid="alignment-panel-auto-method">{props.autoProposalMethod ?? 'missing-method'}</div>
      <button
        type="button"
        data-testid="alignment-panel-recompute"
        onClick={() => props.onRecomputeAutoLocalization?.()}
      >
        Recompute auto localization
      </button>
    </div>
  ),
}));

vi.mock('./CanvasStage', () => ({
  CanvasStage: () => null,
}));

vi.mock('./CropQcPanel', () => ({
  CropQcPanel: () => null,
}));

vi.mock('./ExportPanel', () => ({
  ExportPanel: (props: CapturedExportPanelProps) => {
    capturedExportPanelProps = props;
    return null;
  },
}));

vi.mock('./StepSidebar', () => ({
  StepSidebar: () => null,
}));

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
};

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    closePath: vi.fn(),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

beforeEach(() => {
  capturedExportPanelProps = null;
  mockExportPreprocessZip.mockReset();
  mockGetPreprocessZipExportReadiness.mockClear();
});

function WorkspaceHarness({
  initialProject = createProject(),
  onProjectChange,
  onStepChange = vi.fn(),
}: {
  initialProject?: PreprocessProject;
  onProjectChange?: (project: PreprocessProject) => void;
  onStepChange?: (stepId: PreprocessProject['currentStep']) => void;
}) {
  const [project, setProject] = useState(initialProject);

  useEffect(() => {
    onProjectChange?.(project);
  }, [onProjectChange, project]);

  return (
    <ChakraProvider theme={theme}>
      <PreprocessWorkspace
        autosaveStatus="saved"
        autosaveDetail={null}
        isLoading={false}
        loadError={null}
        onBackToLanding={vi.fn()}
        onProjectMutate={(updater: (current: PreprocessProject) => PreprocessProject) => {
          setProject((current) => updater(current));
        }}
        onProjectNameChange={vi.fn()}
        onStepChange={onStepChange}
        project={project}
      />
    </ChakraProvider>
  );
}

const { theme } = await import('../../../theme');
const {
  buildEmptyPreprocessProject,
  normalizeProjectForWorkspace,
} = await import('../projectState');
const { PreprocessWorkspace } = await import('./PreprocessWorkspace');

const createProject = (): PreprocessProject => ({
  id: 'preprocess-project',
  name: 'Preprocess project',
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
      eosin: {
        id: 'eosin-source',
        kind: 'eosin',
        fileName: 'eosin.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        width: 100,
        height: 100,
        lastModified: 1,
        dataUrl: 'data:image/png;base64,AA==',
      },
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
    cropWidth: 100,
    cropHeight: 100,
    paddingRatio: 0.02,
    tissue_hires_scalef: 1,
    tissue_lowres_scalef: 1,
    fiducial_diameter_fullres: 10,
    spot_diameter_fullres: 10,
    cropAssets: {
      eosin: {
        fullres: {
          dataUrl: 'data:image/png;base64,AA==',
        },
        hires: {
          dataUrl: 'data:image/png;base64,AA==',
        },
        lowres: {
          dataUrl: 'data:image/png;base64,AA==',
        },
      },
      he: {
        fullres: {
          dataUrl: 'data:image/png;base64,AA==',
        },
        hires: {
          dataUrl: 'data:image/png;base64,AA==',
        },
        lowres: {
          dataUrl: 'data:image/png;base64,AA==',
        },
      },
    },
    checkerboardPreview: {
      dataUrl: null,
    },
    overlayOpacity: 0.5,
    qcAccepted: true,
    issues: [],
    checkerboardTileSize: 64,
    featureMatchesPreview: {
      dataUrl: null,
    },
    featureMatchesPreviewDataUrl: null,
    eosinPreviewDataUrl: 'data:image/png;base64,AA==',
    previewDataUrl: 'data:image/png;base64,AA==',
    checkerboardPreviewDataUrl: null,
  },
  chipConfig: {
    status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    chipType: '15um',
    rows: 96,
    columns: 96,
    pitchX: 1,
    pitchY: 1,
    origin: { x: 0, y: 0 },
    rotationDegrees: 0,
    projectedSpots: [
      {
        id: 'spot-a',
        barcode: 'spot-a',
        arrayRow: 1,
        arrayCol: 1,
        x: 0.25,
        y: 0.25,
        width: 0.2,
        height: 0.2,
        diameterX: 0.2,
        diameterY: 0.2,
      },
      {
        id: 'spot-b',
        barcode: 'spot-b',
        arrayRow: 1,
        arrayCol: 2,
        x: 0.75,
        y: 0.25,
        width: 0.2,
        height: 0.2,
        diameterX: 0.2,
        diameterY: 0.2,
      },
    ],
  },
  tissueSelection: {
    status: 'ready',
    isStale: false,
    updatedAt: '2026-04-14T00:00:00.000Z',
    error: null,
    mode: 'matrix',
    thresholdMode: 'raw',
    activationThreshold: 0.1,
    blockThreshold: 120,
    dbscanEps: 0.2,
    dbscanMinSamples: 2,
    minConnectedSpotCount: 2,
    autoSelectedSpotIds: [],
    matrix: {
      rows: 96,
      columns: 96,
      values: Array.from({ length: 96 * 96 }, () => 0 as 0 | 1),
    },
    supportState: 'supported',
    unsupportedReason: null,
    selectedSpotIds: [],
    paritySummary: {
      selectedCount: 0,
      selectedPercent: 0,
      maskCoverage: 0,
    },
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

const createAcceptedAutoAlignmentSlice = (): PreprocessProject['alignment'] => ({
  ...createProject().alignment,
  status: 'complete',
  source: 'auto',
  controlPoints: [],
  inlierMask: [],
  affineMatrix: [1, 0, 0, 0, 1, 0],
  reprojectionRmse: 0,
  inlierRatio: 1,
  qualityFlags: {
    minPairs: true,
    inlierRatio: true,
    rmse: true,
    finiteMatrix: true,
    scaleRange: true,
    accepted: true,
  },
  solveAccepted: true,
  failureReason: null,
  transform: {
    translationX: 0,
    translationY: 0,
    rotationDegrees: 2.5,
    scaleX: 1,
    scaleY: 1,
    isUniformScale: true,
  },
});

describe('PreprocessWorkspace tissue selection stale request protection', () => {
  beforeEach(() => {
    mockRunTissueAutoSelection.mockReset();
    mockLoadAllChipConfigManifests.mockReset();
    mockLoadChipConfigData.mockReset();
    mockRunHeAutoLocalization.mockReset();
    mockLoadAllChipConfigManifests.mockResolvedValue([]);
    mockLoadChipConfigData.mockResolvedValue(null);
  });

  it('toggles spot visibility locally without changing the selected spot count', async () => {
    const user = userEvent.setup();
    render(<WorkspaceHarness />);

    const selectedCount = screen.getByTestId('tissue-selected-count');
    const panelSelectedCount = screen.getByTestId('tissue-panel-selected-count');
    const toggleButton = screen.getByRole('button', { name: 'Hide spots' });

    expect(selectedCount).toHaveTextContent('Selected spots: 0');
    expect(panelSelectedCount).toHaveTextContent('Selected spots: 0');

    await user.click(toggleButton);

    expect(screen.getByRole('button', { name: 'Show spots' })).toBeInTheDocument();
    expect(selectedCount).toHaveTextContent('Selected spots: 0');
    expect(panelSelectedCount).toHaveTextContent('Selected spots: 0');
  });

  it('uses edited activation and block thresholds for the next auto-detection run without auto-running on edit', async () => {
    mockRunTissueAutoSelection.mockResolvedValue({
      selectedIds: [],
      matrix: {
        rows: 96,
        columns: 96,
        values: Array.from({ length: 96 * 96 }, () => 0 as const),
      },
      summary: {
        selectedCount: 0,
        selectedPercent: 0,
        maskCoverage: 0,
      },
      params: {
        thresholdMode: 'raw',
        activationThreshold: 0.25,
        blockThreshold: 120,
        dbscanEps: 0.2,
        dbscanMinSamples: 2,
        minConnectedSpotCount: 2,
      },
      warning: null,
    });

    const user = userEvent.setup();
    render(<WorkspaceHarness />);

    const activationInput = screen.getByTestId('tissue-activation-threshold-input');
    const blockInput = screen.getByTestId('tissue-block-threshold-input');
    const runAutoButton = screen.getByTestId('tissue-run-auto');

    expect(screen.getByTestId('tissue-threshold-mode-select')).toHaveValue('raw');
    expect(activationInput).toHaveValue(0.1);
    expect(blockInput).toHaveValue(120);

    await user.clear(activationInput);
    await user.type(activationInput, '0.25');

    expect(activationInput).toHaveValue(0.25);
    expect(mockRunTissueAutoSelection).not.toHaveBeenCalled();
    expect(screen.getByTestId('tissue-detection-status')).toHaveTextContent(
      'Choose a threshold mode and run auto detection to refresh the tissue matrix.',
    );

    await user.clear(blockInput);
    await user.type(blockInput, '140');

    expect(blockInput).toHaveValue(140);
    expect(mockRunTissueAutoSelection).not.toHaveBeenCalled();
    expect(screen.getByTestId('tissue-detection-status')).toHaveTextContent(
      'Choose a threshold mode and run auto detection to refresh the tissue matrix.',
    );

    await user.click(runAutoButton);

    await waitFor(() => {
      expect(mockRunTissueAutoSelection).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            activationThreshold: 0.25,
            blockThreshold: 140,
          }),
        }),
      );
    });
  });

	it('blocks tissue auto-detection while repaired crop or chip projection state is still stale', async () => {
		const initialProject = createProject();
		initialProject.cropQc.status = 'stale';
		initialProject.cropQc.isStale = true;
		initialProject.chipConfig.status = 'stale';
		initialProject.chipConfig.isStale = true;
		initialProject.chipConfig.projectedSpots = null;

		const user = userEvent.setup();
		render(<WorkspaceHarness initialProject={initialProject} />);

		expect(screen.getByTestId('tissue-detection-status')).toHaveTextContent(
			'Crop/QC output is stale or incomplete. Re-run Crop/QC and accept it before tissue auto detection.',
		);

		await user.click(screen.getByTestId('tissue-run-auto'));

		expect(mockRunTissueAutoSelection).not.toHaveBeenCalled();
	});

  it('keeps chip switching available for unsupported tissue support and clears matrix-backed selection state on chip change', async () => {
    mockLoadChipConfigData.mockResolvedValue({
      manifest: {
        id: '50um',
        gridRows: 78,
        gridCols: 64,
        spotGap: 2,
      },
      templateEntries: [],
    });

    const user = userEvent.setup();
    render(<WorkspaceHarness />);

    const chipSizeSelect = screen.getByTestId('tissue-chip-size-select');
    const thresholdModeSelect = screen.getByTestId('tissue-threshold-mode-select');
    const runAutoButton = screen.getByTestId('tissue-run-auto');
    const activateButton = screen.getByTestId('tissue-tool-activate');
    const deactivateButton = screen.getByTestId('tissue-tool-deactivate');

    mockRunTissueAutoSelection.mockResolvedValueOnce({
      selectedIds: ['spot-a'],
      matrix: {
        rows: 96,
        columns: 96,
        values: [1, 0, ...Array.from({ length: 96 * 96 - 2 }, () => 0 as 0 | 1)],
      },
      summary: {
        selectedCount: 1,
        selectedPercent: 50,
        maskCoverage: 50,
      },
      params: {
        thresholdMode: 'raw',
        activationThreshold: 0.1,
        blockThreshold: 120,
        dbscanEps: 0.2,
        dbscanMinSamples: 2,
        minConnectedSpotCount: 2,
      },
      warning: null,
    });

    expect(chipSizeSelect).toBeEnabled();
    expect(thresholdModeSelect).not.toBeDisabled();
    expect(runAutoButton).not.toBeDisabled();
    expect(activateButton).not.toBeDisabled();
    expect(deactivateButton).not.toBeDisabled();
    expect(screen.getByTestId('tissue-selected-count')).toHaveTextContent('Selected spots: 0');

    await user.click(runAutoButton);

    await waitFor(() => {
      expect(screen.getByTestId('tissue-selected-count')).toHaveTextContent('Selected spots: 1');
      expect(screen.getByTestId('tissue-panel-selected-count')).toHaveTextContent('Selected spots: 1');
    });

    await user.selectOptions(thresholdModeSelect, 'gray-max');
    expect(thresholdModeSelect).toHaveValue('gray-max');
    expect(chipSizeSelect).toBeEnabled();

    await user.selectOptions(chipSizeSelect, '50um');

    await waitFor(() => {
      expect(chipSizeSelect).toHaveValue('50um');
    });

    expect(
      screen.getByText('Tissue selection currently supports only 15um and 50um chips.'),
    ).toBeInTheDocument();
    expect(screen.getByText('50um tissue selection requires a 64x64 grid.')).toBeInTheDocument();
    expect(chipSizeSelect).toBeEnabled();
    expect(thresholdModeSelect).toBeDisabled();
    expect(runAutoButton).toBeDisabled();
    expect(activateButton).toBeDisabled();
    expect(deactivateButton).toBeDisabled();
    expect(screen.getByTestId('tissue-selected-count')).toHaveTextContent('Selected spots: 0');
    expect(screen.getByTestId('tissue-panel-selected-count')).toHaveTextContent('Selected spots: 0');
  });

  it('keeps only the latest auto-detection result when an older request resolves last', async () => {
    const requestA = createDeferred<{
      selectedIds: string[];
      matrix: { rows: number; columns: number; values: Array<0 | 1> };
      summary: { selectedCount: number; selectedPercent: number; maskCoverage: number };
      params: {
        thresholdMode: 'raw' | 'gray-max' | 'gray-min';
        activationThreshold: number;
        blockThreshold: number;
        dbscanEps: number;
        dbscanMinSamples: number;
        minConnectedSpotCount: number;
      };
      warning: string | null;
    }>();
    const requestB = createDeferred<{
      selectedIds: string[];
      matrix: { rows: number; columns: number; values: Array<0 | 1> };
      summary: { selectedCount: number; selectedPercent: number; maskCoverage: number };
      params: {
        thresholdMode: 'raw' | 'gray-max' | 'gray-min';
        activationThreshold: number;
        blockThreshold: number;
        dbscanEps: number;
        dbscanMinSamples: number;
        minConnectedSpotCount: number;
      };
      warning: string | null;
    }>();

    mockRunTissueAutoSelection
      .mockReturnValueOnce(requestA.promise)
      .mockReturnValueOnce(requestB.promise);

    render(<WorkspaceHarness />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('tissue-run-auto'));

    await waitFor(() => {
      expect(mockRunTissueAutoSelection).toHaveBeenCalledTimes(1);
    });

    requestA.resolve({
      selectedIds: ['spot-a'],
      matrix: {
        rows: 96,
        columns: 96,
        values: [1, 0, ...Array.from({ length: 96 * 96 - 2 }, () => 0 as 0 | 1)],
      },
      summary: {
        selectedCount: 1,
        selectedPercent: 50,
        maskCoverage: 50,
      },
      params: {
        thresholdMode: 'raw',
        activationThreshold: 0.1,
        blockThreshold: 120,
        dbscanEps: 0.2,
        dbscanMinSamples: 2,
        minConnectedSpotCount: 2,
      },
      warning: null,
    });
    await flushPromises();

    await waitFor(() => {
      expect(screen.getByTestId('tissue-threshold-mode-select')).not.toBeDisabled();
      expect(screen.getByTestId('tissue-threshold-mode-select')).toHaveValue('raw');
    });

    await user.selectOptions(screen.getByTestId('tissue-threshold-mode-select'), 'gray-max');
    await user.click(screen.getByTestId('tissue-run-auto'));

    await waitFor(() => {
      expect(mockRunTissueAutoSelection).toHaveBeenCalledTimes(2);
    });

    requestB.resolve({
      selectedIds: ['spot-b'],
      matrix: {
        rows: 96,
        columns: 96,
        values: [0, 1, ...Array.from({ length: 96 * 96 - 2 }, () => 0 as 0 | 1)],
      },
      summary: {
        selectedCount: 1,
        selectedPercent: 50,
        maskCoverage: 50,
      },
      params: {
        thresholdMode: 'gray-max',
        activationThreshold: 0.1,
        blockThreshold: 120,
        dbscanEps: 0.2,
        dbscanMinSamples: 2,
        minConnectedSpotCount: 2,
      },
      warning: null,
    });
    await flushPromises();

    await waitFor(() => {
      expect(screen.getByTestId('tissue-threshold-mode-select')).toHaveValue('gray-max');
      expect(screen.getByTestId('tissue-panel-selected-count')).toHaveTextContent('Selected spots: 1');
    });

    requestA.resolve({
      selectedIds: ['spot-a'],
      matrix: {
        rows: 96,
        columns: 96,
        values: [1, 0, ...Array.from({ length: 96 * 96 - 2 }, () => 0 as 0 | 1)],
      },
      summary: {
        selectedCount: 1,
        selectedPercent: 50,
        maskCoverage: 50,
      },
      params: {
        thresholdMode: 'raw',
        activationThreshold: 0.1,
        blockThreshold: 120,
        dbscanEps: 0.2,
        dbscanMinSamples: 2,
        minConnectedSpotCount: 2,
      },
      warning: null,
    });
    await flushPromises();

    await waitFor(() => {
      expect(screen.getByTestId('tissue-threshold-mode-select')).toHaveValue('gray-max');
      expect(screen.getByTestId('tissue-panel-selected-count')).toHaveTextContent('Selected spots: 1');
    });
  });
});

describe('PreprocessWorkspace heFocus auto bootstrap', () => {
  beforeEach(() => {
    mockRunHeAutoLocalization.mockReset();
    mockApplyAcceptedAutoAlignment.mockReset();
    mockApplyAcceptedAutoAlignment.mockReturnValue(null);
  });

  it('seeds accepted refined bounds and canonical proposal data instead of a generic square', async () => {
    const initialProject = createProject();
    initialProject.currentStep = 'heFocus';
    initialProject.localization.chipBounds = { x: 0.12, y: 0.18, width: 0.42, height: 0.4 };
    initialProject.heFocus.status = 'ready';
    initialProject.sourceAssets.images.he = {
      id: 'he-source',
      kind: 'he',
      fileName: 'he.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      width: 200,
      height: 150,
      lastModified: 2,
      dataUrl: 'data:image/png;base64,BB==',
    };

    const coarseBounds = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 };
    const refinedBounds = { x: 0.24, y: 0.26, width: 0.34, height: 0.34 };
    const acceptedTransform = {
      affineMatrix: [1, 0, 0, 0, 1, 0],
      transform: {
        translationX: 0,
        translationY: 0,
        rotationDegrees: 2.5,
        scaleX: 1,
        scaleY: 1,
        isUniformScale: true,
      },
    };
    mockApplyAcceptedAutoAlignment.mockImplementation(({ acceptedTransform: handedOffTransform }) => ({
      ...createAcceptedAutoAlignmentSlice(),
      affineMatrix: handedOffTransform?.affineMatrix ?? null,
      transform: handedOffTransform?.transform ?? null,
    }));
    mockRunHeAutoLocalization.mockResolvedValue({
      method: 'mask-ecc-v1',
      coarseBounds,
      refinedBounds,
      refinedQuad: [
        { x: 0.24, y: 0.26 },
        { x: 0.58, y: 0.26 },
        { x: 0.58, y: 0.6 },
        { x: 0.24, y: 0.6 },
      ],
      rotationDegrees: 2.5,
      eccCorrelation: 0.91,
      acceptedTransform,
      failureReason: null,
    });

    let latestProject = initialProject;
    render(
      <WorkspaceHarness
        initialProject={initialProject}
        onProjectChange={(project) => {
          latestProject = project;
        }}
      />,
    );

    await waitFor(() => {
      expect(mockRunHeAutoLocalization).toHaveBeenCalledWith({
        eosinSource: { dataUrl: 'data:image/png;base64,AA==' },
        heSource: { dataUrl: 'data:image/png;base64,BB==' },
        localizationBounds: initialProject.localization.chipBounds,
      });
    });

    await waitFor(() => {
      expect(latestProject.heFocus.chipBounds).toEqual(refinedBounds);
    });

    expect(latestProject.heFocus.autoProposal).toEqual({
      status: 'accepted',
      method: 'mask-ecc-v1',
      coarseBounds,
      refinedBounds,
      refinedQuad: [
        { x: 0.24, y: 0.26 },
        { x: 0.58, y: 0.26 },
        { x: 0.58, y: 0.6 },
        { x: 0.24, y: 0.6 },
      ],
      rotationDegrees: 2.5,
      eccCorrelation: 0.91,
      failureReason: null,
    });
    expect(latestProject.heFocus.chipBounds).not.toEqual(coarseBounds);
    expect(latestProject.heFocus.focusedImageDataUrl).toBeNull();
    expect(latestProject.heFocus.status).toBe('complete');
    expect(mockApplyAcceptedAutoAlignment).toHaveBeenCalledWith({
      current: initialProject.alignment,
      autoProposal: {
        status: 'accepted',
        method: 'mask-ecc-v1',
        coarseBounds,
        refinedBounds,
        refinedQuad: [
          { x: 0.24, y: 0.26 },
          { x: 0.58, y: 0.26 },
          { x: 0.58, y: 0.6 },
          { x: 0.24, y: 0.6 },
        ],
        rotationDegrees: 2.5,
        eccCorrelation: 0.91,
        failureReason: null,
      },
      acceptedTransform,
      hasReferenceImage: true,
      hasMovingImage: true,
    });
    expect(latestProject.alignment.source).toBe('auto');
    expect(latestProject.alignment.solveAccepted).toBe(true);
    expect(latestProject.alignment.status).toBe('complete');
    expect(latestProject.alignment.affineMatrix).toEqual(acceptedTransform.affineMatrix);
    expect(latestProject.alignment.transform).toEqual(acceptedTransform.transform);
  });

  it('seeds coarse fallback bounds, persists fallback proposal state, and stays on heFocus', async () => {
    const initialProject = createProject();
    initialProject.currentStep = 'heFocus';
    initialProject.localization.chipBounds = { x: 0.1, y: 0.14, width: 0.44, height: 0.38 };
    initialProject.heFocus.status = 'ready';
    initialProject.sourceAssets.images.he = {
      id: 'he-source',
      kind: 'he',
      fileName: 'he.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      width: 200,
      height: 150,
      lastModified: 2,
      dataUrl: 'data:image/png;base64,BB==',
    };

    const coarseBounds = { x: 0.19, y: 0.21, width: 0.46, height: 0.46 };
    mockRunHeAutoLocalization.mockResolvedValue({
      method: 'mask-ecc-v1',
      coarseBounds,
      refinedBounds: null,
      refinedQuad: null,
      rotationDegrees: null,
      eccCorrelation: 0.42,
      acceptedTransform: null,
      failureReason: 'ecc-failed',
    });

    let latestProject = initialProject;
    const onStepChange = vi.fn();
    render(
      <WorkspaceHarness
        initialProject={initialProject}
        onProjectChange={(project) => {
          latestProject = project;
        }}
        onStepChange={onStepChange}
      />,
    );

    await waitFor(() => {
      expect(latestProject.heFocus.chipBounds).toEqual(coarseBounds);
    });

    expect(latestProject.heFocus.autoProposal).toEqual({
      status: 'fallback',
      method: 'mask-ecc-v1',
      coarseBounds,
      refinedBounds: null,
      refinedQuad: null,
      rotationDegrees: null,
      eccCorrelation: 0.42,
      failureReason: 'ecc-failed',
    });
    expect(latestProject.heFocus.focusedImageDataUrl).toBeNull();
    expect(latestProject.currentStep).toBe('heFocus');
    expect(onStepChange).not.toHaveBeenCalled();
    expect(mockApplyAcceptedAutoAlignment).toHaveBeenCalledWith(
      expect.objectContaining({
        autoProposal: expect.objectContaining({
          status: 'fallback',
          failureReason: 'ecc-failed',
        }),
        acceptedTransform: null,
      }),
    );
    expect(latestProject.alignment.source).toBeNull();
  });

  it('keeps a coarse proposal as fallback when ECC is rejected below the acceptance threshold', async () => {
    const initialProject = createProject();
    initialProject.currentStep = 'heFocus';
    initialProject.localization.chipBounds = { x: 0.08, y: 0.12, width: 0.46, height: 0.4 };
    initialProject.heFocus.status = 'ready';
    initialProject.sourceAssets.images.he = {
      id: 'he-source',
      kind: 'he',
      fileName: 'he.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      width: 200,
      height: 150,
      lastModified: 2,
      dataUrl: 'data:image/png;base64,BB==',
    };

    const coarseBounds = { x: 0.16, y: 0.22, width: 0.48, height: 0.44 };
    mockRunHeAutoLocalization.mockResolvedValue({
      method: 'mask-ecc-v1',
      coarseBounds,
      refinedBounds: null,
      refinedQuad: null,
      rotationDegrees: 1.25,
      eccCorrelation: 0.74,
      acceptedTransform: null,
      failureReason: 'ecc-below-threshold',
    });

    let latestProject = initialProject;
    render(
      <WorkspaceHarness
        initialProject={initialProject}
        onProjectChange={(project) => {
          latestProject = project;
        }}
      />,
    );

    await waitFor(() => {
      expect(latestProject.heFocus.chipBounds).toEqual(coarseBounds);
    });

    expect(latestProject.heFocus.autoProposal).toEqual({
      status: 'fallback',
      method: 'mask-ecc-v1',
      coarseBounds,
      refinedBounds: null,
      refinedQuad: null,
      rotationDegrees: 1.25,
      eccCorrelation: 0.74,
      failureReason: 'ecc-below-threshold',
    });
    expect(mockApplyAcceptedAutoAlignment).toHaveBeenCalledWith(
      expect.objectContaining({
        autoProposal: expect.objectContaining({
          status: 'fallback',
          failureReason: 'ecc-below-threshold',
        }),
        acceptedTransform: null,
      }),
    );
    expect(latestProject.alignment.source).toBeNull();
  });

  it('falls back cleanly to the generic square when auto localization reports missing runtime capabilities', async () => {
    const initialProject = createProject();
    initialProject.currentStep = 'heFocus';
    initialProject.localization.chipBounds = { x: 0.1, y: 0.14, width: 0.44, height: 0.38 };
    initialProject.heFocus.status = 'ready';
    initialProject.sourceAssets.images.he = {
      id: 'he-source',
      kind: 'he',
      fileName: 'he.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      width: 200,
      height: 150,
      lastModified: 2,
      dataUrl: 'data:image/png;base64,BB==',
    };

    mockRunHeAutoLocalization.mockResolvedValue({
      method: 'mask-ecc-v1',
      coarseBounds: null,
      refinedBounds: null,
      refinedQuad: null,
      rotationDegrees: null,
      eccCorrelation: null,
      acceptedTransform: null,
      failureReason: 'runtime-missing-capabilities',
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let latestProject = initialProject;
    render(
      <WorkspaceHarness
        initialProject={initialProject}
        onProjectChange={(project) => {
          latestProject = project;
        }}
      />,
    );

    await waitFor(() => {
      expect(latestProject.heFocus.chipBounds).toEqual({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    });

    expect(latestProject.heFocus.autoProposal).toEqual({
      status: 'failed',
      method: 'mask-ecc-v1',
      coarseBounds: null,
      refinedBounds: null,
      refinedQuad: null,
      rotationDegrees: null,
      eccCorrelation: null,
      failureReason: 'runtime-missing-capabilities',
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
  it('routes fallback alignment recovery back through heFocus so auto-localization can rerun after edits', async () => {
    const initialProject = createProject();
    initialProject.currentStep = 'alignment';
    initialProject.heFocus.chipBounds = { x: 0.19, y: 0.21, width: 0.46, height: 0.46 };
    initialProject.heFocus.status = 'complete';
    initialProject.heFocus.autoProposal = {
      status: 'fallback',
      method: 'mask-ecc-v1',
      coarseBounds: { x: 0.19, y: 0.21, width: 0.46, height: 0.46 },
      refinedBounds: null,
      refinedQuad: null,
      rotationDegrees: null,
      eccCorrelation: 0.42,
      failureReason: 'ecc-failed',
    };
    initialProject.localization.chipBounds = { x: 0.1, y: 0.14, width: 0.44, height: 0.38 };
    initialProject.sourceAssets.images.he = {
      id: 'he-source',
      kind: 'he',
      fileName: 'he.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      width: 200,
      height: 150,
      lastModified: 2,
      dataUrl: 'data:image/png;base64,BB==',
    };

    mockRunHeAutoLocalization.mockResolvedValue({
      method: 'mask-ecc-v1',
      coarseBounds: { x: 0.22, y: 0.24, width: 0.4, height: 0.4 },
      refinedBounds: { x: 0.24, y: 0.26, width: 0.34, height: 0.34 },
      refinedQuad: [
        { x: 0.24, y: 0.26 },
        { x: 0.58, y: 0.26 },
        { x: 0.58, y: 0.6 },
        { x: 0.24, y: 0.6 },
      ],
      rotationDegrees: 2.5,
      eccCorrelation: 0.91,
      acceptedTransform: {
        affineMatrix: [1, 0, 0, 0, 1, 0],
        transform: {
          translationX: 0,
          translationY: 0,
          rotationDegrees: 2.5,
          scaleX: 1,
          scaleY: 1,
          isUniformScale: true,
        },
      },
      failureReason: null,
    });

    let latestProject = initialProject;
    const onStepChange = vi.fn();
    render(
      <WorkspaceHarness
        initialProject={initialProject}
        onProjectChange={(project) => {
          latestProject = project;
        }}
        onStepChange={onStepChange}
      />,
    );

    expect(screen.getByTestId('alignment-panel-auto-status')).toHaveTextContent('fallback');
    expect(screen.getByTestId('alignment-panel-auto-method')).toHaveTextContent('mask-ecc-v1');

    const user = userEvent.setup();
    await user.click(screen.getByTestId('alignment-panel-recompute'));

    await waitFor(() => {
      expect(onStepChange).toHaveBeenCalledWith('heFocus');
    });
    expect(latestProject.currentStep).toBe('heFocus');
    await waitFor(() => {
      expect(mockRunHeAutoLocalization).toHaveBeenCalled();
    });
    expect(latestProject.heFocus.focusedImageDataUrl).toBeNull();
    expect(latestProject.heFocus.autoProposal.status).toBe('accepted');
    expect(latestProject.heFocus.chipBounds).toEqual({
      x: 0.24,
      y: 0.26,
      width: 0.34,
      height: 0.34,
    });
    expect(latestProject.heFocus.status).toBe('complete');
  });
});

describe('PreprocessWorkspace export readiness gating', () => {
  it('threads includeAlignedImage through export readiness and blocks download before export when checkerboard data is missing', async () => {
    const exportProject = {
      ...createProject(),
      currentStep: 'exportState' as const,
    };

    render(<WorkspaceHarness initialProject={exportProject} />);

    await waitFor(() => {
      expect(capturedExportPanelProps?.canExport).toBe(true);
    });
    expect(mockGetPreprocessZipExportReadiness).toHaveBeenLastCalledWith(expect.anything(), { includeAlignedImage: false });

    await act(async () => {
      capturedExportPanelProps?.onToggleIncludeAlignedImage(true);
    });

    await waitFor(() => {
      expect(capturedExportPanelProps?.includeAlignedImage).toBe(true);
      expect(capturedExportPanelProps?.canExport).toBe(false);
    });
    expect(mockGetPreprocessZipExportReadiness).toHaveBeenLastCalledWith(expect.anything(), { includeAlignedImage: true });

    await act(async () => {
      capturedExportPanelProps?.onDownload();
    });

    expect(mockExportPreprocessZip).not.toHaveBeenCalled();
    expect(mockGetPreprocessZipExportReadiness).toHaveBeenLastCalledWith(expect.anything(), { includeAlignedImage: true });
  });
});

describe('PreprocessWorkspace chip projection auto-run guards', () => {
  it('still auto-runs chip projection when emitted crop dimensions differ from eosinReferenceGeometry evidence', async () => {
    mockLoadChipConfigData.mockResolvedValue({
      manifest: {
        id: '15um',
        label: '15um',
        gridRows: 2,
        gridCols: 2,
        spotDiameter: 10,
        spotGap: 10,
        barcodeTemplatePath: '/unused/template.csv',
        tissuePositionsPath: '/unused/template.csv',
      },
      templateEntries: [
        {
          barcode: 'spot-a',
          arrayRow: 1,
          arrayCol: 1,
          pxl_row_in_fullres: 20,
          pxl_col_in_fullres: 20,
        },
        {
          barcode: 'spot-b',
          arrayRow: 1,
          arrayCol: 2,
          pxl_row_in_fullres: 20,
          pxl_col_in_fullres: 40,
        },
      ],
    });

    const initialProject = createProject();
    initialProject.cropQc.eosinReferenceGeometry = {
      rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      width: 30,
      height: 40,
    };
    initialProject.cropQc.cropRect = initialProject.cropQc.eosinReferenceGeometry.rect;
    initialProject.cropQc.cropWidth = 64;
    initialProject.cropQc.cropHeight = 96;
    initialProject.cropQc.qcAccepted = true;
    initialProject.chipConfig.status = 'idle';
    initialProject.chipConfig.isStale = false;
    initialProject.chipConfig.chipType = '15um';
    initialProject.chipConfig.projectedSpots = null;

    let latestProject = initialProject;
    render(
      <WorkspaceHarness
        initialProject={initialProject}
        onProjectChange={(project) => {
          latestProject = project;
        }}
      />,
    );

    await waitFor(() => {
      expect(mockLoadChipConfigData).toHaveBeenCalledWith('15um');
      expect(latestProject.chipConfig.projectedSpots).not.toBeNull();
    });

    expect(latestProject.cropQc.cropWidth).toBe(64);
    expect(latestProject.cropQc.cropHeight).toBe(96);
    expect(latestProject.cropQc.eosinReferenceGeometry?.width).toBe(30);
    expect(latestProject.cropQc.eosinReferenceGeometry?.height).toBe(40);
  });
});

describe('preprocess workspace state normalization helpers', () => {
  beforeEach(() => {
    mockRunHeAutoLocalization.mockReset();
    mockApplyAcceptedAutoAlignment.mockReset();
    mockApplyAcceptedAutoAlignment.mockReturnValue(null);
  });

  it('hydrates legacy project without auto localization fields', () => {
    const legacyProject = buildEmptyPreprocessProject('Legacy project') as unknown as LegacyPreprocessProject;
    const heFocusRecord = legacyProject.heFocus as unknown as Record<string, unknown>;
    const alignmentRecord = legacyProject.alignment as unknown as Record<string, unknown>;

    if (!legacyProject.heFocus) {
      throw new Error('Expected buildEmptyPreprocessProject to include heFocus state.');
    }

    legacyProject.heFocus.focusedImageDataUrl = 'blob:he-focus-preview';
    legacyProject.alignment.previewDataUrl = 'blob:alignment-preview';

    delete heFocusRecord.autoProposal;
    delete alignmentRecord.source;

    const normalized = normalizeProjectForWorkspace(legacyProject);

    expect(normalized.heFocus.autoProposal).toEqual({
      status: 'idle',
      method: null,
      coarseBounds: null,
      refinedBounds: null,
      refinedQuad: null,
      rotationDegrees: null,
      eccCorrelation: null,
      failureReason: null,
    });
    expect(normalized.alignment.source).toBeNull();
    expect(normalized.heFocus.focusedImageDataUrl).toBe('blob:he-focus-preview');
    expect(normalized.alignment.previewDataUrl).toBe('blob:alignment-preview');
  });

  it('round-trips legacy auto-localization defaults through autosave serialization', () => {
    const legacyProject = buildEmptyPreprocessProject('Round-trip project') as unknown as LegacyPreprocessProject;
    const heFocusRecord = legacyProject.heFocus as unknown as Record<string, unknown>;
    const alignmentRecord = legacyProject.alignment as unknown as Record<string, unknown>;

    if (!legacyProject.heFocus) {
      throw new Error('Expected buildEmptyPreprocessProject to include heFocus state.');
    }

    legacyProject.heFocus.focusedImageDataUrl = 'blob:he-focus-preview';
    legacyProject.alignment.previewDataUrl = 'blob:alignment-preview';

    delete heFocusRecord.autoProposal;
    delete alignmentRecord.source;

    const normalized = normalizeProjectForWorkspace(legacyProject);
    const roundTripped = normalizeProjectForWorkspace(
      JSON.parse(JSON.stringify(normalized)) as LegacyPreprocessProject,
    );

    expect(roundTripped.heFocus.focusedImageDataUrl).toBe('blob:he-focus-preview');
    expect(roundTripped.alignment.previewDataUrl).toBe('blob:alignment-preview');
    expect(roundTripped.heFocus.autoProposal).toEqual(normalized.heFocus.autoProposal);
    expect(roundTripped.alignment.source).toBeNull();
    expect(Object.values(roundTripped.heFocus.autoProposal)).not.toContain(undefined);
  });

  it('reloads a saved project with accepted auto state without recomputing localization', async () => {
    const savedProject = createProject();
    savedProject.currentStep = 'alignment';
    savedProject.sourceAssets.images.he = {
      id: 'he-source',
      kind: 'he',
      fileName: 'he.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      width: 200,
      height: 150,
      lastModified: 2,
      dataUrl: 'data:image/png;base64,BB==',
    };
    savedProject.localization.chipBounds = { x: 0.12, y: 0.18, width: 0.42, height: 0.4 };
    savedProject.heFocus.status = 'complete';
    savedProject.heFocus.chipBounds = { x: 0.24, y: 0.26, width: 0.34, height: 0.34 };
    savedProject.heFocus.autoProposal = {
      status: 'accepted',
      method: 'mask-ecc-v1',
      coarseBounds: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
      refinedBounds: { x: 0.24, y: 0.26, width: 0.34, height: 0.34 },
      refinedQuad: [
        { x: 0.24, y: 0.26 },
        { x: 0.58, y: 0.26 },
        { x: 0.58, y: 0.6 },
        { x: 0.24, y: 0.6 },
      ],
      rotationDegrees: 2.5,
      eccCorrelation: 0.91,
      failureReason: null,
    };
    savedProject.alignment = createAcceptedAutoAlignmentSlice();

    const reloadedProject = normalizeProjectForWorkspace(
      JSON.parse(JSON.stringify(savedProject)) as LegacyPreprocessProject,
    );

    let latestProject = reloadedProject;
    render(
      <WorkspaceHarness
        initialProject={reloadedProject}
        onProjectChange={(project) => {
          latestProject = project;
        }}
      />,
    );

    await flushPromises();

    expect(mockRunHeAutoLocalization).not.toHaveBeenCalled();
    expect(screen.getByTestId('alignment-panel-auto-status')).toHaveTextContent('accepted');
    expect(screen.getByTestId('alignment-panel-auto-method')).toHaveTextContent('mask-ecc-v1');
    expect(latestProject.heFocus.autoProposal.status).toBe('accepted');
    expect(latestProject.alignment.source).toBe('auto');
    expect(latestProject.alignment.solveAccepted).toBe(true);
    expect(latestProject.heFocus.chipBounds).toEqual(savedProject.heFocus.chipBounds);
  });
});
