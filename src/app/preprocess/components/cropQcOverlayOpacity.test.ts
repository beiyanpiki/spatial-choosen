import { describe, expect, it } from 'vitest';
import {
  commitCropQcOverlayOpacityDraft,
  createCropQcOverlayOpacityState,
  syncCommittedCropQcOverlayOpacity,
  updateCropQcOverlayOpacityDraft,
} from './cropQcOverlayOpacity';

describe('cropQc overlay opacity state helpers', () => {
  it('starts from the committed opacity with no draft value', () => {
    expect(createCropQcOverlayOpacityState(0.5)).toEqual({
      committedOpacity: 0.5,
      draftOpacity: null,
      displayOpacity: 0.5,
    });
  });

  it('keeps the in-progress draft visible while syncing a newer committed opacity', () => {
    const draftState = updateCropQcOverlayOpacityDraft(
      createCropQcOverlayOpacityState(0.4),
      0.7,
    );

    expect(syncCommittedCropQcOverlayOpacity(draftState, 0.2)).toEqual({
      committedOpacity: 0.2,
      draftOpacity: 0.7,
      displayOpacity: 0.7,
    });
  });

  it('clears the draft once the new opacity is committed', () => {
    const draftState = updateCropQcOverlayOpacityDraft(
      createCropQcOverlayOpacityState(0.4),
      0.7,
    );

    expect(commitCropQcOverlayOpacityDraft(draftState, 0.7)).toEqual({
      committedOpacity: 0.7,
      draftOpacity: null,
      displayOpacity: 0.7,
    });
  });
});
