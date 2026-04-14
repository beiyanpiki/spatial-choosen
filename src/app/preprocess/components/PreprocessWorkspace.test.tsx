import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

import type { PreprocessProject } from '@/types/preprocess';

vi.mock('../../../lib/preprocess/alignment', () => ({
  normalizeAlignmentSlice: (value: unknown) => value,
}));

vi.mock('../../../lib/preprocess/cropQc', () => ({
  runCropQc: vi.fn(),
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
  loadOpenCv: vi.fn(),
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
  AlignmentPanel: () => null,
}));

vi.mock('./CanvasStage', () => ({
  CanvasStage: () => null,
}));

vi.mock('./CropQcPanel', () => ({
  CropQcPanel: () => null,
}));

vi.mock('./ExportPanel', () => ({
  ExportPanel: () => null,
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

function WorkspaceHarness() {
  const [project, setProject] = useState(createProject());

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
        onStepChange={vi.fn()}
        project={project}
      />
    </ChakraProvider>
  );
}

const { theme } = await import('../../../theme');
const { PreprocessWorkspace } = await import('./PreprocessWorkspace');

const createProject = (): PreprocessProject => ({
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
        thumbnailBlob: null,
        thumbnailObjectUrl: null,
        thumbnailDataUrl: null,
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
    referenceLandmarks: [],
    movingLandmarks: [],
    affineTransform: null,
    checkerboardDataUrl: null,
    featureMatchesPreviewDataUrl: null,
    featureMatchesPreview: null,
    metrics: null,
  },
  cropQc: {
    status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    cropRect: null,
    cropWidth: 100,
    cropHeight: 100,
    tissue_hires_scalef: 1,
    tissue_lowres_scalef: 1,
    fiducial_diameter_fullres: 10,
    spot_diameter_fullres: 10,
    cropAssets: {
      eosin: {
        hires: {
          dataUrl: 'data:image/png;base64,AA==',
          width: 100,
          height: 100,
        },
        lowres: {
          dataUrl: 'data:image/png;base64,AA==',
          width: 100,
          height: 100,
        },
      },
      he: null,
    },
    checkerboardPreview: null,
    overlayOpacity: 0.5,
    qcAccepted: true,
    issues: [],
    checkerboardTileSize: 64,
    featureMatchesPreview: null,
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

describe('PreprocessWorkspace tissue selection stale request protection', () => {
  beforeEach(() => {
    mockRunTissueAutoSelection.mockReset();
    mockLoadAllChipConfigManifests.mockReset();
    mockLoadChipConfigData.mockReset();
    mockLoadAllChipConfigManifests.mockResolvedValue([]);
    mockLoadChipConfigData.mockResolvedValue(null);
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

    expect(screen.getByTestId('tissue-threshold-mode-select')).not.toBeDisabled();
    await user.selectOptions(screen.getByTestId('tissue-threshold-mode-select'), 'gray-max');
    expect(screen.getByTestId('tissue-threshold-mode-select')).toHaveValue('gray-max');

    await user.click(screen.getByTestId('tissue-run-auto'));

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
  });
});
