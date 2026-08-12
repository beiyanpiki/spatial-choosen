export type CropQcOverlayOpacityState = {
  committedOpacity: number;
  draftOpacity: number | null;
  displayOpacity: number;
};

const buildCropQcOverlayOpacityState = (
  committedOpacity: number,
  draftOpacity: number | null,
): CropQcOverlayOpacityState => ({
  committedOpacity,
  draftOpacity,
  displayOpacity: draftOpacity ?? committedOpacity,
});

export const createCropQcOverlayOpacityState = (
  committedOpacity: number,
): CropQcOverlayOpacityState => buildCropQcOverlayOpacityState(committedOpacity, null);

export const syncCommittedCropQcOverlayOpacity = (
  current: CropQcOverlayOpacityState,
  committedOpacity: number,
): CropQcOverlayOpacityState => {
  if (current.committedOpacity === committedOpacity) {
    return current;
  }

  return buildCropQcOverlayOpacityState(committedOpacity, current.draftOpacity);
};

export const updateCropQcOverlayOpacityDraft = (
  current: CropQcOverlayOpacityState,
  draftOpacity: number,
): CropQcOverlayOpacityState => buildCropQcOverlayOpacityState(current.committedOpacity, draftOpacity);

export const commitCropQcOverlayOpacityDraft = (
  current: CropQcOverlayOpacityState,
  committedOpacity: number,
): CropQcOverlayOpacityState => {
  if (current.committedOpacity === committedOpacity && current.draftOpacity === null) {
    return current;
  }

  return buildCropQcOverlayOpacityState(committedOpacity, null);
};
