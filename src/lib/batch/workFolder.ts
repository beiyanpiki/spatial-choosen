import type { BatchPackageFile } from '@/types/batch';

import { BATCH_SESSION_FILE_NAME, batchWorkFolderName, sanitizeFolderName } from './session';

/**
 * Minimal shape of the File System Access handles.
 *
 * The real `FileSystemDirectoryHandle` satisfies it; spelling it out keeps the
 * helpers testable with in-memory handles, which is the only way to cover the
 * write paths without a browser dialog.
 */
export type BatchWritableLike = {
  write: (data: string | Blob) => Promise<void>;
  close: () => Promise<void>;
};

export type BatchFileHandleLike = {
  kind?: 'file';
  name: string;
  getFile: () => Promise<Blob>;
  createWritable?: () => Promise<BatchWritableLike>;
};

export type BatchDirectoryHandleLike = {
  kind?: 'directory';
  name: string;
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<BatchDirectoryHandleLike>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<BatchFileHandleLike>;
  entries?: () => AsyncIterableIterator<[string, BatchFileHandleLike | BatchDirectoryHandleLike]>;
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

/** A directory the operator granted write access to. */
export type BatchWorkFolder = {
  /** The folder that hosts the packages (the one the operator picked). */
  parent: BatchDirectoryHandleLike;
  /** `<parentName>-natatoolkit`, created on demand. */
  dir: BatchDirectoryHandleLike;
  name: string;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<BatchDirectoryHandleLike>;
};

export const supportsWorkFolder = (): boolean => (
  typeof window !== 'undefined'
  && typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function'
);

export const WORK_FOLDER_UNSUPPORTED_MESSAGE =
  '当前浏览器不支持写入本地文件夹（需要 Chrome / Edge 的 File System Access API）';

export async function pickDataDirectory(
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<BatchDirectoryHandleLike> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (typeof picker !== 'function') {
    throw new Error(WORK_FOLDER_UNSUPPORTED_MESSAGE);
  }

  return picker.call(window, { mode });
}

/**
 * True when the handle can be used with `mode` right now.
 *
 * A handle restored from IndexedDB keeps its identity but loses permission after
 * a reload, so the check runs before every read or write and the request happens
 * from the click that needs it.
 */
export async function hasPermission(
  handle: BatchDirectoryHandleLike,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<boolean> {
  if (!handle.queryPermission) return true;

  try {
    return (await handle.queryPermission({ mode })) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Turns the picker's failures into something an operator can act on.
 *
 * Chromium only opens a picker while the click that asked for it is still
 * "fresh": awaiting a permission request first burns that activation, and the
 * call then fails with a SecurityError, so the flow has to pick before it does
 * anything else and ask for a fresh click when it cannot.
 */
export function describePickerError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'SecurityError' || /user gesture/i.test(error.message)) {
      return '浏览器要求直接在按钮上点击来选择文件夹：请再点一次该按钮（中间的自动流程不能代替这次点击）。';
    }
    if (error.name === 'NotAllowedError') {
      return '浏览器或系统策略拒绝了文件夹选择，请检查权限后重试。';
    }
  }

  return error instanceof Error ? error.message : WORK_FOLDER_UNSUPPORTED_MESSAGE;
}

export async function ensurePermission(
  handle: BatchDirectoryHandleLike,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<boolean> {
  try {
    if (handle.queryPermission) {
      const state = await handle.queryPermission({ mode });
      if (state === 'granted') return true;
    }

    if (!handle.requestPermission) return true;
    const requested = await handle.requestPermission({ mode });
    return requested === 'granted';
  } catch {
    return false;
  }
}

/** Creates (or reopens) `<parentName>-natatoolkit` inside the picked folder. */
export async function openWorkFolder(
  parent: BatchDirectoryHandleLike,
  sessionName: string,
): Promise<BatchWorkFolder> {
  const folderName = batchWorkFolderName(sessionName);
  const dir = await parent.getDirectoryHandle(folderName, { create: true });

  return { parent, dir, name: folderName };
}

/** Finds the first `<something>-natatoolkit` folder a parent already holds. */
export async function findWorkFolder(
  parent: BatchDirectoryHandleLike,
): Promise<BatchDirectoryHandleLike | null> {
  if (!parent.entries) return null;

  for await (const [name, handle] of parent.entries()) {
    if (isDirectoryHandle(handle) && name.toLowerCase().endsWith('-natatoolkit')) {
      return handle as BatchDirectoryHandleLike;
    }
  }

  return null;
}

/**
 * Chooses the folder a saved session should be restored from.
 *
 * A handle kept from an earlier visit is reused only when it is *already*
 * granted: asking for permission would consume the click's user activation, and
 * the picker that has to follow would then fail with "Must be handling a user
 * gesture". When the handle is missing or stale the picker runs first instead.
 */
export async function resolveRestoreFolder(args: {
  storedHandle: BatchDirectoryHandleLike | null;
  pick: () => Promise<BatchDirectoryHandleLike>;
}): Promise<BatchDirectoryHandleLike> {
  const { storedHandle, pick } = args;

  if (storedHandle && await hasPermission(storedHandle, 'readwrite')) {
    return storedHandle;
  }

  return pick();
}

export async function writeTextFile(
  dir: BatchDirectoryHandleLike,
  fileName: string,
  text: string,
): Promise<void> {
  const handle = await dir.getFileHandle(fileName, { create: true });
  if (!handle.createWritable) {
    throw new Error('该文件夹不可写');
  }

  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

/** Reads a file, returning null when it simply is not there yet. */
export async function readTextFile(
  dir: BatchDirectoryHandleLike,
  fileName: string,
): Promise<string | null> {
  try {
    const handle = await dir.getFileHandle(fileName);
    const blob = await handle.getFile();
    return await blob.text();
  } catch {
    return null;
  }
}

export const readSessionFile = (dir: BatchDirectoryHandleLike) =>
  readTextFile(dir, BATCH_SESSION_FILE_NAME);

const joinPath = (prefix: string, name: string) => (prefix === '' ? name : `${prefix}/${name}`);

const isDirectoryHandle = (handle: BatchFileHandleLike | BatchDirectoryHandleLike) => (
  (handle as BatchDirectoryHandleLike).kind === 'directory'
  || typeof (handle as BatchDirectoryHandleLike).getDirectoryHandle === 'function'
);

/**
 * Reads a package folder into the same shape the importer produces.
 *
 * Paths are relative to the package root (`spatial/tissue_positions.csv`), which
 * is exactly what `buildBatchPackage` expects, so a restored folder goes through
 * the normal pipeline instead of a parallel one.
 */
export async function readPackageFiles(
  packageDir: BatchDirectoryHandleLike,
  prefix = '',
  depth = 0,
  collected: BatchPackageFile[] = [],
): Promise<BatchPackageFile[]> {
  if (depth > 4 || !packageDir.entries) return collected;

  for await (const [name, handle] of packageDir.entries()) {
    if (isDirectoryHandle(handle)) {
      await readPackageFiles(handle as BatchDirectoryHandleLike, joinPath(prefix, name), depth + 1, collected);
      continue;
    }

    const fileHandle = handle as BatchFileHandleLike;
    collected.push({
      relativePath: joinPath(prefix, name),
      name,
      blob: await fileHandle.getFile(),
    });
  }

  return collected;
}

export async function readPackageFilesByName(
  parent: BatchDirectoryHandleLike,
  packageName: string,
): Promise<BatchPackageFile[]> {
  const dir = await parent.getDirectoryHandle(packageName);
  return readPackageFiles(dir);
}

/** Directory names directly under `parent`, used to explain a failed match. */
export async function listDirectoryNames(dir: BatchDirectoryHandleLike): Promise<string[]> {
  if (!dir.entries) return [];

  const names: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (isDirectoryHandle(handle)) names.push(name);
  }

  return names;
}

/**
 * Turns a drop into a writable folder handle when the browser offers one.
 *
 * Chromium exposes `getAsFileSystemHandle()` for dragged items; when it returns
 * a directory the batch can auto-save next to the data, which is the whole point
 * of dropping the folder instead of picking loose files.
 */
export async function directoryHandleFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined,
): Promise<BatchDirectoryHandleLike | null> {
  const items = Array.from(dataTransfer?.items ?? []);

  for (const item of items) {
    if (item.kind !== 'file') continue;
    const reader = item as DataTransferItem & {
      getAsFileSystemHandle?: () => Promise<BatchFileHandleLike | BatchDirectoryHandleLike | null>;
    };
    if (typeof reader.getAsFileSystemHandle !== 'function') continue;

    try {
      const handle = await reader.getAsFileSystemHandle();
      if (handle && isDirectoryHandle(handle)) {
        return handle as BatchDirectoryHandleLike;
      }
    } catch {
      // A denied or unsupported item simply falls back to the file list.
    }
  }

  return null;
}

/** Flattens a granted folder into the file list the importer already handles. */
export async function directoryToSourceFiles(
  dir: BatchDirectoryHandleLike,
): Promise<{ path: string; name: string; blob: Blob }[]> {
  if (!dir.entries) return [];

  const files: { path: string; name: string; blob: Blob }[] = [];

  for await (const [name, handle] of dir.entries()) {
    if (!isDirectoryHandle(handle)) continue;
    const packageFiles = await readPackageFiles(handle as BatchDirectoryHandleLike, sanitizeFolderName(name));
    files.push(...packageFiles.map((file) => ({
      path: file.relativePath,
      name: file.name,
      blob: file.blob,
    })));
  }

  return files;
}
