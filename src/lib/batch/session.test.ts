import { describe, expect, it } from 'vitest';

import {
  BATCH_SESSION_VERSION,
  batchSnapshotFileName,
  batchWorkFolderName,
  parseBatchSession,
  sanitizeFolderName,
  serializeBatchSession,
  summarizeBatchSession,
  type BatchSession,
} from './session';
import type { BatchRegion } from '@/types/batch';

const region = (id: string): BatchRegion => ({
  id,
  colorId: 1,
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ],
});

const session = (overrides: Partial<BatchSession> = {}): BatchSession => ({
  version: BATCH_SESSION_VERSION,
  id: 'session-1',
  name: '睾丸空转 - 副本',
  savedAt: '2026-09-28T06:00:00.000Z',
  step: 'imageRegions',
  packages: [
    {
      id: 'pkg-1',
      name: '260206-SPA-K503',
      files: [{ relativePath: 'spatial/tissue_positions.csv', name: 'tissue_positions.csv' }],
      fullresFileName: 'spatial/tissue_fullres_image.png',
      positionsFileName: 'spatial/tissue_positions.csv',
      scalefactorsFileName: 'spatial/scalefactors_json.json',
      fullresSize: { width: 6005, height: 6005 },
      previewSize: { width: 1600, height: 1600 },
      contentBounds: null,
      spotDiameterFullres: 39.51,
      spots: [],
      positions: { header: ['barcode'], rows: [['AA']], columnIndex: { barcode: 0 } },
    },
  ],
  referencePackageId: 'pkg-1',
  referenceRegions: [region('r1')],
  customRegions: { 'pkg-2': [region('r2')], 'pkg-3': [] },
  alignments: { 'pkg-1': { rotationDegrees: 2, scale: 1.01, flipHorizontal: false, flipVertical: false, offsetX: 0.01, offsetY: -0.02 } },
  alignLinks: { 'pkg-2': { baseId: 'pkg-1', params: { rotationDegrees: 0, scale: 1, flipHorizontal: false, flipVertical: false, offsetX: 0, offsetY: 0 } } },
  alignBaseId: 'pkg-1',
  customColors: [],
  colorNames: { 1: '肿瘤' },
  activeColorId: 1,
  regionTool: 'merge',
  regionMode: 'perImage',
  referenceConfirmed: true,
  activePackageId: 'pkg-2',
  walkthroughPackageId: 'pkg-2',
  projectDrawPackageId: null,
  walkthroughScope: 'all',
  regionScope: 'image',
  ...overrides,
});

describe('batch session serialization', () => {
  it('round-trips every field the workspace needs to continue', () => {
    const original = session();
    const parsed = parseBatchSession(serializeBatchSession(original));

    expect(parsed.version).toBe(BATCH_SESSION_VERSION);
    expect(parsed.name).toBe(original.name);
    expect(parsed.step).toBe('imageRegions');
    expect(parsed.packages[0].spots).toEqual([]);
    expect(parsed.packages[0].positions?.header).toEqual(['barcode']);
    expect(parsed.referenceRegions).toHaveLength(1);
    expect(parsed.alignments['pkg-1'].rotationDegrees).toBe(2);
    expect(parsed.alignLinks['pkg-2'].baseId).toBe('pkg-1');
    expect(parsed.colorNames).toEqual({ 1: '肿瘤' });
    expect(parsed.walkthroughScope).toBe('all');
    expect(parsed.regionScope).toBe('image');
  });

  it('refuses a session written by another version', () => {
    const text = JSON.stringify({ ...session(), version: BATCH_SESSION_VERSION + 1 });

    expect(() => parseBatchSession(text)).toThrow(/版本/);
  });

  it('refuses files that are not sessions at all', () => {
    expect(() => parseBatchSession('not json')).toThrow(/JSON/);
    expect(() => parseBatchSession('null')).toThrow(/对象/);
    expect(() => parseBatchSession(JSON.stringify({ version: BATCH_SESSION_VERSION }))).toThrow(/没有样本包/);
  });

  it('fills sensible defaults for the optional view state', () => {
    const text = JSON.stringify({
      version: BATCH_SESSION_VERSION,
      packages: [{ id: 'p1', name: 'p1' }],
    });
    const parsed = parseBatchSession(text);

    expect(parsed.step).toBe('import');
    expect(parsed.regionMode).toBe('project');
    expect(parsed.regionTool).toBe('merge');
    expect(parsed.walkthroughScope).toBe('all');
    expect(parsed.regionScope).toBe('image');
    expect(parsed.customRegions).toEqual({});
  });
});

describe('batch session naming', () => {
  it('keeps folder names usable on Windows', () => {
    expect(sanitizeFolderName('250926-SPA-GW1: rerun')).toBe('250926-SPA-GW1- rerun');
    expect(sanitizeFolderName('  bad/name\\here  ')).toBe('bad-name-here');
    expect(sanitizeFolderName('...')).toBe('batch');
    expect(sanitizeFolderName('')).toBe('batch');
  });

  it('suffixes the work folder after the batch', () => {
    expect(batchWorkFolderName('睾丸空转 - 副本')).toBe('睾丸空转 - 副本-natatoolkit');
    expect(batchWorkFolderName('260206-SPA-K507')).toBe('260206-SPA-K507-natatoolkit');
  });

  it('stamps snapshots with a sortable name', () => {
    expect(batchSnapshotFileName(new Date(2026, 8, 28, 14, 22, 33)))
      .toBe('session-20260928-142233.json');
  });
});

describe('batch session summary', () => {
  it('counts the reference outline and the per-image overrides', () => {
    const summary = summarizeBatchSession(session());

    expect(summary.id).toBe('session-1');
    expect(summary.packageCount).toBe(1);
    expect(summary.referenceName).toBe('260206-SPA-K503');
    // one shared region + one non-empty override (the empty one does not count)
    expect(summary.regionCount).toBe(2);
    expect(summary.packageNames).toEqual(['260206-SPA-K503']);
  });
});
