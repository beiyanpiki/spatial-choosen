export type CropQcPreviewModeKey = 'tissueAlign' | 'featureMatches';

export type CropQcPreviewMode = {
  title: string;
  description: string;
  emptyState: string;
};

const CROP_QC_PREVIEW_MODES: Record<CropQcPreviewModeKey, CropQcPreviewMode> = {
  tissueAlign: {
    title: 'Checkerboard View',
    description: 'Compare the NATA Align image and the registered H&E image in a checkerboard view to verify registration accuracy.',
    emptyState: 'Checkerboard QC appears after registered crop generation.',
  },
  featureMatches: {
    title: 'Landmark Pair Verification',
    description: 'Verify that each landmark pair connects the corresponding anatomical feature in both images.',
    emptyState: 'Landmark match QC appears after registered crop generation.',
  },
};

export const getCropQcPreviewMode = (mode: CropQcPreviewModeKey): CropQcPreviewMode => CROP_QC_PREVIEW_MODES[mode];
