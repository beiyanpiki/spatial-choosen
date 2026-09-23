import { describe, expect, it } from 'vitest';

import {
  BATCH_REGION_COLORS,
  DEFAULT_REGION_COLOR_ID,
  createRegionColor,
  findRegionColorByHex,
  nextRegionColorId,
  normalizeHexColor,
  normalizeRegionColorId,
  regionColor,
  synthesizedRegionColor,
} from './regionColors';

describe('region colour palette', () => {
  it('starts with the five built-in classes', () => {
    expect(BATCH_REGION_COLORS.map((color) => color.id)).toEqual([1, 2, 3, 4, 5]);
    // Names are the operator-facing group labels, which the palette allows to be
    // renamed; the id is what the export carries.
    expect(regionColor(3).name).toBe('Group 3');
  });

  it('hands out the next free class id', () => {
    expect(nextRegionColorId(BATCH_REGION_COLORS)).toBe(6);
    expect(nextRegionColorId([...BATCH_REGION_COLORS, createRegionColor(6, '#3366ff')])).toBe(7);
  });

  it('builds a usable colour from a picked hex value', () => {
    const color = createRegionColor(6, '#3366ff');

    expect(color).toEqual({
      id: 6,
      name: 'Group 6',
      swatch: '#3366FF',
      stroke: 'rgb(51, 102, 255)',
      fill: 'rgba(51, 102, 255, 0.20)',
      hex: '#3366FF',
    });
  });

  it('falls back to red for a bad hex value', () => {
    expect(createRegionColor(6, 'nope').stroke).toBe('rgb(229, 62, 62)');
  });

  it('accepts class ids beyond the built-in five', () => {
    expect(normalizeRegionColorId(9)).toBe(9);
    expect(normalizeRegionColorId(0)).toBe(DEFAULT_REGION_COLOR_ID);
    expect(normalizeRegionColorId(Number.NaN)).toBe(DEFAULT_REGION_COLOR_ID);
    expect(normalizeRegionColorId(null)).toBe(DEFAULT_REGION_COLOR_ID);
  });

  it('uses the palette entry when the class is known', () => {
    const custom = createRegionColor(6, '#3366ff');

    expect(regionColor(6, [...BATCH_REGION_COLORS, custom])).toBe(custom);
  });

  it('synthesizes a stable colour for a class outside the palette', () => {
    const first = regionColor(7, BATCH_REGION_COLORS);
    const second = regionColor(7, BATCH_REGION_COLORS);

    expect(first.id).toBe(7);
    expect(first.stroke).toBe(second.stroke);
    // Different classes have to be distinguishable.
    expect(synthesizedRegionColor(7).stroke).not.toBe(synthesizedRegionColor(8).stroke);
  });

  it('matches palette colours by hex, ignoring case and the hash', () => {
    expect(normalizeHexColor('38a169')).toBe('#38A169');
    expect(normalizeHexColor('  #38A169 ')).toBe('#38A169');
    expect(normalizeHexColor('nope')).toBeNull();

    expect(findRegionColorByHex(BATCH_REGION_COLORS, '#38a169')?.id).toBe(3);
    expect(findRegionColorByHex(BATCH_REGION_COLORS, 'E53E3E')?.id).toBe(1);
    expect(findRegionColorByHex(BATCH_REGION_COLORS, '#123456')).toBeNull();
    // Synthesized colours use hsl, so they never match a picked hex.
    expect(findRegionColorByHex([synthesizedRegionColor(9)], '#123456')).toBeNull();
  });
});
