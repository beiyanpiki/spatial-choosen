import type {
  AlignmentSlice,
  ChipConfigSlice,
  ExportStateSlice,
  PreprocessImageKind,
  PreprocessProject,
  PreprocessSourceImage,
  SourceAssetsSlice,
  TissueSelectionSlice,
} from '../../types/preprocess';
import {
  PREPROCESS_DB_NAME,
  PREPROCESS_DB_VERSION,
  PREPROCESS_DERIVED_IMAGE_STORE,
  PREPROCESS_SOURCE_IMAGE_KINDS,
  PREPROCESS_SOURCE_IMAGE_STORE,
  PREPROCESS_STORAGE_KEY,
  PREPROCESS_STORAGE_SCHEMA_VERSION,
  PREPROCESS_THUMBNAIL_STORE,
} from './constants';
import { migratePreprocessProject } from './migrations';

declare global {
  interface Window {
    __PREPROCESS_TEST_FORCE_QUOTA__?: boolean;
  }
}

type StoredSourceImage = Omit<
  PreprocessSourceImage,
  'sourceBlob' | 'thumbnailBlob' | 'objectUrl' | 'thumbnailObjectUrl' | 'dataUrl' | 'thumbnailDataUrl'
>;

type LegacyStoredSourceImage = StoredSourceImage & {
  dataUrl?: string;
  thumbnailDataUrl?: string;
};

type StoredSourceAssetsSlice = Omit<SourceAssetsSlice, 'images'> & {
  images: Record<PreprocessImageKind, StoredSourceImage | null>;
};

type StoredHeFocusSlice = Omit<PreprocessProject['heFocus'], 'focusedImageDataUrl'> & {
  focusedImageDataUrl: null;
};

export type PreprocessProjectMeta = Omit<
  PreprocessProject,
  'sourceAssets' | 'heFocus' | 'alignment' | 'cropQc' | 'chipConfig' | 'tissueSelection' | 'exportState'
> & {
  sourceAssets: StoredSourceAssetsSlice;
  heFocus: StoredHeFocusSlice;
  alignment: Omit<AlignmentSlice, 'previewDataUrl'> & { previewDataUrl: null };
  cropQc: PreprocessProject['cropQc'] & {
    eosinPreviewDataUrl: null;
    previewDataUrl: null;
    checkerboardPreviewDataUrl: null;
  };
  chipConfig: Omit<ChipConfigSlice, 'projectedSpots'> & { projectedSpots: null };
  tissueSelection: Omit<TissueSelectionSlice, 'previewDataUrl' | 'selectedSpotIds'> & {
    previewDataUrl: null;
    selectedSpotIds: null;
  };
  exportState: Omit<ExportStateSlice, 'artifacts'> & { artifacts: [] };
};

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
    if (!db.objectStoreNames.contains(PREPROCESS_DERIVED_IMAGE_STORE)) {
      db.createObjectStore(PREPROCESS_DERIVED_IMAGE_STORE);
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
const derivedImageStoreKey = (projectId: string) => `${projectId}:he-focus`;

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
  const { dataUrl, thumbnailDataUrl, objectUrl, thumbnailObjectUrl, sourceBlob, thumbnailBlob, ...rest } = image;
  void dataUrl;
  void thumbnailDataUrl;
  void objectUrl;
  void thumbnailObjectUrl;
  void sourceBlob;
  void thumbnailBlob;
  return rest;
};

const toProjectMeta = (project: PreprocessProject): PreprocessProjectMeta => ({
  ...project,
  storageVersion: project.storageVersion ?? PREPROCESS_STORAGE_SCHEMA_VERSION,
  sourceAssets: {
    ...project.sourceAssets,
    images: {
      eosin: stripSourcePayload(project.sourceAssets.images.eosin),
      he: stripSourcePayload(project.sourceAssets.images.he),
    },
  },
  heFocus: {
    ...project.heFocus,
    focusedImageDataUrl: null,
  },
  alignment: {
    ...project.alignment,
    previewDataUrl: null,
  },
  cropQc: {
    ...project.cropQc,
    eosinPreviewDataUrl: null,
    previewDataUrl: null,
    checkerboardPreviewDataUrl: null,
  },
  chipConfig: {
    ...project.chipConfig,
    projectedSpots: null,
  },
  tissueSelection: {
    ...project.tissueSelection,
    previewDataUrl: null,
    selectedSpotIds: null,
  },
  exportState: {
    ...project.exportState,
    artifacts: [],
  },
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

const hydrateSourceImage = (
  meta: StoredSourceImage | null,
  storedSource: string | Blob | undefined,
  storedThumbnail: string | Blob | undefined,
): PreprocessSourceImage | null => {
  if (!meta) return null;

  const legacyMeta = meta as LegacyStoredSourceImage;
  const source = hydrateSourcePayload(storedSource ?? legacyMeta.dataUrl);
  if (!source) return null;
  const thumbnail = hydrateSourcePayload(storedThumbnail ?? legacyMeta.thumbnailDataUrl);

  return {
    ...meta,
    sourceBlob: source.blob,
    thumbnailBlob: thumbnail?.blob,
    objectUrl: source.objectUrl,
    thumbnailObjectUrl: thumbnail?.objectUrl,
    dataUrl: source.displayUrl,
    thumbnailDataUrl: thumbnail?.displayUrl,
  };
};

const hydrateDerivedImagePayload = async (payload: string | Blob | undefined) => {
  if (!payload) return null;
  if (payload instanceof Blob) {
    return URL.createObjectURL(payload);
  }
  return payload;
};

const hydrateProject = async (meta: PreprocessProjectMeta): Promise<PreprocessProject | undefined> => {
  const [eosinDataUrl, heDataUrl, eosinThumbnailDataUrl, heThumbnailDataUrl, focusedHePayload] = await Promise.all([
    readStoreValue(PREPROCESS_SOURCE_IMAGE_STORE, assetStoreKey(meta.id, 'eosin')),
    readStoreValue(PREPROCESS_SOURCE_IMAGE_STORE, assetStoreKey(meta.id, 'he')),
    readStoreValue(PREPROCESS_THUMBNAIL_STORE, assetStoreKey(meta.id, 'eosin')),
    readStoreValue(PREPROCESS_THUMBNAIL_STORE, assetStoreKey(meta.id, 'he')),
    readStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, derivedImageStoreKey(meta.id)),
  ]);

  const eosin = hydrateSourceImage(meta.sourceAssets.images.eosin, eosinDataUrl, eosinThumbnailDataUrl);
  const he = hydrateSourceImage(meta.sourceAssets.images.he, heDataUrl, heThumbnailDataUrl);
  const focusedImageDataUrl = await hydrateDerivedImagePayload(focusedHePayload ?? meta.heFocus?.focusedImageDataUrl ?? undefined);

  if (meta.sourceAssets.images.eosin && !eosin) return undefined;
  if (meta.sourceAssets.images.he && !he) return undefined;

  return migratePreprocessProject({
    ...meta,
    sourceAssets: {
      ...meta.sourceAssets,
      images: {
        eosin,
        he,
      },
    },
    heFocus: meta.heFocus
      ? {
          ...meta.heFocus,
          focusedImageDataUrl,
        }
      : meta.heFocus,
  });
};

const readMetas = async (): Promise<PreprocessProjectMeta[]> => readRawProjects() as PreprocessProjectMeta[];

const syncImageStores = async (projectId: string, image: PreprocessSourceImage | null, kind: PreprocessImageKind) => {
  const key = assetStoreKey(projectId, kind);
  const sourcePayload = image?.sourceBlob ?? (image?.dataUrl?.startsWith('data:') ? await urlToBlob(image.dataUrl) : undefined);
  const thumbnailPayload = image?.thumbnailBlob ?? (image?.thumbnailDataUrl?.startsWith('data:') ? await urlToBlob(image.thumbnailDataUrl) : undefined);

  if (sourcePayload) {
    await saveStoreValue(PREPROCESS_SOURCE_IMAGE_STORE, key, sourcePayload);
  } else {
    await deleteStoreValue(PREPROCESS_SOURCE_IMAGE_STORE, key);
  }

  if (thumbnailPayload) {
    await saveStoreValue(PREPROCESS_THUMBNAIL_STORE, key, thumbnailPayload);
  } else {
    await deleteStoreValue(PREPROCESS_THUMBNAIL_STORE, key);
  }
};

const syncDerivedImageStore = async (projectId: string, focusedImageDataUrl: string | null) => {
  const key = derivedImageStoreKey(projectId);
  const payload = focusedImageDataUrl ? await urlToBlob(focusedImageDataUrl) : undefined;

  if (payload) {
    await saveStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, key, payload);
    return;
  }

  await deleteStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, key);
};

export async function readPreprocessProjects(): Promise<PreprocessProject[]> {
  const metas = await readMetas();
  const hydrated = await Promise.all(metas.map((meta) => hydrateProject(meta)));
  return hydrated.filter((project): project is PreprocessProject => Boolean(project));
}

export async function upsertPreprocessProject(project: PreprocessProject) {
  if (
    typeof window !== 'undefined'
    && process.env.NODE_ENV !== 'production'
    && window.__PREPROCESS_TEST_FORCE_QUOTA__ === true
  ) {
    window.__PREPROCESS_TEST_FORCE_QUOTA__ = false;
    throw new DOMException('Synthetic preprocess quota failure', 'QuotaExceededError');
  }

  const metas = await readMetas();
  const migratedProject = migratePreprocessProject(project);
  const meta = toProjectMeta(migratedProject);
  const index = metas.findIndex((entry) => entry.id === project.id);
  if (index >= 0) {
    metas[index] = meta;
  } else {
    metas.unshift(meta);
  }
  persistMetas(metas);

  await Promise.all([
    ...PREPROCESS_SOURCE_IMAGE_KINDS.map((kind) => syncImageStores(migratedProject.id, migratedProject.sourceAssets.images[kind], kind)),
    syncDerivedImageStore(migratedProject.id, migratedProject.heFocus.focusedImageDataUrl),
  ]);
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
  await Promise.all(
    [
      ...PREPROCESS_SOURCE_IMAGE_KINDS.flatMap((kind) => [
        deleteStoreValue(PREPROCESS_SOURCE_IMAGE_STORE, assetStoreKey(projectId, kind)),
        deleteStoreValue(PREPROCESS_THUMBNAIL_STORE, assetStoreKey(projectId, kind)),
      ]),
      deleteStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, derivedImageStoreKey(projectId)),
    ],
  );
}
