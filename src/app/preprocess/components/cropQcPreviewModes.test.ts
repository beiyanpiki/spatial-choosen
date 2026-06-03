import { describe, expect, it } from 'vitest';
import { getCropQcPreviewMode } from './cropQcPreviewModes';

describe('cropQc preview modes', () => {
  it('describes tissue align as checkerboard registration QC', () => {
    expect(getCropQcPreviewMode('tissueAlign')).toEqual({
      title: 'Checkerboard registration QC',
      description: 'Alternating eosin reference and registered H&E tiles for checking local alignment.',
      emptyState: 'Checkerboard QC appears after registered crop generation.',
    });
  });

  it('describes feature matches as landmark match QC', () => {
    expect(getCropQcPreviewMode('featureMatches')).toEqual({
      title: 'Landmark match QC',
      description: 'Side-by-side landmark montage linking the eosin reference crop to the registered H&E crop.',
      emptyState: 'Landmark match QC appears after registered crop generation.',
    });
  });
});
