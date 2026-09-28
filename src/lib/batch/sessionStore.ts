import {
  type BatchSession,
  type BatchSessionSummary,
  parseBatchSession,
  serializeBatchSession,
  summarizeBatchSession,
} from './session';
import type { BatchDirectoryHandleLike } from './workFolder';

/**
 * Browser-side record of the batch sessions.
 *
 * The summaries live in `localStorage` so the landing can list them without
 * opening IndexedDB, while the session body (regions, alignments, spot tables)
 * and the folder handle live in IndexedDB — the same split the preprocessing
 * workspace uses. The handles are structured-cloneable, which is what lets a
 * reloaded page find the source folder again.
 */
export const BATCH_SESSION_DB_NAME = 'spatial-batch-sessions';
export const BATCH_SESSION_DB_VERSION = 1;
export const BATCH_SESSION_STORE = 'sessions';
export const BATCH_SESSION_META_KEY = 'spatial-batch-sessions-meta';

export type StoredBatchSession = {
  summary: BatchSessionSummary;
  /** Serialized session; parsed on read so a corrupt record fails loudly. */
  session: string;
  rootHandle: BatchDirectoryHandleLike | null;
};

export type LoadedBatchSession = {
  session: BatchSession;
  rootHandle: BatchDirectoryHandleLike | null;
};

const isBrowser = () => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const openDb = async (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (!isBrowser()) {
    reject(new Error('IndexedDB unavailable on server'));
    return;
  }

  const request = window.indexedDB.open(BATCH_SESSION_DB_NAME, BATCH_SESSION_DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(BATCH_SESSION_STORE)) {
      db.createObjectStore(BATCH_SESSION_STORE);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const txDone = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

const readStoreValue = async <T>(key: string): Promise<T | undefined> => {
  const db = await openDb();
  const tx = db.transaction(BATCH_SESSION_STORE, 'readonly');
  const request = tx.objectStore(BATCH_SESSION_STORE).get(key);
  const value = await new Promise<T | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
  await txDone(tx);
  db.close();
  return value ?? undefined;
};

const writeStoreValue = async (key: string, value: StoredBatchSession): Promise<void> => {
  const db = await openDb();
  const tx = db.transaction(BATCH_SESSION_STORE, 'readwrite');
  tx.objectStore(BATCH_SESSION_STORE).put(value, key);
  await txDone(tx);
  db.close();
};

const deleteStoreValue = async (key: string): Promise<void> => {
  const db = await openDb();
  const tx = db.transaction(BATCH_SESSION_STORE, 'readwrite');
  tx.objectStore(BATCH_SESSION_STORE).delete(key);
  await txDone(tx);
  db.close();
};

const readSummaries = (): BatchSessionSummary[] => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(BATCH_SESSION_META_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as BatchSessionSummary[] : [];
  } catch {
    return [];
  }
};

const writeSummaries = (summaries: readonly BatchSessionSummary[]) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(BATCH_SESSION_META_KEY, JSON.stringify(summaries));
  } catch {
    // A full or blocked localStorage must not break the session itself.
  }
};

/** Newest first: the landing shows the most recent session on top. */
export async function readBatchSessionSummaries(): Promise<BatchSessionSummary[]> {
  return readSummaries().sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

export async function saveBatchSessionRecord(
  session: BatchSession,
  options: { rootHandle?: BatchDirectoryHandleLike | null } = {},
): Promise<BatchSessionSummary> {
  const summary = summarizeBatchSession(session);
  const previous = readSummaries().filter((entry) => entry.id !== session.id);
  writeSummaries([summary, ...previous].slice(0, 20));

  // `undefined` keeps the handle that is already stored, so an autosave coming
  // from a batch that was imported without a folder does not erase it.
  const existing = options.rootHandle === undefined
    ? (await readStoreValue<StoredBatchSession>(session.id))?.rootHandle ?? null
    : options.rootHandle;

  await writeStoreValue(session.id, {
    summary,
    session: serializeBatchSession(session),
    rootHandle: existing ?? null,
  });

  return summary;
}

export async function readStoredBatchSession(id: string): Promise<LoadedBatchSession | null> {
  const record = await readStoreValue<StoredBatchSession>(id);
  if (!record) return null;

  return {
    session: parseBatchSession(record.session),
    rootHandle: record.rootHandle ?? null,
  };
}

export async function deleteBatchSessionRecord(id: string): Promise<void> {
  await deleteStoreValue(id);
  writeSummaries(readSummaries().filter((entry) => entry.id !== id));
}

/** Drops every stored session; used when the operator clears the workspace. */
export async function clearStoredBatchSessions(): Promise<void> {
  const summaries = readSummaries();
  writeSummaries([]);

  for (const summary of summaries) {
    try {
      await deleteStoreValue(summary.id);
    } catch {
      // A store that cannot be opened has nothing to clean up.
    }
  }
}
