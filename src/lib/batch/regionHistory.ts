import { cloneRegions } from './regions';
import type { BatchRegion } from '@/types/batch';

/**
 * One region list as it looked before an edit.
 *
 * `key` is the history slot the list belongs to: a package id, or the shared
 * reference outline. `regions: null` means "this package had no override yet",
 * which is what an Undo has to put back after the first stroke created one.
 */
export type RegionHistorySnapshot = {
  key: string;
  regions: BatchRegion[] | null;
};

export type RegionHistory = {
  /** Records one undoable operation, however many lists it touched. */
  record: (snapshots: readonly RegionHistorySnapshot[]) => void;
  /** Pops the newest operation and returns the lists to restore. */
  undo: () => RegionHistorySnapshot[] | null;
  canUndo: () => boolean;
  /** How many operations are waiting to be undone. */
  depth: () => number;
  clear: () => void;
};

const DEFAULT_HISTORY_LIMIT = 20;

/**
 * Undo stack for the batch region edits.
 *
 * Steps are kept in one global stack instead of one stack per image, so an
 * operator who switches to the next image can still revert the stroke they just
 * made on the previous one. A single step can carry several lists (a shared
 * stroke writes the outline *and* every override), and Undo restores them
 * together so one press reverts one operation.
 */
export function createRegionHistory(limit: number = DEFAULT_HISTORY_LIMIT): RegionHistory {
  let steps: RegionHistorySnapshot[][] = [];

  const snapshot = (entry: RegionHistorySnapshot): RegionHistorySnapshot => ({
    key: entry.key,
    regions: entry.regions ? cloneRegions(entry.regions) : null,
  });

  return {
    record: (entries) => {
      if (entries.length === 0) return;

      steps = [...steps.slice(-(Math.max(1, limit) - 1)), entries.map(snapshot)];
    },
    undo: () => {
      const step = steps[steps.length - 1];
      if (!step) return null;

      steps = steps.slice(0, -1);
      return step.map(snapshot);
    },
    canUndo: () => steps.length > 0,
    depth: () => steps.length,
    clear: () => {
      steps = [];
    },
  };
}
