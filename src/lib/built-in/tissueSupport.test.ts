import { describe, expect, it } from 'vitest';

import type { PreprocessProject } from '@/types/built-in';
import { invalidateOnChipConfigChange } from './invalidation';
import { resolveTissueSelectionSupport } from './tissueSupport';

const createProject = (): PreprocessProject => ({
  id: 'project-1',
  name: 'Project 1',
  createdAt: '2026-04-14T00:00:00.000Z',
  updatedAt: '2026-04-14T00:00:00.000Z',
  workflowVersion: 2,
  storageVersion: 4,
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
    forceAccepted: false,
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
    projectedSpots: [],
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
      values: Array.from({ length: 64 * 64 }, () => 0 as const),
    },
    supportState: 'supported',
    unsupportedReason: 'stale support reason',
    paritySummary: {
      selectedCount: 1,
      selectedPercent: 0.01,
      maskCoverage: 0.01,
    },
    warning: null,
    selectedSpotIds: ['spot-a'],
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

describe('resolveTissueSelectionSupport', () => {
  it('supports 15um 96x96 chips', () => {
    expect(resolveTissueSelectionSupport({ chipType: '15um', rows: 96, columns: 96 })).toEqual({
      supportState: 'supported',
      unsupportedReason: null,
    });
  });

  it('supports 50um 64x64 chips', () => {
    expect(resolveTissueSelectionSupport({ chipType: '50um', rows: 64, columns: 64 })).toEqual({
      supportState: 'supported',
      unsupportedReason: null,
    });
  });

  it('rejects 50um 50x50 chips as unsupported', () => {
    expect(resolveTissueSelectionSupport({ chipType: '50um', rows: 50, columns: 50 })).toEqual({
      supportState: 'unsupported',
      unsupportedReason: '50um tissue auto-selection requires a 64x64 spot grid.',
    });
  });

  it('rejects unknown chip types with a reason', () => {
    const result = resolveTissueSelectionSupport({ chipType: '25um', rows: 96, columns: 96 });

    expect(result.supportState).toBe('unsupported');
    expect(result.unsupportedReason).not.toBeNull();
  });
});

describe('invalidateOnChipConfigChange', () => {
  it('clears stale tissue support metadata when chip config changes', () => {
    const result = invalidateOnChipConfigChange(createProject());

    expect(result.tissueSelection.supportState).toBe('unsupported');
    expect(result.tissueSelection.unsupportedReason).toBeNull();
    expect(result.tissueSelection.matrix).toBeNull();
    expect(result.tissueSelection.selectedSpotIds).toBeNull();
  });
});
