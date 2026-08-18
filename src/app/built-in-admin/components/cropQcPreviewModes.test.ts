import { describe, expect, it } from 'vitest';
import { getCropQcPreviewMode } from './cropQcPreviewModes';

describe('cropQc preview modes', () => {
  it('describes tissue align as the checkerboard view', () => {
    expect(getCropQcPreviewMode('tissueAlign')).toEqual({
      title: 'Checkerboard View',
      description: 'Compare the NATA Align image and the registered H&E image in a checkerboard view to verify registration accuracy.',
      emptyState: 'Checkerboard QC appears after registered crop generation.',
    });
  });

  it('describes feature matches as landmark pair verification', () => {
    expect(getCropQcPreviewMode('featureMatches')).toEqual({
      title: 'Landmark Pair Verification',
      description: 'Verify that each landmark pair connects the corresponding anatomical feature in both images.',
      emptyState: 'Landmark match QC appears after registered crop generation.',
    });
  });
});
