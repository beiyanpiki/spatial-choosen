import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { theme } from '../../../theme';
import type { PreprocessProject, PreprocessStepStatus } from '@/types/built-in-admin';
import { StepSidebar } from './StepSidebar';

const createProjectedSpot = (id: string) => ({
  id,
  barcode: id,
  arrayRow: 1,
  arrayCol: 1,
  x: 0.5,
  y: 0.5,
  width: 0.08,
  height: 0.08,
  diameterX: 0.08,
  diameterY: 0.08,
});

const createProject = (
  alignmentStatus: PreprocessStepStatus,
  alignmentAccepted = false,
  forceAccepted = false,
): PreprocessProject => ({
  id: 'project-step-sidebar',
  name: 'Step sidebar project',
  createdAt: '2026-04-15T00:00:00.000Z',
  updatedAt: '2026-04-15T00:00:00.000Z',
  workflowVersion: 3,
  storageVersion: 5,
  currentStep: 'alignment',
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
    status: alignmentStatus,
    isStale: false,
    updatedAt: null,
    error: alignmentStatus === 'error' ? 'alignment error' : null,
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
      accepted: alignmentAccepted,
    },
    solveAccepted: alignmentAccepted,
    forceAccepted,
    failureReason: alignmentStatus === 'error' ? 'solve-failed' : null,
    transform: null,
    previewDataUrl: null,
  },
  cropQc: {
    status: 'ready',
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
    checkerboardPreview: {
      dataUrl: null,
    },
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
    spotDiameter: null,
    excludedRows: [],
    removeExcludedRowsFromExport: false,
    excludedColumns: [],
    barcodesByPosition: {},
    log2nGeneByPosition: {},
    csvFileName: null,
    projectedSpots: [createProjectedSpot('spot-a')],
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

const renderSidebar = (project: PreprocessProject) =>
  render(
    <ChakraProvider theme={theme}>
      <StepSidebar currentStep='alignment' onStepSelect={vi.fn()} project={project} />
    </ChakraProvider>,
  );

describe('StepSidebar', () => {
  it('renders the revised seven-step workflow copy', () => {
    renderSidebar(createProject('complete', true));

    expect(screen.getByText('Complete each step in sequence to generate the preprocessing results required for downstream analysis.')).toBeInTheDocument();
    expect(screen.getByText('Upload Images')).toBeInTheDocument();
    expect(screen.getByText('Upload the NATA Align image, the corresponding H&E image, and the tissue activation CSV.')).toBeInTheDocument();
    expect(screen.getByText('Define Capture Area')).toBeInTheDocument();
    expect(screen.getByText('Align the chip grid heatmap with the tissue on the NATA Align image.')).toBeInTheDocument();
    expect(screen.getByText('H&E ROI Alignment')).toBeInTheDocument();
    expect(screen.getByText('Select the corresponding ROI in the H&E image.')).toBeInTheDocument();
    expect(screen.getByText('Image Registration')).toBeInTheDocument();
    expect(screen.getByText('Create landmark pairs and register the images.')).toBeInTheDocument();
    expect(screen.getByText('Registration Review')).toBeInTheDocument();
    expect(screen.getByText('Review the registration results using Checkerboard, Landmark Pair, and Overlay views.')).toBeInTheDocument();
    expect(screen.getByText('Tissue Spot Selection')).toBeInTheDocument();
    expect(screen.getByText('Automatically detect and manually refine tissue spots.')).toBeInTheDocument();
    expect(screen.getByText('Export Preprocessing Package')).toBeInTheDocument();
    expect(screen.getByText('Download the preprocessing package for downstream analysis in NATA Insight Bioinformatics Software.')).toBeInTheDocument();
  });

  it('keeps Crop disabled when alignment status is not complete', () => {
    const { rerender } = renderSidebar(createProject('ready'));

    expect(screen.getByTestId('preprocess-step-crop')).toBeDisabled();

    for (const alignmentStatus of ['error'] as const) {
      rerender(
        <ChakraProvider theme={theme}>
          <StepSidebar
            currentStep='alignment'
            onStepSelect={vi.fn()}
            project={createProject(alignmentStatus)}
          />
        </ChakraProvider>,
      );

      expect(screen.getByTestId('preprocess-step-crop')).toBeDisabled();
    }
  });

  it('keeps Crop disabled when alignment status is complete but strict acceptance is false', () => {
    renderSidebar(createProject('complete'));

    expect(screen.getByTestId('preprocess-step-crop')).toBeDisabled();
  });

  it('enables Crop when alignment status is complete and strict acceptance is true', () => {
    renderSidebar(createProject('complete', true));

    expect(screen.getByTestId('preprocess-step-crop')).toBeEnabled();
  });

  it('enables Crop when alignment is force-accepted even though strict acceptance is false', () => {
    renderSidebar(createProject('complete', false, true));

    expect(screen.getByTestId('preprocess-step-crop')).toBeEnabled();
  });
});
