import { describe, expect, it } from 'vitest';

import { createRegionHistory } from './regionHistory';
import type { BatchRegion } from '@/types/batch';

const region = (id: string, colorId = 1): BatchRegion => ({
  id,
  colorId,
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ],
});

describe('region history', () => {
  it('starts empty', () => {
    const history = createRegionHistory();

    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBeNull();
  });

  it('reverts the newest operation across images', () => {
    const history = createRegionHistory();

    history.record([{ key: 'reference', regions: [] }]);
    history.record([{ key: 'package-2', regions: null }]);

    // The second edit happened on another image; switching images does not
    // detach it from Undo.
    expect(history.canUndo()).toBe(true);
    expect(history.undo()).toEqual([{ key: 'package-2', regions: null }]);
    expect(history.undo()).toEqual([{ key: 'reference', regions: [] }]);
    expect(history.canUndo()).toBe(false);
  });

  it('restores every list an operation touched in one step', () => {
    const history = createRegionHistory();
    const outline = [region('outline')];
    const override = [region('override', 2)];

    history.record([
      { key: 'reference', regions: outline },
      { key: 'package-2', regions: override },
    ]);

    // A shared stroke writes the outline and every override together, so one
    // Undo has to put them all back.
    expect(history.undo()).toEqual([
      { key: 'reference', regions: outline },
      { key: 'package-2', regions: override },
    ]);
    expect(history.canUndo()).toBe(false);
  });

  it('keeps its own copy of the recorded lists', () => {
    const history = createRegionHistory();
    const live = [region('a')];

    history.record([{ key: 'package-2', regions: live }]);
    live.push(region('b'));

    expect(history.undo()?.[0].regions?.map((entry) => entry.id)).toEqual(['a']);
  });

  it('drops the oldest operation once the limit is reached', () => {
    const history = createRegionHistory(2);

    history.record([{ key: 'first', regions: [] }]);
    history.record([{ key: 'second', regions: [] }]);
    history.record([{ key: 'third', regions: [] }]);

    expect(history.undo()?.[0].key).toBe('third');
    expect(history.undo()?.[0].key).toBe('second');
    expect(history.canUndo()).toBe(false);
  });

  it('forgets everything when the batch is cleared', () => {
    const history = createRegionHistory();

    history.record([{ key: 'reference', regions: [] }]);
    history.clear();

    expect(history.canUndo()).toBe(false);
  });
});
