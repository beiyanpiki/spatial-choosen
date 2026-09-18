import JSZip from 'jszip';

import type { BatchPackageFile } from '@/types/batch';

import { normalizeSourcePath } from './importPackages';

export const TRANSFORM_MATRIX_FILE_NAME = 'transform-matrix.csv';

export type BatchPackageExportInput = {
  packageName: string;
  files: readonly BatchPackageFile[];
  positionsFileName: string;
  positionsCsv: string;
  transformMatrixCsv: string;
};

export function sanitizeFileName(value: string, fallback = 'package'): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned === '' ? fallback : cleaned;
}

export function buildPackageExportFileName(packageName: string): string {
  return `${sanitizeFileName(packageName)}-batch.zip`;
}

const resolveMatrixPath = (positionsRelativePath: string) => {
  const normalized = normalizeSourcePath(positionsRelativePath);
  const separator = normalized.lastIndexOf('/');
  const directory = separator >= 0 ? normalized.slice(0, separator) : '';

  return directory === ''
    ? TRANSFORM_MATRIX_FILE_NAME
    : `${directory}/${TRANSFORM_MATRIX_FILE_NAME}`;
};

/**
 * JSZip only unwraps `Blob` through `FileReader`, which is absent outside
 * browsers, so files are materialized as bytes before packaging.
 */
const toZipPayload = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/**
 * Rebundles one NATA package.
 *
 * Only `tissue_positions.csv` is rewritten (with the extra `in_selected`
 * column) and `transform-matrix.csv` is emitted next to it; every other file
 * is copied through untouched.
 */
export async function buildBatchPackageZip(input: BatchPackageExportInput): Promise<Blob> {
  const positionsRelativePath = normalizeSourcePath(input.positionsFileName);
  const matrixRelativePath = resolveMatrixPath(positionsRelativePath);
  const zip = new JSZip();

  for (const file of input.files) {
    const path = normalizeSourcePath(file.relativePath);
    const isPositionsFile = path === positionsRelativePath;
    const isMatrixFile = path.toLowerCase() === matrixRelativePath.toLowerCase();

    if (isPositionsFile || isMatrixFile) {
      continue;
    }

    zip.file(path, await toZipPayload(file.blob), { compression: 'STORE' });
  }

  zip.file(positionsRelativePath, input.positionsCsv, { compression: 'DEFLATE' });
  zip.file(matrixRelativePath, input.transformMatrixCsv, { compression: 'DEFLATE' });

  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export async function buildBatchBundleZip(
  inputs: readonly BatchPackageExportInput[],
): Promise<Blob> {
  const zip = new JSZip();
  const usedFolders = new Map<string, number>();

  for (const input of inputs) {
    const seen = usedFolders.get(input.packageName) ?? 0;
    usedFolders.set(input.packageName, seen + 1);
    const folder = sanitizeFileName(seen === 0
      ? input.packageName
      : `${input.packageName}-${seen + 1}`);
    const positionsRelativePath = normalizeSourcePath(input.positionsFileName);
    const matrixRelativePath = resolveMatrixPath(positionsRelativePath);

    for (const file of input.files) {
      const path = normalizeSourcePath(file.relativePath);
      const isPositionsFile = path === positionsRelativePath;
      const isMatrixFile = path.toLowerCase() === matrixRelativePath.toLowerCase();

      if (isPositionsFile || isMatrixFile) {
        continue;
      }

      zip.file(`${folder}/${path}`, await toZipPayload(file.blob), { compression: 'STORE' });
    }

    zip.file(`${folder}/${positionsRelativePath}`, input.positionsCsv, { compression: 'DEFLATE' });
    zip.file(`${folder}/${matrixRelativePath}`, input.transformMatrixCsv, { compression: 'DEFLATE' });
  }

  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
}
