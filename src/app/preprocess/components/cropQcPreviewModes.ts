export type CropQcPreviewModeKey = 'tissueAlign' | 'featureMatches';

export type CropQcPreviewMode = {
  title: string;
  description: string;
  emptyState: string;
};

const CROP_QC_PREVIEW_MODES: Record<CropQcPreviewModeKey, CropQcPreviewMode> = {
  tissueAlign: {
    title: 'Tissue align',
    description: 'Checkerboard alignment preview of the eosin crop and warped HE crop.',
    emptyState: 'Checkerboard alignment preview appears after crop generation.',
  },
  featureMatches: {
    title: 'Feature matches',
    description: 'Side-by-side landmark montage connecting the eosin crop to the warped HE crop. This is not the checkerboard alignment artifact.',
    emptyState: 'Feature-match landmark montage appears after crop generation.',
  },
};

export const getCropQcPreviewMode = (mode: CropQcPreviewModeKey): CropQcPreviewMode => CROP_QC_PREVIEW_MODES[mode];
