export type CropQcPreviewModeKey = 'tissueAlign' | 'featureMatches';

export type CropQcPreviewMode = {
  title: string;
  description: string;
  emptyState: string;
};

const CROP_QC_PREVIEW_MODES: Record<CropQcPreviewModeKey, CropQcPreviewMode> = {
  tissueAlign: {
    title: 'Checkerboard registration QC',
    description: 'Alternating eosin reference and registered H&E tiles for checking local alignment.',
    emptyState: 'Checkerboard QC appears after registered crop generation.',
  },
  featureMatches: {
    title: 'Landmark match QC',
    description: 'Side-by-side landmark montage linking the eosin reference crop to the registered H&E crop.',
    emptyState: 'Landmark match QC appears after registered crop generation.',
  },
};

export const getCropQcPreviewMode = (mode: CropQcPreviewModeKey): CropQcPreviewMode => CROP_QC_PREVIEW_MODES[mode];
