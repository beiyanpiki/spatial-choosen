/**
 * Custom region colours are session state: the palette starts from the five
 * built-ins on every page load.
 *
 * Earlier builds persisted them, so startup clears that key once to drop any
 * palette left behind by those versions.
 */
export const CUSTOM_COLORS_STORAGE_KEY = 'spatial-batch-custom-colors';

export function clearStoredRegionColors(): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(CUSTOM_COLORS_STORAGE_KEY);
  } catch {
    // Storage being unavailable has no effect on the session itself.
  }
}
