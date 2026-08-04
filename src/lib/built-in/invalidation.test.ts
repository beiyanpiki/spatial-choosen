import { describe, expect, it } from 'vitest';

import { buildEmptyPreprocessProject } from '@/app/built-in/projectState';

import {
  invalidateOnHeFocusChange,
  invalidateOnHeFocusChipBoundsChange,
  invalidateOnHeFocusCommit,
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
    focusedImageDataUrl: 'blob:focused-preview',
  };

  project.alignment = {
    ...project.alignment,
    status: 'complete',
    source: 'manual',
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

describe('preprocess invalidation contract', () => {
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

  it('changing he focus through the commit invalidator matches chip-bounds downstream invalidation', () => {
    const project = createDownstreamProject();

    const invalidatedOnCommit = invalidateOnHeFocusCommit(project);
    const invalidatedOnChipBounds = invalidateOnHeFocusChipBoundsChange(project);

    expect(invalidatedOnCommit.heFocus).toEqual(project.heFocus);
    expect(invalidatedOnCommit).toEqual(invalidatedOnChipBounds);
  });

  it('changing he focus through the generic invalidator keeps the commit-time breadth intact', () => {
    const project = createDownstreamProject();

    const invalidatedOnChange = invalidateOnHeFocusChange(project);
    const invalidatedOnCommit = invalidateOnHeFocusCommit(project);

    expect(invalidatedOnChange).toEqual(invalidatedOnCommit);
  });

});
