import { describe, expect, it, vi } from 'vitest';

import {
  directoryHandleFromDataTransfer,
  directoryToSourceFiles,
  describePickerError,
  ensurePermission,
  findWorkFolder,
  hasPermission,
  listDirectoryNames,
  openWorkFolder,
  readPackageFiles,
  readPackageFilesByName,
  readSessionFile,
  readTextFile,
  resolveRestoreFolder,
  writeTextFile,
  type BatchDirectoryHandleLike,
  type BatchFileHandleLike,
} from './workFolder';

type MemoryEntry = MemoryFile | MemoryDir;

type MemoryFile = {
  kind: 'file';
  name: string;
  content: string;
};

type MemoryDir = {
  kind: 'directory';
  name: string;
  children: Map<string, MemoryEntry>;
  /** Mirrors the `create` option so tests can assert the folder was made. */
  created?: boolean;
  permission?: PermissionState;
};

const file = (name: string, content = ''): MemoryFile => ({ kind: 'file', name, content });

const dir = (name: string, children: MemoryEntry[] = [], permission?: PermissionState): MemoryDir => ({
  kind: 'directory',
  name,
  children: new Map(children.map((child) => [child.name, child])),
  ...(permission ? { permission } : {}),
});

const fatal = (message: string) => {
  const error = new Error(message);
  error.name = 'NotFoundError';
  throw error;
};

const asHandle = (entry: MemoryDir): BatchDirectoryHandleLike => ({
  kind: 'directory',
  name: entry.name,
  getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
    const existing = entry.children.get(name);
    if (existing && existing.kind === 'directory') return asHandle(existing);
    if (!options?.create) return fatal(`${name} missing`);

    const created = dir(name);
    created.created = true;
    entry.children.set(name, created);
    return asHandle(created);
  },
  getFileHandle: async (name: string, options?: { create?: boolean }): Promise<BatchFileHandleLike> => {
    const existing = entry.children.get(name);
    if (existing && existing.kind === 'file') {
      return {
        kind: 'file',
        name,
        getFile: async () => new Blob([existing.content], { type: 'text/plain' }),
        createWritable: async () => ({
          write: async (data: string | Blob) => {
            existing.content = typeof data === 'string' ? data : await data.text();
          },
          close: async () => undefined,
        }),
      };
    }
    if (!options?.create) {
      return fatal(`${name} missing`);
    }

    const created = file(name);
    entry.children.set(name, created);
    return {
      kind: 'file',
      name,
      getFile: async () => new Blob([created.content], { type: 'text/plain' }),
      createWritable: async () => ({
        write: async (data: string | Blob) => {
          created.content = typeof data === 'string' ? data : await data.text();
        },
        close: async () => undefined,
      }),
    };
  },
  entries: () => {
    const items = [...entry.children.values()];
    let index = 0;
    const iterator: AsyncIterableIterator<[string, BatchDirectoryHandleLike | BatchFileHandleLike]> = {
      next: async () => {
        if (index >= items.length) return { done: true as const, value: undefined as never };
        const child = items[index];
        index += 1;
        const value: [string, BatchDirectoryHandleLike | BatchFileHandleLike] = [
          child.name,
          child.kind === 'directory'
            ? asHandle(child)
            : {
                kind: 'file',
                name: child.name,
                getFile: async () => new Blob([child.content], { type: 'text/plain' }),
              },
        ];
        return { done: false as const, value };
      },
      [Symbol.asyncIterator]() { return this; },
    };

    return iterator;
  },
  queryPermission: async () => entry.permission ?? 'granted',
  requestPermission: async () => entry.permission ?? 'granted',
});

const sampleParent = () => dir('睾丸空转 - 副本', [
  dir('260206-SPA-K503', [
    dir('spatial', [
      file('tissue_fullres_image.png', 'png-bytes'),
      file('tissue_positions.csv', 'barcode,in_tissue\nAA,1\n'),
    ]),
  ]),
]);

describe('work folder', () => {
  it('creates the suffixed folder next to the data', async () => {
    const parent = sampleParent();
    const folder = await openWorkFolder(asHandle(parent), '睾丸空转 - 副本');

    expect(folder.name).toBe('睾丸空转 - 副本-natatoolkit');
    const created = parent.children.get(folder.name);
    expect(created?.kind).toBe('directory');
    expect((created as MemoryDir).created).toBe(true);
  });

  it('writes and reads the session file', async () => {
    const parent = sampleParent();
    const folder = await openWorkFolder(asHandle(parent), 'batch');

    await writeTextFile(folder.dir, 'session.json', '{"version":1}');

    expect(await readSessionFile(folder.dir)).toBe('{"version":1}');
    expect(await readTextFile(folder.dir, 'session-20260928-142233.json')).toBeNull();
  });

  it('finds an existing work folder inside a parent', async () => {
    const parent = sampleParent();
    parent.children.set('somewhere-natatoolkit', dir('somewhere-natatoolkit', [file('session.json', '{}')]));

    const found = await findWorkFolder(asHandle(parent));

    expect(found?.name).toBe('somewhere-natatoolkit');
  });

  it('walks a package folder into importer-shaped files', async () => {
    const parent = sampleParent();
    const packageDir = await asHandle(parent).getDirectoryHandle('260206-SPA-K503');

    const files = await readPackageFiles(packageDir);

    expect(files.map((entry) => entry.relativePath).sort()).toEqual([
      'spatial/tissue_fullres_image.png',
      'spatial/tissue_positions.csv',
    ]);
    expect(files[0].blob).toBeInstanceOf(Blob);
  });

  it('reads a package by the folder name recorded in the session', async () => {
    const files = await readPackageFilesByName(asHandle(sampleParent()), '260206-SPA-K503');

    expect(files).toHaveLength(2);
  });

  it('lists directory names so a missing sample can be reported', async () => {
    expect(await listDirectoryNames(asHandle(sampleParent()))).toEqual(['260206-SPA-K503']);
  });

  it('flattens a granted folder into source paths the importer groups', async () => {
    const files = await directoryToSourceFiles(asHandle(sampleParent()));

    expect(files.map((entry) => entry.path).sort()).toEqual([
      '260206-SPA-K503/spatial/tissue_fullres_image.png',
      '260206-SPA-K503/spatial/tissue_positions.csv',
    ]);
  });

  it('reports whether the handle may still be written to', async () => {
    expect(await ensurePermission(asHandle(dir('granted', [], 'granted')), 'readwrite')).toBe(true);
    expect(await ensurePermission(asHandle(dir('denied', [], 'denied')), 'readwrite')).toBe(false);
  });

  it('picks a dropped directory handle when the browser offers one', async () => {
    const handle = asHandle(sampleParent());
    const dataTransfer = {
      items: [{
        kind: 'file',
        getAsFileSystemHandle: async () => handle,
      }],
    } as unknown as DataTransfer;

    expect(await directoryHandleFromDataTransfer(dataTransfer)).toBe(handle);
    expect(await directoryHandleFromDataTransfer(null)).toBeNull();
  });

  it('ignores drops that only expose loose files', async () => {
    const dataTransfer = {
      items: [{
        kind: 'file',
        getAsFileSystemHandle: async () => ({
          kind: 'file',
          name: 'tissue_positions.csv',
          getFile: async () => new Blob(['']),
        }),
      }],
    } as unknown as DataTransfer;

    expect(await directoryHandleFromDataTransfer(dataTransfer)).toBeNull();
  });

  it('survives a handle that throws while being read', async () => {
    const broken: BatchDirectoryHandleLike = {
      kind: 'directory',
      name: 'broken',
      getDirectoryHandle: vi.fn(async () => fatal('nope')),
      getFileHandle: vi.fn(async () => fatal('nope')),
    };

    expect(await readSessionFile(broken)).toBeNull();
    expect(await readPackageFiles(broken)).toEqual([]);
  });

  it('reuses a folder only while it is still granted', async () => {
    const granted = asHandle(dir('granted', [], 'granted'));
    const denied = asHandle(dir('denied', [], 'denied'));
    const pick = vi.fn(async () => asHandle(sampleParent()));

    expect(await resolveRestoreFolder({ storedHandle: granted, pick })).toBe(granted);
    expect(pick).not.toHaveBeenCalled();

    // A stale handle must go through the picker *without* asking for permission
    // first: that request would consume the click and the picker would then fail
    // with "Must be handling a user gesture".
    const requestPermission = vi.fn(async () => 'granted' as PermissionState);
    const stale: BatchDirectoryHandleLike = { ...denied, requestPermission };

    const picked = await resolveRestoreFolder({ storedHandle: stale, pick });

    expect(pick).toHaveBeenCalledTimes(1);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(picked).not.toBe(stale);
  });

  it('reports permission state without requesting anything', async () => {
    const requestPermission = vi.fn(async () => 'granted' as PermissionState);
    const handle: BatchDirectoryHandleLike = { ...asHandle(dir('h')), queryPermission: async () => 'prompt', requestPermission };

    expect(await hasPermission(handle, 'readwrite')).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('explains a picker that lost the user gesture', () => {
    expect(describePickerError(new DOMException('Must be handling a user gesture to show a file picker.', 'SecurityError')))
      .toMatch(/再点一次/);
    expect(describePickerError(new DOMException('denied', 'NotAllowedError'))).toMatch(/策略|权限/);
    expect(describePickerError(new Error('boom'))).toBe('boom');
  });
});
