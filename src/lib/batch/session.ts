import type {
  BatchBounds,
  BatchImageSize,
  BatchPositionsTable,
  BatchRegion,
  BatchRegionMode,
  BatchSimilarityParams,
  BatchSpot,
  BatchStepId,
} from '@/types/batch';

import type { BatchRegionColor } from './regionColors';

/**
 * Version of the on-disk/browser batch session format.
 *
 * Bump it whenever a field changes meaning; `parseBatchSession` refuses to load
 * a session it does not understand instead of guessing.
 */
export const BATCH_SESSION_VERSION = 1;

/** File name of the session that is rewritten after every change. */
export const BATCH_SESSION_FILE_NAME = 'session.json';

/** Suffix of the folder the session is written into, next to the source data. */
export const BATCH_WORK_FOLDER_SUFFIX = '-natatoolkit';

/**
 * A package as it exists on disk.
 *
 * Only the description is stored — the bytes stay in the source folder, and are
 * re-read through the folder handle when a session is continued. Copying tens of
 * megabytes of images into a session file would make it useless for sharing.
 */
export type BatchSessionPackage = {
  id: string;
  name: string;
  /** `spatial/...` paths relative to the package root. */
  files: { relativePath: string; name: string }[];
  fullresFileName: string | null;
  positionsFileName: string | null;
  scalefactorsFileName: string | null;
  fullresSize: BatchImageSize | null;
  previewSize: BatchImageSize | null;
  contentBounds: BatchBounds | null;
  spotDiameterFullres: number | null;
  spots: BatchSpot[] | null;
  /** `tissue_positions.csv` as parsed, needed to export without the source file. */
  positions: BatchPositionsTable | null;
};

/** Alignment of one package, plus the base it was dialled against. */
export type BatchSessionAlignmentLink = {
  baseId: string;
  params: BatchSimilarityParams;
};

export type BatchSession = {
  version: number;
  id: string;
  /** Batch name, taken from the imported folder or the archive. */
  name: string;
  savedAt: string;
  step: BatchStepId;
  packages: BatchSessionPackage[];
  referencePackageId: string | null;
  referenceRegions: BatchRegion[];
  customRegions: Record<string, BatchRegion[]>;
  alignments: Record<string, BatchSimilarityParams>;
  alignLinks: Record<string, BatchSessionAlignmentLink>;
  alignBaseId: string | null;
  customColors: BatchRegionColor[];
  /** Colour group names keyed by class id (JSON keys are strings). */
  colorNames: Record<string, string>;
  activeColorId: number;
  regionTool: 'merge' | 'cut';
  regionMode: BatchRegionMode;
  referenceConfirmed: boolean;
  activePackageId: string | null;
  walkthroughPackageId: string | null;
  projectDrawPackageId: string | null;
  walkthroughScope: 'all' | 'image';
  regionScope: 'all' | 'image';
};

export type BatchSessionSummary = {
  id: string;
  name: string;
  savedAt: string;
  step: BatchStepId;
  packageCount: number;
  referenceName: string | null;
  regionCount: number;
  /** Package folder names, so a continue can report what it is looking for. */
  packageNames: string[];
};

export const createBatchSessionId = (): string =>
  `batch-session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Folder-safe name.
 *
 * Windows forbids `\ / : * ? " < > |` in file names, so a batch called
 * `250926-SPA-GW1: rerun` still produces a usable folder.
 */
export function sanitizeFolderName(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');

  return cleaned === '' ? 'batch' : cleaned;
}

/** `250926-SPA-GW1` -> `250926-SPA-GW1-natatoolkit`. */
export function batchWorkFolderName(sessionName: string): string {
  return `${sanitizeFolderName(sessionName)}${BATCH_WORK_FOLDER_SUFFIX}`;
}

const pad = (value: number) => value.toString().padStart(2, '0');

/** `session-20260928-142233.json`, used for the manual snapshots. */
export function batchSnapshotFileName(date: Date): string {
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');

  return `session-${stamp}.json`;
}

export function serializeBatchSession(session: BatchSession): string {
  return JSON.stringify({ ...session, version: BATCH_SESSION_VERSION }, null, 2);
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const asArray = <T>(value: unknown, fallback: T[]): T[] => (Array.isArray(value) ? value as T[] : fallback);

const asRecord = <T>(value: unknown, fallback: Record<string, T>): Record<string, T> => (
  isRecord(value) ? value as Record<string, T> : fallback
);

const asStringOrNull = (value: unknown): string | null => (
  typeof value === 'string' && value !== '' ? value : null
);

/**
 * Reads a session back.
 *
 * Anything that cannot be understood is rejected with a readable message: a
 * half-restored batch would silently drop the operator's alignment or regions.
 */
export function parseBatchSession(text: string): BatchSession {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('会话文件不是有效的 JSON');
  }

  if (!isRecord(raw)) {
    throw new Error('会话文件内容不是对象');
  }

  const version = Number(raw.version);
  if (!Number.isFinite(version)) {
    throw new Error('会话文件缺少版本号');
  }
  if (version !== BATCH_SESSION_VERSION) {
    throw new Error(`会话文件版本 ${version} 与当前版本 ${BATCH_SESSION_VERSION} 不一致`);
  }

  const packages = asArray<unknown>(raw.packages, []);
  if (packages.length === 0) {
    throw new Error('会话文件里没有样本包');
  }

  const parsedPackages = packages.map((entry, index): BatchSessionPackage => {
    if (!isRecord(entry)) {
      throw new Error(`会话文件里第 ${index + 1} 个样本包格式不正确`);
    }

    const id = asStringOrNull(entry.id);
    const name = asStringOrNull(entry.name);
    if (!id || !name) {
      throw new Error(`会话文件里第 ${index + 1} 个样本包缺少 id 或名称`);
    }

    return {
      id,
      name,
      files: asArray<{ relativePath: string; name: string }>(entry.files, []),
      fullresFileName: asStringOrNull(entry.fullresFileName),
      positionsFileName: asStringOrNull(entry.positionsFileName),
      scalefactorsFileName: asStringOrNull(entry.scalefactorsFileName),
      fullresSize: (entry.fullresSize ?? null) as BatchImageSize | null,
      previewSize: (entry.previewSize ?? null) as BatchImageSize | null,
      contentBounds: (entry.contentBounds ?? null) as BatchBounds | null,
      spotDiameterFullres: typeof entry.spotDiameterFullres === 'number' ? entry.spotDiameterFullres : null,
      spots: (entry.spots ?? null) as BatchSpot[] | null,
      positions: (entry.positions ?? null) as BatchPositionsTable | null,
    };
  });

  return {
    version: BATCH_SESSION_VERSION,
    id: asStringOrNull(raw.id) ?? createBatchSessionId(),
    name: asStringOrNull(raw.name) ?? parsedPackages[0].name,
    savedAt: asStringOrNull(raw.savedAt) ?? new Date().toISOString(),
    step: (raw.step ?? 'import') as BatchStepId,
    packages: parsedPackages,
    referencePackageId: asStringOrNull(raw.referencePackageId),
    referenceRegions: asArray<BatchRegion>(raw.referenceRegions, []),
    customRegions: asRecord<BatchRegion[]>(raw.customRegions, {}),
    alignments: asRecord<BatchSimilarityParams>(raw.alignments, {}),
    alignLinks: asRecord<BatchSessionAlignmentLink>(raw.alignLinks, {}),
    alignBaseId: asStringOrNull(raw.alignBaseId),
    customColors: asArray<BatchRegionColor>(raw.customColors, []),
    colorNames: asRecord<string>(raw.colorNames, {}),
    activeColorId: typeof raw.activeColorId === 'number' ? raw.activeColorId : 1,
    regionTool: raw.regionTool === 'cut' ? 'cut' : 'merge',
    regionMode: raw.regionMode === 'perImage' ? 'perImage' : 'project',
    referenceConfirmed: raw.referenceConfirmed === true,
    activePackageId: asStringOrNull(raw.activePackageId),
    walkthroughPackageId: asStringOrNull(raw.walkthroughPackageId),
    projectDrawPackageId: asStringOrNull(raw.projectDrawPackageId),
    walkthroughScope: raw.walkthroughScope === 'image' ? 'image' : 'all',
    regionScope: raw.regionScope === 'all' ? 'all' : 'image',
  };
}

export function summarizeBatchSession(session: BatchSession): BatchSessionSummary {
  const reference = session.packages.find((entry) => entry.id === session.referencePackageId) ?? null;
  const overrides = Object.values(session.customRegions).filter((regions) => regions.length > 0).length;

  return {
    id: session.id,
    name: session.name,
    savedAt: session.savedAt,
    step: session.step,
    packageCount: session.packages.length,
    referenceName: reference?.name ?? null,
    regionCount: session.referenceRegions.length + overrides,
    packageNames: session.packages.map((entry) => entry.name),
  };
}
