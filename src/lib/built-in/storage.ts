import type {
  ChipConfigSlice,
  PreprocessImageKind,
  PreprocessProject,
  PreprocessSourceImage,
  SourceAssetsSlice,
  TissueSelectionSlice,
} from '@/types/built-in';
import {
  PREPROCESS_DB_NAME,
  PREPROCESS_DB_VERSION,
  PREPROCESS_SOURCE_IMAGE_STORE,
  PREPROCESS_STORAGE_KEY,
  PREPROCESS_STORAGE_SCHEMA_VERSION,
  PREPROCESS_THUMBNAIL_STORE,
  PREPROCESS_WORKING_IMAGE_STORE,
} from '@/lib/built-in/constants';
import { migratePreprocessProject } from './migrations';
import { createThumbnailBlob, createWorkingProxyBlobFromSource, loadImageElement } from '@/lib/built-in/sourceImage';

declare global {
  interface Window {
    __PREPROCESS_TEST_FORCE_QUOTA__?: boolean;
  }
}

type StoredSourceImage = Omit<
  PreprocessSourceImage,
  | 'sourceBlob'
  | 'thumbnailBlob'
  | 'workingBlob'
  | 'objectUrl'
  | 'thumbnailObjectUrl'
  | 'workingObjectUrl'
  | 'dataUrl'
  | 'thumbnailDataUrl'
  | 'workingDataUrl'
>;

type StoredSourceAssetsSlice = Omit<SourceAssetsSlice, 'images'> & {
  images: { he: StoredSourceImage | null };
};

type StoredChipConfigSlice = Omit<ChipConfigSlice, 'projectedSpots'> & {
  projectedSpots: null;
};

export type PreprocessProjectMeta = Omit<
  PreprocessProject,
  'sourceAssets' | 'chipConfig'
> & {
  sourceAssets: StoredSourceAssetsSlice;
  chipConfig: StoredChipConfigSlice;
};

export type PreprocessProjectSummary = Pick<
  PreprocessProjectMeta,
  'id' | 'name' | 'createdAt' | 'updatedAt' | 'currentStep' | 'sourceAssets'
>;

export type PreprocessPersistMode = 'full' | 'metadata' | 'tissue';

const isBrowser = () => typeof window !== 'undefined';

const openDb = async () => new Promise<IDBDatabase>((resolve, reject) => {
  if (!isBrowser()) {
    reject(new Error('IndexedDB unavailable on server'));
    return;
  }

  const request = window.indexedDB.open(PREPROCESS_DB_NAME, PREPROCESS_DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(PREPROCESS_SOURCE_IMAGE_STORE)) {
      db.createObjectStore(PREPROCESS_SOURCE_IMAGE_STORE);
    }
    if (!db.objectStoreNames.contains(PREPROCESS_THUMBNAIL_STORE)) {
      db.createObjectStore(PREPROCESS_THUMBNAIL_STORE);
    }
    if (!db.objectStoreNames.contains(PREPROCESS_WORKING_IMAGE_STORE)) {
      db.createObjectStore(PREPROCESS_WORKING_IMAGE_STORE);
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

const readRawProjects = (): unknown[] => {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(PREPROCESS_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as unknown[];
  } catch (error) {
    console.error('Failed to parse preprocess projects', error);
    return [];
  }
};

const persistMetas = (metas: PreprocessProjectMeta[]) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(PREPROCESS_STORAGE_KEY, JSON.stringify(metas));
};

const assetStoreKey = (projectId: string, kind: PreprocessImageKind) => `${projectId}:${kind}`;
const thumbnailStoreKey = (projectId: string, kind: PreprocessImageKind) => `${projectId}:${kind}-thumbnail`;
const workingStoreKey = (projectId: string, kind: PreprocessImageKind) => `${projectId}:${kind}-working`;

const saveStoreValue = async (storeName: string, key: string, value: string | Blob) => {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value, key);
  await txDone(tx);
};

const readStoreValue = async (storeName: string, key: string): Promise<string | Blob | undefined> => {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  const req = tx.objectStore(storeName).get(key);
  const value = await new Promise<string | Blob | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as string | Blob | undefined);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  return value ?? undefined;
};

const deleteStoreValue = async (storeName: string, key: string) => {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  await txDone(tx);
};

const urlToBlob = async (url: string) => {
  const response = await fetch(url);
  return response.blob();
};

const stripSourcePayload = (image: PreprocessSourceImage | null): StoredSourceImage | null => {
  if (!image) return null;
  const {
    dataUrl,
    thumbnailDataUrl,
    workingDataUrl,
    objectUrl,
    thumbnailObjectUrl,
    workingObjectUrl,
    sourceBlob,
    thumbnailBlob,
    workingBlob,
    ...rest
  } = image;
  void dataUrl;
  void thumbnailDataUrl;
  void workingDataUrl;
  void objectUrl;
  void thumbnailObjectUrl;
  void workingObjectUrl;
  void sourceBlob;
  void thumbnailBlob;
  void workingBlob;
  return rest;
};

const toProjectMeta = (project: PreprocessProject): PreprocessProjectMeta => ({
  ...project,
  storageVersion: project.storageVersion ?? PREPROCESS_STORAGE_SCHEMA_VERSION,
  sourceAssets: {
    ...project.sourceAssets,
    images: {
      he: stripSourcePayload(project.sourceAssets.images.he),
    },
  },
  chipConfig: {
    ...project.chipConfig,
    // projectedSpots are recomputed in the UI after load; never persist them.
    projectedSpots: null,
  },
  // tissueSelection (including its matrix) is persisted verbatim in metadata.
});

const hydrateSourcePayload = (payload: string | Blob | undefined) => {
  if (!payload) return null;
  if (payload instanceof Blob) {
    const objectUrl = URL.createObjectURL(payload);
    return {
      blob: payload,
      displayUrl: objectUrl,
      objectUrl,
    };
  }

  return {
    blob: undefined,
    displayUrl: payload,
    objectUrl: undefined,
  };
};

const hydrateSourceImage = async (
  meta: StoredSourceImage | null,
  storedSource: string | Blob | undefined,
  storedThumbnail: string | Blob | undefined,
  storedWorking: string | Blob | undefined,
): Promise<{
  image: PreprocessSourceImage | null;
  thumbnailRegenerated: boolean;
  workingRegenerated: boolean;
}> => {
  if (!meta) return { image: null, thumbnailRegenerated: false, workingRegenerated: false };

  const source = hydrateSourcePayload(storedSource);
  if (!source) return { image: null, thumbnailRegenerated: false, workingRegenerated: false };
  const thumbnail = hydrateSourcePayload(storedThumbnail);
  const working = hydrateSourcePayload(storedWorking);

  let thumbnailBlob = thumbnail?.blob;
  let thumbnailObjectUrl = thumbnail?.objectUrl;
  let thumbnailDataUrl = thumbnail?.displayUrl;
  let thumbnailRegenerated = false;
  let workingBlob = working?.blob;
  let workingObjectUrl = working?.objectUrl;
  let workingDataUrl = working?.displayUrl;
  let workingWidth = meta.workingWidth;
  let workingHeight = meta.workingHeight;
  let workingRegenerated = false;

  if (!thumbnailDataUrl && source.displayUrl) {
    try {
      const generatedBlob = await createThumbnailBlob(source.displayUrl);
      thumbnailBlob = generatedBlob;
      thumbnailObjectUrl = URL.createObjectURL(generatedBlob);
      thumbnailDataUrl = thumbnailObjectUrl;
      thumbnailRegenerated = true;
    } catch (error) {
      void error;
    }
  }

  if (!workingDataUrl && source.displayUrl) {
    try {
      const sourceImage = await loadImageElement(source.displayUrl);
      const generatedProxy = await createWorkingProxyBlobFromSource(
        sourceImage,
        sourceImage.naturalWidth,
        sourceImage.naturalHeight,
      );
      workingBlob = generatedProxy.blob;
      workingObjectUrl = URL.createObjectURL(generatedProxy.blob);
      workingDataUrl = workingObjectUrl;
      workingWidth = generatedProxy.width;
      workingHeight = generatedProxy.height;
      workingRegenerated = true;
    } catch (error) {
      void error;
    }
  }

  return {
    image: {
      ...meta,
      sourceBlob: source.blob,
      thumbnailBlob,
      workingBlob,
      objectUrl: source.objectUrl,
      thumbnailObjectUrl,
      workingObjectUrl,
      dataUrl: source.displayUrl,
      thumbnailDataUrl,
      workingDataUrl,
      workingWidth,
      workingHeight,
    },
    thumbnailRegenerated,
    workingRegenerated,
  };
};

const syncImageStores = async (
  projectId: string,
  image: PreprocessSourceImage | null,
  kind: PreprocessImageKind,
) => {
  const sourceKey = assetStoreKey(projectId, kind);
  const thumbnailKey = thumbnailStoreKey(projectId, kind);
  const workingKey = workingStoreKey(projectId, kind);
  const sourcePayload = image?.sourceBlob ?? (image?.dataUrl?.startsWith('data:') ? await urlToBlob(image.dataUrl) : undefined);
  const thumbnailPayload = image?.thumbnailBlob ?? (image?.thumbnailDataUrl?.startsWith('data:') ? await urlToBlob(image.thumbnailDataUrl) : undefined);
  const workingPayload = image?.workingBlob ?? (image?.workingDataUrl?.startsWith('data:') ? await urlToBlob(image.workingDataUrl) : undefined);

  if (sourcePayload) {
    await saveStoreValue(PREPROCESS_SOURCE_IMAGE_STORE, sourceKey, sourcePayload);
  } else {
    await deleteStoreValue(PREPROCESS_SOURCE_IMAGE_STORE, sourceKey);
  }

  if (thumbnailPayload) {
    await saveStoreValue(PREPROCESS_THUMBNAIL_STORE, thumbnailKey, thumbnailPayload);
  } else {
    await deleteStoreValue(PREPROCESS_THUMBNAIL_STORE, thumbnailKey);
  }

  if (workingPayload) {
    await saveStoreValue(PREPROCESS_WORKING_IMAGE_STORE, workingKey, workingPayload);
  } else {
    await deleteStoreValue(PREPROCESS_WORKING_IMAGE_STORE, workingKey);
  }
};

const hydrateProject = async (meta: PreprocessProjectMeta): Promise<PreprocessProject | undefined> => {
  const [
    heSource,
    heThumbnail,
    heWorking,
  ] = await Promise.all([
    readStoreValue(PREPROCESS_SOURCE_IMAGE_STORE, assetStoreKey(meta.id, 'he')),
    readStoreValue(PREPROCESS_THUMBNAIL_STORE, thumbnailStoreKey(meta.id, 'he')),
    readStoreValue(PREPROCESS_WORKING_IMAGE_STORE, workingStoreKey(meta.id, 'he')),
  ]);

  const heResult = await hydrateSourceImage(
    meta.sourceAssets.images.he,
    heSource,
    heThumbnail,
    heWorking,
  );
  const he = heResult.image;

  if (meta.sourceAssets.images.he && !he) return undefined;

  if ((heResult.thumbnailRegenerated || heResult.workingRegenerated) && he) {
    await syncImageStores(meta.id, he, 'he');
  }

  const project = migratePreprocessProject({
    ...meta,
    sourceAssets: {
      ...meta.sourceAssets,
      images: {
        he,
      },
    },
    chipConfig: {
      ...meta.chipConfig,
      projectedSpots: null,
    },
    tissueSelection: meta.tissueSelection as TissueSelectionSlice,
  });

  return {
    ...project,
    chipConfig: {
      ...project.chipConfig,
      projectedSpots: null,
    },
  };
};

const readMetas = async (): Promise<PreprocessProjectMeta[]> => readRawProjects() as PreprocessProjectMeta[];

export const upsertPreprocessProjectMetadata = (project: PreprocessProject) => {
  const metas = readRawProjects() as PreprocessProjectMeta[];
  const migratedProject = migratePreprocessProject(project);
  const meta = toProjectMeta(migratedProject);
  const index = metas.findIndex((entry) => entry.id === project.id);
  if (index >= 0) {
    metas[index] = meta;
  } else {
    metas.unshift(meta);
  }
  persistMetas(metas);
  return migratedProject;
};

export async function readPreprocessProjectSummaries(): Promise<PreprocessProjectSummary[]> {
  const metas = await readMetas();
  return metas.map((meta) => ({
    id: meta.id,
    name: meta.name,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    currentStep: meta.currentStep,
    sourceAssets: meta.sourceAssets,
  }));
}

export async function upsertPreprocessProject(
  project: PreprocessProject,
  options?: { mode?: PreprocessPersistMode },
) {
  if (
    typeof window !== 'undefined'
    && process.env.NODE_ENV !== 'production'
    && window.__PREPROCESS_TEST_FORCE_QUOTA__ === true
  ) {
    window.__PREPROCESS_TEST_FORCE_QUOTA__ = false;
    throw new DOMException('Synthetic preprocess quota failure', 'QuotaExceededError');
  }

  const mode = options?.mode ?? 'full';
  const previousMetadata = isBrowser()
    ? window.localStorage.getItem(PREPROCESS_STORAGE_KEY)
    : null;

  const migratedProject = upsertPreprocessProjectMetadata(project);

  if (mode === 'metadata' || mode === 'tissue') {
    return;
  }

  try {
    await syncImageStores(migratedProject.id, migratedProject.sourceAssets.images.he, 'he');
  } catch (error) {
    if (isBrowser()) {
      if (previousMetadata === null) {
        window.localStorage.removeItem(PREPROCESS_STORAGE_KEY);
      } else {
        window.localStorage.setItem(PREPROCESS_STORAGE_KEY, previousMetadata);
      }
    }
    throw error;
  }
}

export async function getPreprocessProject(projectId: string): Promise<PreprocessProject | undefined> {
  const metas = await readMetas();
  const meta = metas.find((entry) => entry.id === projectId);
  if (!meta) return undefined;
  return hydrateProject(meta);
}

export async function deletePreprocessProject(projectId: string) {
  const metas = await readMetas();
  persistMetas(metas.filter((entry) => entry.id !== projectId));
  await Promise.all([
    deleteStoreValue(PREPROCESS_SOURCE_IMAGE_STORE, assetStoreKey(projectId, 'he')),
    deleteStoreValue(PREPROCESS_THUMBNAIL_STORE, thumbnailStoreKey(projectId, 'he')),
    deleteStoreValue(PREPROCESS_WORKING_IMAGE_STORE, workingStoreKey(projectId, 'he')),
  ]);
}
