import { describe, expect, it } from 'vitest';

import { buildEmptyPreprocessProject } from '@/app/preprocess/projectState';

import {
  invalidateOnAcceptedAlignmentProvenanceChange,
  invalidateOnHeFocusAutoProposalChange,
  invalidateOnHeFocusChipBoundsChange,
  invalidateOnLocalizationChange,
} from './invalidation';

const createCanonicalCropAssets = () => ({
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
});

const createDownstreamProject = () => {
  const project = buildEmptyPreprocessProject('Downstream invalidation project');

  project.localization = {
    ...project.localization,
    status: 'complete',
    chipBounds: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 },
  };

  project.heFocus = {
    ...project.heFocus,
    status: 'complete',
    chipBounds: { x: 0.25, y: 0.2, width: 0.35, height: 0.35 },
    autoProposal: {
      status: 'accepted',
      method: 'mask-ecc-v1',
      coarseBounds: { x: 0.2, y: 0.15, width: 0.45, height: 0.45 },
      refinedBounds: { x: 0.25, y: 0.2, width: 0.35, height: 0.35 },
      refinedQuad: [
        { x: 0.25, y: 0.2 },
        { x: 0.6, y: 0.2 },
        { x: 0.6, y: 0.55 },
        { x: 0.25, y: 0.55 },
      ],
      rotationDegrees: 1.5,
      eccCorrelation: 0.91,
      failureReason: null,
    },
    focusedImageDataUrl: 'blob:focused-preview',
  };

  project.alignment = {
    ...project.alignment,
    status: 'complete',
    source: 'auto',
    affineMatrix: [1, 0, 0, 0, 1, 0],
    reprojectionRmse: 0.25,
    inlierRatio: 0.9,
    ransacReprojThreshold: 3,
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
      rotationDegrees: 0,
      scaleX: 1,
      scaleY: 1,
      isUniformScale: true,
    },
    previewDataUrl: 'blob:alignment-preview',
  };

  project.cropQc = {
    ...project.cropQc,
    status: 'complete',
    cropRect: { x: 10, y: 12, width: 80, height: 76 },
    cropWidth: 80,
    cropHeight: 76,
    cropAssets: createCanonicalCropAssets(),
    tissue_hires_scalef: 1,
    tissue_lowres_scalef: 0.25,
    spot_diameter_fullres: 10,
    fiducial_diameter_fullres: 14,
    eosinPreviewDataUrl: 'blob:eosin-crop-preview',
    previewDataUrl: 'blob:he-crop-preview',
    checkerboardPreviewDataUrl: 'blob:checkerboard-preview',
    checkerboardPreview: {
      dataUrl: 'blob:checkerboard-preview',
    },
    featureMatchesPreviewDataUrl: 'blob:feature-matches-preview',
    featureMatchesPreview: {
      dataUrl: 'blob:feature-matches-preview',
    },
    qcAccepted: true,
    issues: [{ id: 'issue-a', level: 'info', code: 'aligned', message: 'Aligned crop ready.' }],
  };

  project.chipConfig = {
    ...project.chipConfig,
    status: 'complete',
    chipType: '15um',
    rows: 2,
    columns: 2,
    pitchX: 1,
    pitchY: 1,
    origin: { x: 0, y: 0 },
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
    ],
  };

  project.tissueSelection = {
    ...project.tissueSelection,
    status: 'complete',
    autoSelectedSpotIds: ['spot-a'],
    matrix: {
      rows: 2,
      columns: 2,
      values: [1, 0, 0, 0],
    },
    supportState: 'supported',
    unsupportedReason: null,
    paritySummary: {
      selectedCount: 1,
      selectedPercent: 25,
      maskCoverage: 25,
    },
    selectedSpotIds: ['spot-a'],
  };

  project.exportState = {
    ...project.exportState,
    status: 'complete',
    lastExportedAt: '2026-04-16T00:00:00.000Z',
    artifacts: [
      {
        id: 'artifact-a',
        kind: 'zip',
        fileName: 'project.zip',
        mimeType: 'application/zip',
        createdAt: '2026-04-16T00:00:00.000Z',
      },
    ],
  };

  return project;
};

describe('preprocess invalidation auto-localization contract', () => {
  it('ignores runtime preview blobs in canonical preprocess state', () => {
    const project = buildEmptyPreprocessProject('Invalidation project');
    project.heFocus = {
      ...project.heFocus,
      status: 'complete',
      autoProposal: {
        status: 'fallback',
        method: 'mask-ecc-v1',
        coarseBounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        refinedBounds: null,
        refinedQuad: null,
        rotationDegrees: null,
        eccCorrelation: null,
        failureReason: 'ecc-failed',
      },
      focusedImageDataUrl: 'blob:focused-preview',
    };

    const invalidated = invalidateOnLocalizationChange(project);

    expect(invalidated.heFocus.focusedImageDataUrl).toBeNull();
    expect(invalidated.heFocus.autoProposal).toEqual(project.heFocus.autoProposal);
  });

  it('changing he focus chip bounds clears the full downstream dependency chain', () => {
    const project = createDownstreamProject();

    const invalidated = invalidateOnHeFocusChipBoundsChange(project);

    expect(invalidated.alignment.source).toBeNull();
    expect(invalidated.alignment.transform).toBeNull();
    expect(invalidated.alignment.previewDataUrl).toBeNull();
    expect(invalidated.alignment.solveAccepted).toBe(false);
    expect(invalidated.cropQc.status).toBe('stale');
    expect(invalidated.chipConfig.status).toBe('stale');
    expect(invalidated.chipConfig.projectedSpots).toBeNull();
    expect(invalidated.tissueSelection.status).toBe('stale');
    expect(invalidated.exportState.status).toBe('stale');
    expect(invalidated.localization).toEqual(project.localization);
  });

  it('changing he focus auto proposal clears alignment and crop qc only', () => {
    const project = createDownstreamProject();

    const invalidated = invalidateOnHeFocusAutoProposalChange(project);

    expect(invalidated.alignment.status).toBe('stale');
    expect(invalidated.alignment.source).toBeNull();
    expect(invalidated.cropQc.status).toBe('stale');
    expect(invalidated.cropQc.qcAccepted).toBe(false);
    expect(invalidated.localization).toEqual(project.localization);
    expect(invalidated.chipConfig).toEqual(project.chipConfig);
    expect(invalidated.tissueSelection).toEqual(project.tissueSelection);
    expect(invalidated.exportState).toEqual(project.exportState);
  });

  it('changing accepted alignment provenance clears crop qc only', () => {
    const project = createDownstreamProject();
    project.alignment = {
      ...project.alignment,
      source: 'manual',
    };

    const invalidated = invalidateOnAcceptedAlignmentProvenanceChange(project);

    expect(invalidated.alignment).toEqual(project.alignment);
    expect(invalidated.cropQc.status).toBe('stale');
    expect(invalidated.cropQc.qcAccepted).toBe(false);
    expect(invalidated.localization).toEqual(project.localization);
    expect(invalidated.heFocus).toEqual(project.heFocus);
    expect(invalidated.chipConfig).toEqual(project.chipConfig);
    expect(invalidated.tissueSelection).toEqual(project.tissueSelection);
    expect(invalidated.exportState).toEqual(project.exportState);
  });
});
