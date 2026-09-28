import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BATCH_SESSION_META_KEY,
  clearStoredBatchSessions,
  deleteBatchSessionRecord,
  readBatchSessionSummaries,
  readStoredBatchSession,
  saveBatchSessionRecord,
} from './sessionStore';
import { BATCH_SESSION_VERSION, serializeBatchSession, type BatchSession } from './session';
import type { BatchDirectoryHandleLike } from './workFolder';

const createIndexedDbMock = () => {
  const stores = new Map<string, Map<string, unknown>>();

  const ensureStore = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name) as Map<string, unknown>;
  };

  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => ensureStore(name),
    transaction: (storeName: string) => {
      ensureStore(storeName);
      const tx = {
        oncomplete: null as null | (() => void),
        onerror: null as null | (() => void),
        onabort: null as null | (() => void),
        error: null as Error | null,
        objectStore: () => ({
          put: (value: unknown, key: string) => {
            ensureStore(storeName).set(key, value);
            queueMicrotask(() => tx.oncomplete?.());
          },
          get: (key: string) => {
            const request = {
              onsuccess: null as null | (() => void),
              onerror: null as null | (() => void),
              result: ensureStore(storeName).get(key),
              error: null as Error | null,
            };
            // A real read transaction completes after its request resolves.
            queueMicrotask(() => {
              request.onsuccess?.();
              queueMicrotask(() => tx.oncomplete?.());
            });
            return request;
          },
          delete: (key: string) => {
            ensureStore(storeName).delete(key);
            queueMicrotask(() => tx.oncomplete?.());
          },
        }),
        close: () => undefined,
      };

      return tx;
    },
    close: () => undefined,
  };

  const indexedDB = {
    open: () => {
      const request = {
        onupgradeneeded: null as null | (() => void),
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
        result: database,
      };
      queueMicrotask(() => request.onupgradeneeded?.());
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };

  return { indexedDB, stores };
};

const createLocalStorageMock = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    map,
  };
};

const session = (id: string, savedAt: string, overrides: Partial<BatchSession> = {}): BatchSession => ({
  version: BATCH_SESSION_VERSION,
  id,
  name: `batch-${id}`,
  savedAt,
  step: 'referenceRegion',
  packages: [{
    id: 'pkg-1',
    name: '260206-SPA-K503',
    files: [],
    fullresFileName: null,
    positionsFileName: null,
    scalefactorsFileName: null,
    fullresSize: null,
    previewSize: null,
    contentBounds: null,
    spotDiameterFullres: null,
    spots: null,
    positions: null,
  }],
  referencePackageId: 'pkg-1',
  referenceRegions: [],
  customRegions: {},
  alignments: {},
  alignLinks: {},
  alignBaseId: null,
  customColors: [],
  colorNames: {},
  activeColorId: 1,
  regionTool: 'merge',
  regionMode: 'project',
  referenceConfirmed: false,
  activePackageId: null,
  walkthroughPackageId: null,
  projectDrawPackageId: null,
  walkthroughScope: 'all',
  regionScope: 'image',
  ...overrides,
});

let store: ReturnType<typeof createIndexedDbMock>;
let localStorageMock: ReturnType<typeof createLocalStorageMock>;

beforeEach(() => {
  store = createIndexedDbMock();
  localStorageMock = createLocalStorageMock();
  vi.stubGlobal('window', {
    indexedDB: store.indexedDB,
    localStorage: localStorageMock,
  });
});

describe('batch session store', () => {
  it('keeps the session body in IndexedDB and the summary in localStorage', async () => {
    const summary = await saveBatchSessionRecord(session('a', '2026-09-28T06:00:00.000Z'));

    expect(summary.name).toBe('batch-a');
    expect(summary.step).toBe('referenceRegion');
    expect(JSON.parse(localStorageMock.map.get(BATCH_SESSION_META_KEY) ?? '[]')).toHaveLength(1);

    const loaded = await readStoredBatchSession('a');
    expect(loaded?.session.name).toBe('batch-a');
    expect(loaded?.rootHandle).toBeNull();
  });

  it('lists the newest session first', async () => {
    await saveBatchSessionRecord(session('old', '2026-09-27T06:00:00.000Z'));
    await saveBatchSessionRecord(session('new', '2026-09-28T06:00:00.000Z'));

    const summaries = await readBatchSessionSummaries();

    expect(summaries.map((entry) => entry.id)).toEqual(['new', 'old']);
  });

  it('remembers a folder handle so a reload can find the data again', async () => {
    const rootHandle = { kind: 'directory', name: '睾丸空转 - 副本' } as unknown as BatchDirectoryHandleLike;
    await saveBatchSessionRecord(session('a', '2026-09-28T06:00:00.000Z'), { rootHandle });

    // A later autosave from the same batch passes no handle and must not drop it.
    await saveBatchSessionRecord(session('a', '2026-09-28T06:05:00.000Z'));

    const loaded = await readStoredBatchSession('a');
    expect(loaded?.rootHandle).toBe(rootHandle);
  });

  it('parses the stored body back into a session', async () => {
    const original = session('a', '2026-09-28T06:00:00.000Z', { colorNames: { 2: '基质' } });
    await saveBatchSessionRecord(original);

    const stored = store.stores.get('sessions')?.get('a') as { session: string } | undefined;
    expect(JSON.parse(stored?.session ?? '{}').colorNames).toEqual({ 2: '基质' });
    expect(serializeBatchSession(original)).toContain('基质');
  });

  it('drops a session from both stores', async () => {
    await saveBatchSessionRecord(session('a', '2026-09-28T06:00:00.000Z'));

    await deleteBatchSessionRecord('a');

    expect(await readBatchSessionSummaries()).toEqual([]);
    expect(await readStoredBatchSession('a')).toBeNull();
  });

  it('clears every stored session at once', async () => {
    await saveBatchSessionRecord(session('a', '2026-09-28T06:00:00.000Z'));
    await saveBatchSessionRecord(session('b', '2026-09-28T07:00:00.000Z'));

    await clearStoredBatchSessions();

    expect(await readBatchSessionSummaries()).toEqual([]);
    expect(await readStoredBatchSession('b')).toBeNull();
  });
});
