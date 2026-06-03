import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PreprocessProject } from '@/types/preprocess';

type MockExportReadinessArgs = {
  includeAlignedImage?: boolean;
};

type CapturedExportPanelProps = {
  includeAlignedImage: boolean;
  canExport: boolean;
  onToggleIncludeAlignedImage: (value: boolean) => void;
  onDownload: () => void;
};

type CapturedPersistOptions = {
  mode?: string;
  strategy?: 'immediate' | 'debounced';
};

type CapturedProjectMutation = {
  project: PreprocessProject;
  persistOptions?: CapturedPersistOptions;
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
const mockGetPreprocessZipExportReadinessProxy = (...args: Parameters<typeof mockGetPreprocessZipExportReadiness>) => (
  mockGetPreprocessZipExportReadiness(...args)
);
const mockToast = vi.fn();
const mockRouterPush = vi.fn();
const mockSearchParamsState: { preprocessId: string | null } = { preprocessId: null };
const mockDeletePreprocessProject = vi.fn();
const mockGetPreprocessProject = vi.fn();
const mockReadPreprocessProjectSummaries = vi.fn();
const mockUpsertPreprocessProject = vi.fn();
const mockUpsertPreprocessProjectMetadata = vi.fn();
let capturedExportPanelProps: CapturedExportPanelProps | null = null;

vi.mock('@chakra-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@chakra-ui/react')>('@chakra-ui/react');

  return {
    ...actual,
    useToast: () => mockToast,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'preprocess_id' ? mockSearchParamsState.preprocessId : null),
  }),
}));

vi.mock('../../../lib/preprocess/storage', () => ({
  deletePreprocessProject: (...args: unknown[]) => mockDeletePreprocessProject(...args),
  getPreprocessProject: (...args: unknown[]) => mockGetPreprocessProject(...args),
  readPreprocessProjectSummaries: (...args: unknown[]) => mockReadPreprocessProjectSummaries(...args),
  upsertPreprocessProject: (...args: unknown[]) => mockUpsertPreprocessProject(...args),
  upsertPreprocessProjectMetadata: (...args: unknown[]) => mockUpsertPreprocessProjectMetadata(...args),
}));

vi.mock('../../../lib/preprocess/alignment', () => ({
  computeAlignmentStatus: () => 'ready',
  normalizeAlignmentSlice: (value: Record<string, unknown>) => value,
}));

vi.mock('../../../lib/preprocess/cropQc', () => ({
  runCropQc: vi.fn(),
}));

vi.mock('../../../lib/preprocess/exportBundle', () => ({
  exportPreprocessZip: (...args: unknown[]) => mockExportPreprocessZip(...args),
  getPreprocessZipExportReadiness: mockGetPreprocessZipExportReadinessProxy,
}));

vi.mock('../../../lib/preprocess/invalidation', () => ({
  invalidateOnAlignmentChange: (project: unknown) => project,
  invalidateOnCropQcChange: (project: unknown) => project,
  invalidateOnHeFocusChange: (project: unknown) => project,
  invalidateOnHeFocusChipBoundsChange: (project: unknown) => project,
  invalidateOnLocalizationChange: (project: unknown) => project,
  invalidateOnSourceAssetsChange: (project: unknown) => project,
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
  AlignmentPanel: () => <div data-testid="alignment-panel-mock" />,
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
	StepSidebar: (props: {
		currentStep: PreprocessProject['currentStep'];
		onStepSelect?: (step: PreprocessProject['currentStep']) => void;
	}) => (
		<div data-testid="step-sidebar-mock">
			<div data-testid="step-sidebar-current-step">{props.currentStep}</div>
			<button
				type="button"
				data-testid="step-sidebar-select-tissue"
				onClick={() => props.onStepSelect?.('tissueSelection')}
			>
				Open tissue selection
			</button>
		</div>
	),
}));

vi.mock('./TissueSelectionPanel', () => ({
  TissueSelectionPanel: (props: {
    selectedSpotIds: string[];
    onEditCommit?: (editArea: Array<{ x: number; y: number }>) => void;
  }) => (
    <div data-testid="tissue-selection-panel-mock">
      <div data-testid="tissue-panel-selected-count">
        Selected spots: {props.selectedSpotIds.length}
      </div>
      <button
        type="button"
        data-testid="tissue-panel-commit-manual-edit"
        onClick={() => props.onEditCommit?.([
          { x: 0.15, y: 0.15 },
          { x: 0.35, y: 0.15 },
          { x: 0.35, y: 0.35 },
          { x: 0.15, y: 0.35 },
        ])}
      >
        Commit manual tissue edit
      </button>
    </div>
  ),
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
  mockSearchParamsState.preprocessId = null;
  mockToast.mockReset();
  mockRouterPush.mockReset();
  mockDeletePreprocessProject.mockReset();
  mockGetPreprocessProject.mockReset();
  mockReadPreprocessProjectSummaries.mockReset();
  mockReadPreprocessProjectSummaries.mockResolvedValue([]);
  mockUpsertPreprocessProject.mockReset();
  mockUpsertPreprocessProject.mockResolvedValue(undefined);
  mockUpsertPreprocessProjectMetadata.mockReset();
  mockRunTissueAutoSelection.mockReset();
  mockLoadAllChipConfigManifests.mockReset();
  mockLoadAllChipConfigManifests.mockResolvedValue([]);
  mockLoadChipConfigData.mockReset();
  mockLoadChipConfigData.mockResolvedValue(null);
  mockExportPreprocessZip.mockReset();
  mockGetPreprocessZipExportReadiness.mockClear();
});

function WorkspaceHarness({
  initialProject = createProject(),
  onProjectChange,
  onProjectMutateCapture,
  onStepChange = vi.fn(),
}: {
  initialProject?: PreprocessProject;
  onProjectChange?: (project: PreprocessProject) => void;
  onProjectMutateCapture?: (mutation: CapturedProjectMutation) => void;
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
        onProjectMutate={(updater: (current: PreprocessProject) => PreprocessProject, persistOptions) => {
          setProject((current) => {
            const nextProject = updater(current);
            onProjectMutateCapture?.({ project: nextProject, persistOptions });
            return nextProject;
          });
        }}
        onProjectNameChange={vi.fn()}
        onStepChange={onStepChange}
        project={project}
      />
    </ChakraProvider>
  );
}

const { theme } = await import('../../../theme');
const { PreprocessWorkspace } = await import('./PreprocessWorkspace');
const { default: PreprocessPage } = await import('../page.client');

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

const createSuccessfulTissueAutoSelectionResult = () => ({
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
    thresholdMode: 'raw' as const,
    activationThreshold: 0.1,
    blockThreshold: 120,
    dbscanEps: 0.2,
    dbscanMinSamples: 2,
    minConnectedSpotCount: 2,
  },
  warning: null,
});

describe('PreprocessWorkspace tissue selection stale request protection', () => {
	beforeEach(() => {
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
      ...createSuccessfulTissueAutoSelectionResult(),
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
        ...createSuccessfulTissueAutoSelectionResult().params,
        activationThreshold: 0.25,
        blockThreshold: 120,
      },
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

  it('persists manual tissue canvas edits with tissue-aware debounced options', async () => {
    const user = userEvent.setup();
    const capturedMutations: CapturedProjectMutation[] = [];
    render(
      <WorkspaceHarness
        onProjectMutateCapture={(mutation) => {
          capturedMutations.push(mutation);
        }}
      />,
    );

    await user.click(screen.getByTestId('tissue-panel-commit-manual-edit'));

    await waitFor(() => {
      expect(capturedMutations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            persistOptions: { mode: 'tissue', strategy: 'debounced' },
          }),
        ]),
      );
    });

    const manualEditMutation = capturedMutations.find(
      (mutation) => mutation.persistOptions?.mode === 'tissue'
        && mutation.persistOptions.strategy === 'debounced',
    );
    expect(manualEditMutation?.project.tissueSelection.matrix?.values[0]).toBe(1);
    expect(manualEditMutation?.project.tissueSelection.selectedSpotIds).toEqual(['spot-a']);
  });

  it('persists completed auto-detection matrix writes with tissue-aware options', async () => {
    mockRunTissueAutoSelection.mockResolvedValue(createSuccessfulTissueAutoSelectionResult());
    const user = userEvent.setup();
    const capturedMutations: CapturedProjectMutation[] = [];
    render(
      <WorkspaceHarness
        onProjectMutateCapture={(mutation) => {
          capturedMutations.push(mutation);
        }}
      />,
    );

    await user.click(screen.getByTestId('tissue-run-auto'));

    await waitFor(() => {
      expect(mockRunTissueAutoSelection).toHaveBeenCalledTimes(1);
      expect(capturedMutations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            persistOptions: { mode: 'tissue' },
          }),
        ]),
      );
    });

    const matrixWriteMutation = capturedMutations.find(
      (mutation) => mutation.project.tissueSelection.status === 'complete',
    );
    expect(matrixWriteMutation?.project.tissueSelection.matrix?.values[0]).toBe(1);
    expect(matrixWriteMutation?.project.tissueSelection.selectedSpotIds).toEqual(['spot-a']);
    expect(matrixWriteMutation?.project.exportState.status).toBe('ready');
  });

  it('persists failed auto-detection status with tissue-aware options', async () => {
    mockRunTissueAutoSelection.mockRejectedValue(new Error('forced auto-detection failure'));
    const user = userEvent.setup();
    const capturedMutations: CapturedProjectMutation[] = [];
    render(
      <WorkspaceHarness
        onProjectMutateCapture={(mutation) => {
          capturedMutations.push(mutation);
        }}
      />,
    );

    await user.click(screen.getByTestId('tissue-run-auto'));

    await waitFor(() => {
      expect(mockRunTissueAutoSelection).toHaveBeenCalledTimes(1);
      expect(capturedMutations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            persistOptions: { mode: 'tissue' },
          }),
        ]),
      );
    });

    const failureMutation = capturedMutations.find(
      (mutation) => mutation.project.tissueSelection.error === 'forced auto-detection failure',
    );
    expect(failureMutation?.persistOptions).toEqual({ mode: 'tissue' });
    expect(failureMutation?.project.tissueSelection.status).toBe('error');
    expect(failureMutation?.project.exportState.status).toBe('stale');
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

describe('Preprocess page autosave failure handling', () => {
  beforeEach(() => {
    mockSearchParamsState.preprocessId = 'preprocess-project';
  });

  it('shows metadata persistence failures without advancing the saved snapshot', async () => {
    const storedProject = createProject();
    storedProject.currentStep = 'tissueSelection';
    const metadataFailure = new DOMException('Synthetic preprocess quota failure', 'QuotaExceededError');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetPreprocessProject.mockResolvedValue(storedProject);
    mockUpsertPreprocessProject
      .mockRejectedValueOnce(metadataFailure)
      .mockResolvedValueOnce(undefined);

		const user = userEvent.setup();
    render(
      <ChakraProvider theme={theme}>
        <PreprocessPage />
      </ChakraProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('autosave-status')).toHaveTextContent('saved');
    });

    await user.click(screen.getByRole('heading', { name: 'Preprocess project' }));
    await user.clear(screen.getByTestId('project-name-input'));
    await user.type(screen.getByTestId('project-name-input'), 'Unsaved metadata name');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockUpsertPreprocessProject).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('autosave-status')).toHaveTextContent('error');
    });

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Autosave failed',
      status: 'error',
    }));
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to autosave preprocess project',
      expect.objectContaining({ mode: 'full', projectId: storedProject.id }),
      metadataFailure,
    );
    expect(mockUpsertPreprocessProject.mock.calls[1][0]).toMatchObject({
      id: storedProject.id,
      name: storedProject.name,
    });
    consoleErrorSpy.mockRestore();
  });

  it('does not mark tissue autosave saved when the tissue payload write fails', async () => {
    const tissueFailure = new Error('forced tissue payload failure');
    const storedProject = createProject();
    storedProject.currentStep = 'tissueSelection';
    mockGetPreprocessProject.mockResolvedValue(storedProject);
    mockUpsertPreprocessProject.mockRejectedValue(tissueFailure);

		const user = userEvent.setup();
    render(
      <ChakraProvider theme={theme}>
        <PreprocessPage />
      </ChakraProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('autosave-status')).toHaveTextContent('saved');
    });
    await user.click(screen.getByTestId('step-sidebar-select-tissue'));
    await waitFor(() => {
      expect(screen.getByTestId('tissue-chip-size-select')).toBeInTheDocument();
    });

		await user.click(screen.getByTestId('tissue-panel-commit-manual-edit'));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 350));
		});

    await waitFor(() => {
      expect(mockUpsertPreprocessProject).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'preprocess-project' }),
        { mode: 'tissue' },
      );
      expect(screen.getByTestId('autosave-status')).toHaveTextContent('error');
    });

    expect(screen.getByTestId('autosave-status')).not.toHaveTextContent('saved');
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Autosave failed',
      status: 'error',
    }));
  });
});

describe('PreprocessWorkspace H&E focus bootstrap', () => {
  it('seeds the default manual H&E focus bounds', async () => {
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
      workingWidth: 100,
      workingHeight: 75,
      lastModified: 2,
      dataUrl: 'data:image/png;base64,BB==',
    };

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
    expect(latestProject.alignment.source).toBeNull();
    expect(latestProject.currentStep).toBe('heFocus');
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
