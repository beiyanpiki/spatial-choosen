import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PreprocessProject, PreprocessPoint } from '@/types/built-in';

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
    onEditCommit?: (editArea: PreprocessPoint[]) => void;
    onSpotToggle?: (spotId: string) => void;
  }) => (
    <div data-testid="tissue-selection-panel-mock">
      <div data-testid="tissue-panel-selected-count">
        Number of Tissue Spots: {props.selectedSpotIds.length}
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
      <button
        type="button"
        data-testid="tissue-panel-toggle-spot"
        onClick={() => props.onSpotToggle?.('spot-a')}
      >
        Toggle spot
      </button>
      <button
        type="button"
        data-testid="tissue-panel-toggle-missing-spot"
        onClick={() => props.onSpotToggle?.('missing-spot')}
      >
        Toggle missing spot
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
    origin: { x: 0, y: 0 },
    rotationDegrees: 0,
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
    expect(panelSelectedCount).toHaveTextContent('Number of Tissue Spots: 0');

    await user.click(toggleButton);

    expect(screen.getByRole('button', { name: 'Show spot grid' })).toBeInTheDocument();
    expect(selectedCount).toHaveTextContent('Number of Tissue Spots: 0');
    expect(panelSelectedCount).toHaveTextContent('Number of Tissue Spots: 0');
  });

  it('persists manual tissue canvas edits with tissue-aware debounced options', async () => {
    const user = userEvent.setup();
    const capturedMutations: CapturedProjectMutation[] = [];
    render(
      <WorkspaceHarness
        onProjectMutateCapture={(mutation) => capturedMutations.push(mutation)}
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

  it('persists a single-click spot toggle with tissue-aware debounced options', async () => {
    const user = userEvent.setup();
    const capturedMutations: CapturedProjectMutation[] = [];
    render(
      <WorkspaceHarness
        onProjectMutateCapture={(mutation) => capturedMutations.push(mutation)}
      />,
    );

    await user.click(screen.getByTestId('tissue-panel-toggle-spot'));

    await waitFor(() => {
      expect(capturedMutations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            persistOptions: { mode: 'tissue', strategy: 'debounced' },
          }),
        ]),
      );
    });

    const toggleMutation = capturedMutations.find(
      (mutation) => mutation.persistOptions?.mode === 'tissue'
        && mutation.persistOptions.strategy === 'debounced',
    );
    expect(toggleMutation?.project.tissueSelection.matrix?.values[0]).toBe(1);
    expect(toggleMutation?.project.tissueSelection.selectedSpotIds).toEqual(['spot-a']);
  });

  it('leaves the project unchanged when toggling an unknown spot id', async () => {
    const user = userEvent.setup();
    const initialProject = createProject();
    const capturedMutations: CapturedProjectMutation[] = [];
    render(
      <WorkspaceHarness
        initialProject={initialProject}
        onProjectMutateCapture={(mutation) => capturedMutations.push(mutation)}
      />,
    );

    await user.click(screen.getByTestId('tissue-panel-toggle-missing-spot'));

    // The workspace still forwards the mutation request, but buildManualTissueSelectionState
    // returns the slice unchanged so the project object is identical.
    expect(capturedMutations).toHaveLength(1);
    expect(capturedMutations[0]?.project).toBe(initialProject);
  });

  it('inverts the current tissue selection with tissue-aware debounced options', async () => {
    const user = userEvent.setup();
    const capturedMutations: CapturedProjectMutation[] = [];
    render(
      <WorkspaceHarness
        onProjectMutateCapture={(mutation) => capturedMutations.push(mutation)}
      />,
    );

    await user.click(screen.getByTestId('tissue-invert-selection'));

    await waitFor(() => {
      expect(capturedMutations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            persistOptions: { mode: 'tissue', strategy: 'debounced' },
          }),
        ]),
      );
    });

    const invertMutation = capturedMutations.find(
      (mutation) => mutation.persistOptions?.mode === 'tissue'
        && mutation.persistOptions.strategy === 'debounced',
    );
    expect(invertMutation?.project.tissueSelection.matrix).not.toBeNull();
  });
});

describe('PreprocessWorkspace projected spot grid', () => {
  it('projects the chip grid onto the HE image when projectedSpots is null', async () => {
    mockLoadChipConfigData.mockResolvedValue({
      manifest: {
        id: '15um',
        label: '15um',
        gridRows: 2,
        gridCols: 2,
        spotDiameter: 10,
        spotGap: 4,
        barcodeTemplatePath: '/unused.csv',
        tissuePositionsPath: '/unused.csv',
      },
      templateEntries: [
        { barcode: 'spot-a', arrayRow: 1, arrayCol: 1 },
        { barcode: 'spot-b', arrayRow: 1, arrayCol: 2 },
        { barcode: 'spot-c', arrayRow: 2, arrayCol: 1 },
        { barcode: 'spot-d', arrayRow: 2, arrayCol: 2 },
      ],
    });

    const initialProject = createProject();
    initialProject.chipConfig.projectedSpots = null;

    let latestProject = initialProject;
    render(
      <WorkspaceHarness
        initialProject={initialProject}
        onProjectMutateCapture={(mutation) => {
          latestProject = mutation.project;
        }}
      />,
    );

    await waitFor(() => {
      expect(mockLoadChipConfigData).toHaveBeenCalledWith('15um');
      expect(latestProject.chipConfig.projectedSpots).not.toBeNull();
    });

    expect(latestProject.chipConfig.projectedSpots?.length).toBe(4);
    expect(latestProject.chipConfig.rows).toBe(2);
    expect(latestProject.chipConfig.columns).toBe(2);
    expect(latestProject.chipConfig.status).toBe('complete');
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

  it('does not mark tissue autosave saved when the tissue payload write fails', async () => {
    const tissueFailure = new Error('forced tissue payload failure');
    const storedProject = createStoredTissueProject();
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
    await waitFor(() => {
      expect(screen.getByTestId('tissue-invert-selection')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('tissue-invert-selection'));
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

  it('does not persist tissue metadata alone during pagehide', async () => {
    const storedProject = createStoredTissueProject();
    mockGetPreprocessProject.mockResolvedValue(storedProject);
    const user = userEvent.setup();
    render(
      <ChakraProvider theme={theme}>
        <PreprocessPage />
      </ChakraProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('tissue-invert-selection')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('tissue-invert-selection'));
    window.dispatchEvent(new Event('pagehide'));

    expect(mockUpsertPreprocessProjectMetadata).not.toHaveBeenCalled();
  });
});
