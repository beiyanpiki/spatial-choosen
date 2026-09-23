import { beforeEach, describe, expect, it } from 'vitest';

import { createRegionColor } from './regionColors';
import { CUSTOM_COLORS_STORAGE_KEY, clearStoredRegionColors } from './regionColorStore';

// `.test.tsx` on purpose: vitest only runs the jsdom project for these, and the
// store needs `window.localStorage`.
describe('region colour storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('drops a palette left behind by an older build', () => {
    window.localStorage.setItem(
      CUSTOM_COLORS_STORAGE_KEY,
      JSON.stringify([createRegionColor(6, '#3366ff')]),
    );

    clearStoredRegionColors();

    expect(window.localStorage.getItem(CUSTOM_COLORS_STORAGE_KEY)).toBeNull();
  });

  it('is harmless when there is nothing stored', () => {
    expect(() => clearStoredRegionColors()).not.toThrow();
    expect(window.localStorage.getItem(CUSTOM_COLORS_STORAGE_KEY)).toBeNull();
  });

  it('leaves unrelated keys alone', () => {
    window.localStorage.setItem('spatial-preprocess-projects', '[]');
    window.localStorage.setItem(CUSTOM_COLORS_STORAGE_KEY, '[]');

    clearStoredRegionColors();

    expect(window.localStorage.getItem('spatial-preprocess-projects')).toBe('[]');
  });
});
