import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { theme } from '../../../theme';
import type { PreprocessProject } from '@/types/built-in';
import { StepSidebar } from './StepSidebar';

const createProject = (
  overrides: Partial<PreprocessProject> = {},
): PreprocessProject => ({
  id: 'project-step-sidebar',
  name: 'Step sidebar project',
  createdAt: '2026-04-15T00:00:00.000Z',
  updatedAt: '2026-04-15T00:00:00.000Z',
  workflowVersion: 3,
  storageVersion: 5,
  currentStep: 'sourceAssets',
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
        width: 100,
        height: 100,
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
    placement: null,
    excludedRows: [],
    excludedColumns: [],
    barcodesByPosition: {},
    log2nGeneByPosition: {},
    projectedSpots: [
      {
        id: 'spot-a',
        barcode: 'spot-a',
        arrayRow: 1,
        arrayCol: 1,
        x: 0.5,
        y: 0.5,
        width: 0.08,
        height: 0.08,
        diameterX: 0.08,
        diameterY: 0.08,
      },
    ],
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
    lastExportedAt: null,
  },
  ...overrides,
});

const renderSidebar = (project: PreprocessProject, currentStep: PreprocessProject['currentStep'] = 'sourceAssets') =>
  render(
    <ChakraProvider theme={theme}>
      <StepSidebar currentStep={currentStep} onStepSelect={vi.fn()} project={project} />
    </ChakraProvider>,
  );

describe('StepSidebar', () => {
  it('renders the three-step workflow copy', () => {
    renderSidebar(createProject());

    expect(screen.getByText('Complete each step in sequence to generate the preprocessing results required for downstream analysis.')).toBeInTheDocument();
    expect(screen.getByText('HE Image & CSV')).toBeInTheDocument();
    expect(screen.getByText('Upload the H&E image and a tissue activation CSV.')).toBeInTheDocument();
    expect(screen.getByText('Tissue Spot Selection')).toBeInTheDocument();
    expect(screen.getByText('Refine the tissue spot matrix over the H&E image.')).toBeInTheDocument();
    expect(screen.getByText('Export Package')).toBeInTheDocument();
    expect(screen.getByText('Download the tissue export ZIP for downstream analysis.')).toBeInTheDocument();

    // Removed steps no longer appear in the rail.
    expect(screen.queryByTestId('preprocess-step-crop')).not.toBeInTheDocument();
    expect(screen.queryByTestId('preprocess-step-align')).not.toBeInTheDocument();
  });

  it('keeps the export step disabled until tissue selection completes', () => {
    renderSidebar(createProject());

    expect(screen.getByTestId('preprocess-step-export')).toBeDisabled();
  });

  it('enables the export step once tissue selection is complete', () => {
    const completed = createProject();
    completed.tissueSelection = {
      ...completed.tissueSelection,
      status: 'complete',
    };
    renderSidebar(completed);

    expect(screen.getByTestId('preprocess-step-export')).toBeEnabled();
  });

  it('keeps tissue selection disabled when the HE image is missing', () => {
    const withoutHe = createProject();
    withoutHe.sourceAssets.images.he = null;
    renderSidebar(withoutHe);

    expect(screen.getByTestId('preprocess-step-tissue')).toBeDisabled();
  });

  it('keeps tissue selection disabled when the chip type is missing', () => {
    const withoutChipType = createProject();
    withoutChipType.chipConfig.chipType = null;
    renderSidebar(withoutChipType);

    expect(screen.getByTestId('preprocess-step-tissue')).toBeDisabled();
  });

  it('enables tissue selection once the HE image and chip type are present', () => {
    renderSidebar(createProject());

    expect(screen.getByTestId('preprocess-step-source-assets')).toBeEnabled();
    expect(screen.getByTestId('preprocess-step-tissue')).toBeEnabled();
  });
});
