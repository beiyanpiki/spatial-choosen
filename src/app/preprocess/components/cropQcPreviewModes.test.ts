import { describe, expect, it } from 'vitest';
import { getCropQcPreviewMode } from './cropQcPreviewModes';

describe('cropQc preview modes', () => {
  it('describes tissue align as a checkerboard alignment preview', () => {
    expect(getCropQcPreviewMode('tissueAlign')).toEqual({
      title: 'Tissue align',
      description: 'Checkerboard alignment preview of the eosin crop and warped HE crop.',
      emptyState: 'Checkerboard alignment preview appears after crop generation.',
    });
  });

  it('describes feature matches as a side-by-side landmark montage', () => {
    expect(getCropQcPreviewMode('featureMatches')).toEqual({
      title: 'Feature matches',
      description: 'Side-by-side landmark montage connecting the eosin crop to the warped HE crop. This is not the checkerboard alignment artifact.',
      emptyState: 'Feature-match landmark montage appears after crop generation.',
    });
  });
});
