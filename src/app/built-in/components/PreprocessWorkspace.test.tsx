import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChipPlacement, PreprocessProject } from '@/types/built-in';

type CapturedPersistOptions = {
  mode?: string;
  strategy?: 'immediate' | 'debounced';
};

type CapturedProjectMutation = {
  project: PreprocessProject;
  persistOptions?: CapturedPersistOptions;
};

const mockToast = vi.fn();
const mockRouterPush = vi.fn();
const mockSearchParamsState: { preprocessId: string | null } = { preprocessId: null };
const mockDeletePreprocessProject = vi.fn();
const mockGetPreprocessProject = vi.fn();
const mockReadPreprocessProjectSummaries = vi.fn();
const mockUpsertPreprocessProject = vi.fn();
const mockUpsertPreprocessProjectMetadata = vi.fn();
const mockBuildSourceImage = vi.fn();
const mockLoadChipConfigData = vi.fn();
const mockLoadChipConfigManifest = vi.fn();

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
    get: (key: string) => (key === 'built_in_id' ? mockSearchParamsState.preprocessId : null),
  }),
}));

vi.mock('../../../lib/built-in/storage', () => ({
  deletePreprocessProject: (...args: unknown[]) => mockDeletePreprocessProject(...args),
  getPreprocessProject: (...args: unknown[]) => mockGetPreprocessProject(...args),
  readPreprocessProjectSummaries: (...args: unknown[]) => mockReadPreprocessProjectSummaries(...args),
  upsertPreprocessProject: (...args: unknown[]) => mockUpsertPreprocessProject(...args),
  upsertPreprocessProjectMetadata: (...args: unknown[]) => mockUpsertPreprocessProjectMetadata(...args),
}));

vi.mock('../../../lib/built-in/sourceImage', () => ({
  buildSourceImage: (...args: unknown[]) => mockBuildSourceImage(...args),
}));

vi.mock('../../../lib/built-in/chipConfigs', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/built-in/chipConfigs')>('../../../lib/built-in/chipConfigs');

  return {
    ...actual,
    loadChipConfigData: (...args: unknown[]) => mockLoadChipConfigData(...args),
    loadChipConfigManifest: (...args: unknown[]) => mockLoadChipConfigManifest(...args),
  };
});

const mockGetBuiltInZipExportReadiness = vi.fn();
const mockExportBuiltInZip = vi.fn();

vi.mock('@/lib/built-in/exportBundle', () => ({
  getBuiltInZipExportReadiness: (...args: unknown[]) => mockGetBuiltInZipExportReadiness(...args),
  exportBuiltInZip: (...args: unknown[]) => mockExportBuiltInZip(...args),
}));

let mockExportPanelProps: {
  isExporting?: boolean;
  canExport?: boolean;
  onDownload?: () => void;
} | null = null;

vi.mock('./ExportPanel', () => ({
  ExportPanel: (props: {
    isExporting?: boolean;
    canExport?: boolean;
    onDownload?: () => void;
  }) => {
    mockExportPanelProps = props;
    return (
      <div data-testid="export-panel-mock">
        <button type="button" data-testid="export-download-zip" onClick={props.onDownload}>
          Download
        </button>
      </div>
    );
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
    placement: ChipPlacement | null;
    onPlacementChange?: (placement: ChipPlacement) => void;
  }) => (
    <div data-testid="tissue-selection-panel-mock">
      <div data-testid="tissue-panel-selected-count">
        Active spots: {props.selectedSpotIds.length}
      </div>
      <button
        type="button"
        data-testid="tissue-panel-change-placement"
        onClick={() => props.onPlacementChange?.({ x: 50, y: 50, scale: 1 })}
      >
        Move placement
      </button>
    </div>
  ),
}));

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

const createProjectedSpot = (
  id: string,
  x: number,
  y: number,
  arrayRow: number,
  arrayCol: number,
) => ({
  id,
  barcode: id,
  arrayRow,
  arrayCol,
  x,
  y,
  width: 0.2,
  height: 0.2,
  diameterX: 0.2,
  diameterY: 0.2,
});

const createProject = (): PreprocessProject => ({
  id: 'preprocess-project',
  name: 'Preprocessing project',
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
    activeImage: 'he',
    images: {
      he: {
        id: 'he-source',
        kind: 'he',
        fileName: 'he.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        width: 200,
        height: 150,
        lastModified: 1,
        dataUrl: 'data:image/png;base64,AA==',
      },
    },
    oversizedImageWarning: null,
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
    spotDiameter: 25,
    origin: { x: 0, y: 0 },
    rotationDegrees: 0,
    placement: { x: 10, y: 10, scale: 1 },
    excludedRows: [],
    excludedColumns: [],
    barcodesByPosition: {},
    log2nGeneByPosition: {},
    projectedSpots: [
      createProjectedSpot('spot-a', 0.25, 0.25, 1, 1),
      createProjectedSpot('spot-b', 0.75, 0.25, 1, 2),
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
    lastExportedAt: null,
  },
});

beforeEach(() => {
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
  mockBuildSourceImage.mockReset();
  mockLoadChipConfigData.mockReset();
  mockLoadChipConfigData.mockResolvedValue(null);
  mockLoadChipConfigManifest.mockReset();
  mockGetBuiltInZipExportReadiness.mockReset();
  mockGetBuiltInZipExportReadiness.mockReturnValue({ canExport: false, reason: 'Not ready.' });
  mockExportBuiltInZip.mockReset();
  mockExportPanelProps = null;
  mockLoadChipConfigManifest.mockResolvedValue({
    id: '15um',
    label: '15um',
    gridRows: 96,
    gridCols: 96,
    spotDiameter: 10,
    spotGap: 1,
    barcodeTemplatePath: '/unused.csv',
    tissuePositionsPath: '/unused.csv',
  });
});

function WorkspaceHarness({
  initialProject = createProject(),
  onProjectMutateCapture,
  onStepChange = vi.fn(),
}: {
  initialProject?: PreprocessProject;
  onProjectMutateCapture?: (mutation: CapturedProjectMutation) => void;
  onStepChange?: (stepId: PreprocessProject['currentStep']) => void;
}) {
  const [project, setProject] = useState(initialProject);

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
const { normalizeProjectForWorkspace } = await import('../projectState');
const { PreprocessWorkspace } = await import('./PreprocessWorkspace');
const { default: PreprocessPage } = await import('../page.client');

describe('PreprocessWorkspace source step', () => {
  it('renders the revised source image copy and uploaders', () => {
    const initialProject = createProject();
    initialProject.currentStep = 'sourceAssets';
    initialProject.sourceAssets.images.he = null;

    render(<WorkspaceHarness initialProject={initialProject} />);

    expect(screen.getByText(
      'Upload the full-resolution H&E stained tissue image and a tissue activation CSV. The CSV provides the chip size and per-spot activation state. All processing on this page is saved locally.',
    )).toBeInTheDocument();
    expect(screen.getByText('H&E stained tissue image')).toBeInTheDocument();
    expect(screen.getByText('Tissue activation CSV')).toBeInTheDocument();
    expect(screen.getByText('Upload HE image')).toBeInTheDocument();
    expect(screen.getByText('No HE source image uploaded yet.')).toBeInTheDocument();
  });

  it('renders the empty-state copy before any HE image is uploaded', () => {
    const initialProject = createProject();
    initialProject.currentStep = 'sourceAssets';
    initialProject.sourceAssets.images.he = null;

    render(<WorkspaceHarness initialProject={initialProject} />);

    expect(screen.getByText('No HE source image uploaded yet.')).toBeInTheDocument();
    expect(screen.getByText('No tissue activation CSV imported yet.')).toBeInTheDocument();
  });
});

describe('PreprocessWorkspace tissue selection', () => {
  it('toggles spot visibility locally without changing the selected spot count', async () => {
    const user = userEvent.setup();
    render(<WorkspaceHarness />);

    const selectedCount = screen.getByTestId('tissue-selected-count');
    const panelSelectedCount = screen.getByTestId('tissue-panel-selected-count');
    const toggleButton = screen.getByRole('button', { name: 'Hide spot grid' });

    expect(selectedCount).toHaveTextContent('Number of Tissue Spots: 0');
    expect(panelSelectedCount).toHaveTextContent('Active spots: 0');

    await user.click(toggleButton);

    expect(screen.getByRole('button', { name: 'Show spot grid' })).toBeInTheDocument();
    expect(selectedCount).toHaveTextContent('Number of Tissue Spots: 0');
    expect(panelSelectedCount).toHaveTextContent('Active spots: 0');
  });

  it('persists chipConfig.placement via onPlacementChange and re-centers on reset', async () => {
    const user = userEvent.setup();
    const capturedMutations: CapturedProjectMutation[] = [];
    render(
      <WorkspaceHarness
        onProjectMutateCapture={(mutation) => capturedMutations.push(mutation)}
      />,
    );

    await user.click(screen.getByTestId('tissue-panel-change-placement'));

    const placementMutation = capturedMutations.find(
      (mutation) => mutation.project.chipConfig.placement?.x === 50
        && mutation.project.chipConfig.placement?.y === 50,
    );
    expect(placementMutation).toBeDefined();
    expect(placementMutation?.project.chipConfig.placement).toEqual({ x: 50, y: 50, scale: 1 });
    // Placement updates are persisted with the metadata debounced strategy.
    expect(placementMutation?.persistOptions).toEqual({ mode: 'metadata', strategy: 'debounced' });

    // Reset re-centers the placement over the 200x150 HE image: the full grid
    // (96*25 + 97*1 = 2497 chip units) fits min(200,150)*0.9 = 135 px ->
    // scale = 135/2497, centered.
    const expectedResetScale = 135 / (96 * 25 + 97 * 1);
    await user.click(screen.getByTestId('tissue-reset-placement'));

    await waitFor(() => {
      const resetMutation = capturedMutations.find(
        (mutation) => mutation.project.chipConfig.placement?.scale === expectedResetScale,
      );
      expect(resetMutation).toBeDefined();
    });

    const resetMutation = capturedMutations.find(
      (mutation) => mutation.project.chipConfig.placement?.scale === expectedResetScale,
    );
    expect(resetMutation?.project.chipConfig.placement).toEqual({
      scale: expectedResetScale,
      x: (200 - 135) / 2,
      y: (150 - 135) / 2,
    });
  });
});

const createStoredTissueProject = () => {
  const project = createProject();
  const storedProject = normalizeProjectForWorkspace(project);
  storedProject.currentStep = 'tissueSelection';
  storedProject.chipConfig = project.chipConfig;
  storedProject.tissueSelection = project.tissueSelection;
  return storedProject;
};

describe('Preprocess page autosave handling', () => {
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

    await user.click(screen.getByRole('heading', { name: 'Preprocessing project' }));
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
      'Failed to autosave preprocessing project',
      expect.objectContaining({ mode: 'full', projectId: storedProject.id }),
      metadataFailure,
    );
    expect(mockUpsertPreprocessProject.mock.calls[1][0]).toMatchObject({
      id: storedProject.id,
      name: storedProject.name,
    });
    consoleErrorSpy.mockRestore();
  });

  it('surfaces debounced metadata persistence failures from a placement change', async () => {
    const placementFailure = new Error('forced metadata payload failure');
    const storedProject = createStoredTissueProject();
    mockGetPreprocessProject.mockResolvedValue(storedProject);
    mockUpsertPreprocessProject.mockRejectedValue(placementFailure);

    const user = userEvent.setup();
    render(
      <ChakraProvider theme={theme}>
        <PreprocessPage />
      </ChakraProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('autosave-status')).toHaveTextContent('saved');
    });
    await waitFor(() => {
      expect(screen.getByTestId('tissue-panel-change-placement')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('tissue-panel-change-placement'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    await waitFor(() => {
      expect(mockUpsertPreprocessProject).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'preprocess-project' }),
        { mode: 'metadata' },
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

describe('PreprocessWorkspace export step', () => {
  it('renders the export panel on the export step', () => {
    const initialProject = createProject();
    initialProject.currentStep = 'exportState';
    mockGetBuiltInZipExportReadiness.mockReturnValue({ canExport: true, data: {} });

    render(<WorkspaceHarness initialProject={initialProject} />);

    expect(screen.getByTestId('export-panel-mock')).toBeInTheDocument();
    expect(screen.getByText('Download the tissue image pyramid, scalefactors, spot positions, and tissue matrix for downstream analysis.')).toBeInTheDocument();
    expect(mockExportPanelProps?.canExport).toBe(true);
  });

  it('shows a warning toast and skips export when readiness blocks the download', async () => {
    const user = userEvent.setup();
    const initialProject = createProject();
    initialProject.currentStep = 'exportState';
    mockGetBuiltInZipExportReadiness.mockReturnValue({ canExport: false, reason: 'Not ready.' });

    render(<WorkspaceHarness initialProject={initialProject} />);

    await user.click(screen.getByTestId('export-download-zip'));

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Export blocked',
      description: 'Not ready.',
      status: 'warning',
    }));
    expect(mockExportBuiltInZip).not.toHaveBeenCalled();
  });

  it('downloads the zip and marks exportState complete on success', async () => {
    const user = userEvent.setup();
    const capturedMutations: CapturedProjectMutation[] = [];
    const initialProject = createProject();
    initialProject.currentStep = 'exportState';
    mockGetBuiltInZipExportReadiness.mockReturnValue({ canExport: true, data: {} });
    mockExportBuiltInZip.mockResolvedValue({
      fileName: 'Preprocessing project-preprocess.zip',
      blob: new Blob(['zip-bytes'], { type: 'application/zip' }),
    });

    const createObjectURL = vi.fn(() => 'blob:export-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(
      <WorkspaceHarness
        initialProject={initialProject}
        onProjectMutateCapture={(mutation) => capturedMutations.push(mutation)}
      />,
    );

    await user.click(screen.getByTestId('export-download-zip'));

    await waitFor(() => {
      expect(mockExportBuiltInZip).toHaveBeenCalledWith({
        project: expect.objectContaining({ id: initialProject.id }),
        projectedSpots: expect.any(Array),
      });
    });
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export-url');

    await waitFor(() => {
      const exportMutation = capturedMutations.find(
        (mutation) => mutation.project.exportState.status === 'complete',
      );
      expect(exportMutation).toBeDefined();
      expect(typeof exportMutation?.project.exportState.lastExportedAt).toBe('string');
    });

    anchorClick.mockRestore();
    vi.unstubAllGlobals();
  });

  it('surfaces export failures and marks exportState error', async () => {
    const user = userEvent.setup();
    const capturedMutations: CapturedProjectMutation[] = [];
    const initialProject = createProject();
    initialProject.currentStep = 'exportState';
    mockGetBuiltInZipExportReadiness.mockReturnValue({ canExport: true, data: {} });
    mockExportBuiltInZip.mockRejectedValue(new Error('Canvas export failed'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <WorkspaceHarness
        initialProject={initialProject}
        onProjectMutateCapture={(mutation) => capturedMutations.push(mutation)}
      />,
    );

    await user.click(screen.getByTestId('export-download-zip'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Export failed',
        description: 'Canvas export failed',
        status: 'error',
      }));
    });
    await waitFor(() => {
      const errorMutation = capturedMutations.find(
        (mutation) => mutation.project.exportState.status === 'error',
      );
      expect(errorMutation).toBeDefined();
      expect(errorMutation?.project.exportState.error).toBe('Canvas export failed');
    });

    consoleErrorSpy.mockRestore();
  });
});
