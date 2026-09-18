import JSZip from 'jszip';

import type { BatchPackage, BatchPackageFile } from '@/types/batch';

import { createPreviewDerivative, readImageSize } from './imagePreview';
import {
  FULLRES_IMAGE_FILE_PATTERN,
  POSITIONS_FILE_PATTERN,
  SCALEFACTORS_FILE_PATTERN,
  parsePositionsTable,
  readSpotDiameter,
  readSpotsFromPositions,
} from './positions';
import {
  IN_SELECTED_VALUE,
  TRANSFORM_MATRIX_FILE_PATTERN,
  parseTransformMatrixCsv,
  similarityParamsFromOwnFrameMatrix,
} from './resume';

export type BatchSelectedFile = {
  /** Normalized `/`-separated path, including `spatial/`. */
  path: string;
  name: string;
  blob: Blob;
};

export type BatchSourceFile = BatchSelectedFile;

export type GroupedBatchPackage = {
  name: string;
  rootPath: string;
  files: BatchPackageFile[];
};

export const normalizeSourcePath = (value: string) =>
  value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');

const fileNameOf = (path: string) => path.split('/').filter(Boolean).pop() ?? path;

/**
 * Resolves the folder that owns a package.
 *
 * NATA packages are `<sample>/spatial/<files>` on disk but the user may pick
 * either the sample folder, the parent folder, or a `zip` with the same
 * layout. Everything before the `spatial` segment is treated as the package
 * root; layouts without a `spatial` segment fall back to the file folder.
 */
export function resolvePackageRoot(path: string): string {
  const segments = normalizeSourcePath(path).split('/').filter(Boolean);
  const spatialIndex = segments.findIndex((segment) => segment.toLowerCase() === 'spatial');

  if (spatialIndex > 0) {
    return segments.slice(0, spatialIndex).join('/');
  }

  if (spatialIndex === 0) {
    return '';
  }

  return segments.slice(0, -1).join('/');
}

const isInsideRoot = (path: string, rootPath: string) => (
  rootPath === '' ? true : path.startsWith(`${rootPath}/`)
);

const relativeToRoot = (path: string, rootPath: string) => (
  rootPath === '' ? path : path.slice(rootPath.length + 1)
);

export function groupSourceFiles(files: readonly BatchSourceFile[]): GroupedBatchPackage[] {
  const roots = new Map<string, { name: string; rootPath: string; files: BatchPackageFile[] }>();
  const order: string[] = [];

  const ensureRoot = (rootPath: string) => {
    const existing = roots.get(rootPath);
    if (existing) return existing;

    const segments = rootPath.split('/').filter(Boolean);
    const entry = {
      name: segments.length > 0 ? segments[segments.length - 1] : 'package',
      rootPath,
      files: [],
    };
    roots.set(rootPath, entry);
    order.push(rootPath);
    return entry;
  };

  // The full-resolution image is the anchor that makes a folder a package.
  for (const file of files) {
    if (FULLRES_IMAGE_FILE_PATTERN.test(file.name)) {
      ensureRoot(resolvePackageRoot(file.path));
    }
  }

  const sortedRoots = order
    .map((rootPath) => roots.get(rootPath))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => right.rootPath.length - left.rootPath.length);

  for (const file of files) {
    const owner = sortedRoots.find((entry) => isInsideRoot(file.path, entry.rootPath));
    if (!owner) continue;

    owner.files.push({
      relativePath: relativeToRoot(file.path, owner.rootPath),
      name: file.name,
      blob: file.blob,
    });
  }

  const usedNames = new Map<string, number>();

  return sortedRoots
    .filter((entry) => entry.files.length > 0)
    .map((entry) => {
      const seen = usedNames.get(entry.name) ?? 0;
      usedNames.set(entry.name, seen + 1);

      return {
        ...entry,
        name: seen === 0 ? entry.name : `${entry.name}-${seen + 1}`,
      };
    });
}

const readZipSourceFiles = async (blob: Blob, archiveName: string): Promise<BatchSourceFile[]> => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const paths = entries.map((entry) => normalizeSourcePath(entry.name));
  const folder = resolveArchiveFolder(paths, archiveName);
  const files: BatchSourceFile[] = [];

  for (const [index, entry] of entries.entries()) {
    const path = paths[index];
    files.push({
      path: folder ? `${folder}/${path}` : path,
      name: fileNameOf(path),
      blob: await entry.async('blob'),
    });
  }

  if (files.length === 0) {
    throw new Error(`Archive "${archiveName}" has no readable files`);
  }

  return files;
};

/**
 * Names a flat archive after the archive itself.
 *
 * Step 5 exports one zip per package with the files at `spatial/...`, so the
 * archive carries the sample name (`250926-SPA-GW1-batch.zip`) that is missing
 * from the internal paths. Re-importing it should still produce a package
 * called `250926-SPA-GW1`, not a generic `package`.
 */
export function resolveArchiveFolder(
  paths: readonly string[],
  archiveName: string,
): string | null {
  const fullresPaths = paths.filter((path) => FULLRES_IMAGE_FILE_PATTERN.test(fileNameOf(path)));
  if (fullresPaths.length === 0) return null;
  if (!fullresPaths.every((path) => resolvePackageRoot(path) === '')) return null;

  const base = normalizeSourcePath(archiveName)
    .replace(/\.zip$/i, '')
    .replace(/-batch$/i, '')
    .trim();

  return base === '' ? null : base;
}

/**
 * Flattens a browser file selection into package source files.
 *
 * Accepts folder picks (`webkitdirectory`), loose `zip` archives, and mixed
 * selections; archives are expanded in place so both routes land in the same
 * package layout.
 */
export function selectedFilesFromFileList(list: Iterable<File>): BatchSelectedFile[] {
  return Array.from(list).map((file) => {
    const path = normalizeSourcePath(file.webkitRelativePath || file.name);
    return { path, name: fileNameOf(path), blob: file };
  });
}

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  fullPath: string;
  name: string;
  file?: (onSuccess: (file: File) => void, onError: () => void) => void;
  createReader?: () => {
    readEntries: (onSuccess: (entries: FileSystemEntryLike[]) => void, onError: () => void) => void;
  };
};

const readDroppedEntry = async (entry: FileSystemEntryLike): Promise<BatchSelectedFile[]> => {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File | null>((resolve) => {
      entry.file?.((value) => resolve(value), () => resolve(null));
    });

    if (!file) return [];
    const path = normalizeSourcePath(entry.fullPath || file.name);
    return [{ path, name: fileNameOf(path), blob: file }];
  }

  const reader = entry.createReader?.();
  if (!reader) return [];

  const collected: BatchSelectedFile[] = [];

  for (;;) {
    const entries = await new Promise<FileSystemEntryLike[]>((resolve) => {
      reader.readEntries((value) => resolve(value), () => resolve([]));
    });

    if (entries.length === 0) break;

    for (const child of entries) {
      collected.push(...(await readDroppedEntry(child)));
    }
  }

  return collected;
};

/**
 * Reads a drag & drop payload, keeping folder structure so dropped packages
 * land in the same grouping as a folder picker selection.
 */
export async function readDroppedBatchFiles(dataTransfer: DataTransfer): Promise<BatchSelectedFile[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries: FileSystemEntryLike[] = [];

  for (const item of items) {
    if (item.kind !== 'file') continue;
    // The entry API is not part of the standard DataTransferItem typings.
    const reader = item as DataTransferItem & { webkitGetAsEntry?: () => unknown };
    const entry = reader.webkitGetAsEntry?.();
    if (entry) {
      entries.push(entry as FileSystemEntryLike);
    }
  }

  if (entries.length === 0) {
    return selectedFilesFromFileList(dataTransfer.files);
  }

  const collected: BatchSelectedFile[] = [];
  for (const entry of entries) {
    collected.push(...(await readDroppedEntry(entry)));
  }

  return collected;
}

export async function readBatchSourceFiles(
  selected: Iterable<BatchSelectedFile>,
): Promise<{ files: BatchSourceFile[]; archives: string[] }> {
  const files: BatchSourceFile[] = [];
  const archives: string[] = [];

  for (const entry of selected) {
    if (/\.zip$/i.test(entry.name)) {
      files.push(...(await readZipSourceFiles(entry.blob, entry.name)));
      archives.push(entry.name);
      continue;
    }

    files.push({
      path: normalizeSourcePath(entry.path),
      name: entry.name,
      blob: entry.blob,
    });
  }

  return { files, archives };
}

const readBlobText = async (blob: Blob | undefined): Promise<string | null> => (
  blob ? blob.text() : null
);

export async function buildBatchPackage(
  group: GroupedBatchPackage,
  id: string,
): Promise<BatchPackage> {
  const fullresFile = group.files.find((file) => FULLRES_IMAGE_FILE_PATTERN.test(file.name)) ?? null;
  const positionsFile = group.files.find((file) => POSITIONS_FILE_PATTERN.test(file.name)) ?? null;
  const scalefactorsFile = group.files.find((file) => SCALEFACTORS_FILE_PATTERN.test(file.name)) ?? null;
  const matrixFile = group.files.find((file) => TRANSFORM_MATRIX_FILE_PATTERN.test(file.name)) ?? null;

  const base: BatchPackage = {
    id,
    name: group.name,
    files: group.files,
    fullresFileName: fullresFile?.relativePath ?? null,
    positionsFileName: positionsFile?.relativePath ?? null,
    scalefactorsFileName: scalefactorsFile?.relativePath ?? null,
    fullresSize: null,
    previewUrl: null,
    previewSize: null,
    spotDiameterFullres: null,
    spots: null,
    positions: null,
    resume: null,
    status: 'loading',
    error: null,
  };

  if (!fullresFile) {
    return { ...base, status: 'error', error: 'Missing tissue_fullres_image.png' };
  }

  if (!positionsFile) {
    return {
      ...base,
      fullresSize: await readImageSize(fullresFile.blob).catch(() => null),
      status: 'error',
      error: 'Missing tissue_positions.csv',
    };
  }

  try {
    const [fullresSize, positionsText, scalefactorsText, matrixText] = await Promise.all([
      readImageSize(fullresFile.blob),
      readBlobText(positionsFile.blob),
      readBlobText(scalefactorsFile?.blob),
      readBlobText(matrixFile?.blob),
    ]);
    const positions = positionsText ? parsePositionsTable(positionsText) : null;

    if (!positions) {
      return {
        ...base,
        fullresSize,
        status: 'error',
        error: 'tissue_positions.csv is missing required columns',
      };
    }

    const selectedColumn = positions.columnIndex.in_selected;
    const selectedBarcodes = selectedColumn === undefined
      ? null
      : positions.rows
        .filter((row) => (row[selectedColumn] ?? '').trim() === IN_SELECTED_VALUE)
        .map((row) => (row[positions.columnIndex.barcode ?? 0] ?? '').trim())
        .filter((barcode) => barcode !== '');
    const matrix = matrixText ? parseTransformMatrixCsv(matrixText) : null;
    const alignment = matrix ? similarityParamsFromOwnFrameMatrix(matrix, fullresSize) : null;
    const preview = await createPreviewDerivative(fullresFile.blob);

    return {
      ...base,
      fullresSize,
      previewUrl: URL.createObjectURL(preview.blob),
      previewSize: preview.size,
      spotDiameterFullres: readSpotDiameter(scalefactorsText),
      spots: readSpotsFromPositions(positions),
      positions,
      resume: selectedBarcodes || alignment ? { alignment, selectedBarcodes } : null,
      status: 'ready',
      error: null,
    };
  } catch (error) {
    return {
      ...base,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unable to read package',
    };
  }
}
