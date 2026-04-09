import type {
  AlignmentSlice,
  ChipConfigSlice,
  ExportStateSlice,
  PreprocessCropAssetScale,
  PreprocessImageKind,
  PreprocessProject,
  PreprocessSourceImage,
  SourceAssetsSlice,
  TissueSelectionSlice,
} from '../../types/preprocess';
import {
  PREPROCESS_CANONICAL_CROP_ASSET_LEVELS,
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

type StoredCropQcCanonicalAsset = {
  dataUrl: null;
};

type StoredCropQcCanonicalAssetSet = Record<PreprocessCropAssetScale, StoredCropQcCanonicalAsset>;

type StoredCropQcCanonicalCropState =
  | {
      cropAssets: {
        eosin: null;
        he: null;
      };
      tissue_hires_scalef: null;
      tissue_lowres_scalef: null;
      spot_diameter_fullres: null;
      fiducial_diameter_fullres: null;
    }
  | {
      cropAssets: {
        eosin: StoredCropQcCanonicalAssetSet;
        he: StoredCropQcCanonicalAssetSet;
      };
      tissue_hires_scalef: number;
      tissue_lowres_scalef: number;
      spot_diameter_fullres: number | null;
      fiducial_diameter_fullres: number;
    };

type StoredCropQcSlice = Omit<
  PreprocessProject['cropQc'],
  keyof StoredCropQcCanonicalCropState | 'eosinPreviewDataUrl' | 'previewDataUrl' | 'checkerboardPreviewDataUrl' | 'checkerboardPreview'
> & StoredCropQcCanonicalCropState & {
  eosinPreviewDataUrl: null;
  previewDataUrl: null;
  checkerboardPreviewDataUrl: null;
  checkerboardPreview: {
    dataUrl: null;
  };
};

type CanonicalCropQcAssets = {
  cropAssets: {
    eosin: NonNullable<NonNullable<PreprocessProject['cropQc']['cropAssets']>['eosin']>;
    he: NonNullable<NonNullable<PreprocessProject['cropQc']['cropAssets']>['he']>;
  };
  tissue_hires_scalef: number;
  tissue_lowres_scalef: number;
  spot_diameter_fullres: number | null;
  fiducial_diameter_fullres: number;
};

type HydratedCropQcSlice = PreprocessProject['cropQc'] & {
  hydrationMissingCanonicalAssets?: boolean;
};

type DerivedCropAssetPayloadMap = Record<
  PreprocessImageKind,
  Record<PreprocessCropAssetScale, string | Blob | undefined>
>;

export type PreprocessProjectMeta = Omit<
  PreprocessProject,
  'sourceAssets' | 'heFocus' | 'alignment' | 'cropQc' | 'chipConfig' | 'tissueSelection' | 'exportState'
> & {
  sourceAssets: StoredSourceAssetsSlice;
  heFocus: StoredHeFocusSlice;
  alignment: Omit<AlignmentSlice, 'previewDataUrl'> & { previewDataUrl: null };
  cropQc: StoredCropQcSlice;
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
const heFocusDerivedImageStoreKey = (projectId: string) => `${projectId}:he-focus`;
const cropQcDerivedImageStoreKey = (
  projectId: string,
  kind: PreprocessImageKind,
  level: PreprocessCropAssetScale,
) => `${projectId}:crop-qc:${kind}:${level}`;
const cropQcCheckerboardDerivedImageStoreKey = (projectId: string) => `${projectId}:crop-qc:checkerboard`;

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

const createStoredCropQcCanonicalAssetSet = (): StoredCropQcCanonicalAssetSet => PREPROCESS_CANONICAL_CROP_ASSET_LEVELS.reduce(
  (assets, level) => {
    assets[level] = { dataUrl: null };
    return assets;
  },
  {} as StoredCropQcCanonicalAssetSet,
);

const hasCanonicalCropAssets = (
  cropQc: PreprocessProject['cropQc'],
): cropQc is PreprocessProject['cropQc'] & CanonicalCropQcAssets => (
  cropQc.cropAssets?.eosin !== null
  && cropQc.cropAssets?.eosin !== undefined
  && cropQc.cropAssets.he !== null
  && cropQc.cropAssets.he !== undefined
  && typeof cropQc.tissue_hires_scalef === 'number'
  && typeof cropQc.tissue_lowres_scalef === 'number'
  && (cropQc.spot_diameter_fullres === null || typeof cropQc.spot_diameter_fullres === 'number')
  && typeof cropQc.fiducial_diameter_fullres === 'number'
);

const stripCropQcPayload = (cropQc: PreprocessProject['cropQc']): StoredCropQcSlice => {
  if (hasCanonicalCropAssets(cropQc)) {
    return {
      ...cropQc,
      cropAssets: {
        eosin: createStoredCropQcCanonicalAssetSet(),
        he: createStoredCropQcCanonicalAssetSet(),
      },
      tissue_hires_scalef: cropQc.tissue_hires_scalef,
      tissue_lowres_scalef: cropQc.tissue_lowres_scalef,
      spot_diameter_fullres: cropQc.spot_diameter_fullres,
      fiducial_diameter_fullres: cropQc.fiducial_diameter_fullres,
      eosinPreviewDataUrl: null,
      previewDataUrl: null,
      checkerboardPreviewDataUrl: null,
      checkerboardPreview: {
        dataUrl: null,
      },
    };
  }

  return {
    ...cropQc,
    cropAssets: {
      eosin: null,
      he: null,
    },
    tissue_hires_scalef: null,
    tissue_lowres_scalef: null,
    spot_diameter_fullres: null,
    fiducial_diameter_fullres: null,
    eosinPreviewDataUrl: null,
    previewDataUrl: null,
    checkerboardPreviewDataUrl: null,
    checkerboardPreview: {
      dataUrl: null,
    },
  };
};

const createEmptyDerivedCropAssetPayloadMap = (): DerivedCropAssetPayloadMap => PREPROCESS_SOURCE_IMAGE_KINDS.reduce(
  (payloads, kind) => {
    payloads[kind] = PREPROCESS_CANONICAL_CROP_ASSET_LEVELS.reduce(
      (kindPayloads, level) => {
        kindPayloads[level] = undefined;
        return kindPayloads;
      },
      {} as Record<PreprocessCropAssetScale, string | Blob | undefined>,
    );
    return payloads;
  },
  {} as DerivedCropAssetPayloadMap,
);

const hydrateCropAssetSet = async (
  payloads: Record<PreprocessCropAssetScale, string | Blob | undefined>,
  fallbackAssetSet: CanonicalCropQcAssets['cropAssets']['eosin'] | null | undefined,
): Promise<CanonicalCropQcAssets['cropAssets']['eosin'] | null> => {
  const entries = await Promise.all(
    PREPROCESS_CANONICAL_CROP_ASSET_LEVELS.map(async (level) => {
      const dataUrl = await hydrateDerivedImagePayload(payloads[level] ?? fallbackAssetSet?.[level].dataUrl ?? undefined);
      return dataUrl ? [level, { dataUrl }] as const : null;
    }),
  );

  if (entries.some((entry) => entry === null)) {
    return null;
  }

  return Object.fromEntries(
    entries as Array<readonly [PreprocessCropAssetScale, { dataUrl: string }]>,
  ) as CanonicalCropQcAssets['cropAssets']['eosin'];
};

const clearHydratedCropQc = (cropQc: StoredCropQcSlice): HydratedCropQcSlice => ({
  ...cropQc,
  status: 'stale',
  isStale: true,
  cropRect: null,
  cropWidth: null,
  cropHeight: null,
  cropAssets: {
    eosin: null,
    he: null,
  },
  tissue_hires_scalef: null,
  tissue_lowres_scalef: null,
  spot_diameter_fullres: null,
  fiducial_diameter_fullres: null,
  eosinPreviewDataUrl: null,
  previewDataUrl: null,
  checkerboardPreviewDataUrl: null,
  checkerboardPreview: {
    dataUrl: null,
  },
  qcAccepted: false,
  issues: [],
  hydrationMissingCanonicalAssets: true,
});

const hydrateCropQcSlice = async (
  projectId: string,
  cropQc: StoredCropQcSlice,
): Promise<HydratedCropQcSlice> => {
  const cropAssetPayloads = createEmptyDerivedCropAssetPayloadMap();
  const cropAssetEntries = await Promise.all(
    PREPROCESS_SOURCE_IMAGE_KINDS.flatMap((kind) => PREPROCESS_CANONICAL_CROP_ASSET_LEVELS.map(async (level) => ({
      kind,
      level,
      payload: await readStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, cropQcDerivedImageStoreKey(projectId, kind, level)),
    }))),
  );
  const legacyCropQc = cropQc as unknown as PreprocessProject['cropQc'];

  cropAssetEntries.forEach(({ kind, level, payload }) => {
    cropAssetPayloads[kind][level] = payload;
  });

  const checkerboardPayload = await readStoreValue(
    PREPROCESS_DERIVED_IMAGE_STORE,
    cropQcCheckerboardDerivedImageStoreKey(projectId),
  );
  const [eosinCropAssets, heCropAssets, checkerboardPreviewDataUrl] = await Promise.all([
    hydrateCropAssetSet(cropAssetPayloads.eosin, legacyCropQc.cropAssets?.eosin),
    hydrateCropAssetSet(cropAssetPayloads.he, legacyCropQc.cropAssets?.he),
    hydrateDerivedImagePayload(
      checkerboardPayload ?? legacyCropQc.checkerboardPreview?.dataUrl ?? legacyCropQc.checkerboardPreviewDataUrl ?? undefined,
    ),
  ]);

  if (eosinCropAssets && heCropAssets) {
    return {
      ...cropQc,
      cropAssets: {
        eosin: eosinCropAssets,
        he: heCropAssets,
      },
      eosinPreviewDataUrl: eosinCropAssets.fullres.dataUrl,
      previewDataUrl: heCropAssets.fullres.dataUrl,
      checkerboardPreviewDataUrl: checkerboardPreviewDataUrl,
      checkerboardPreview: {
        dataUrl: checkerboardPreviewDataUrl,
      },
    };
  }

  const expectsCanonicalAssets = cropQc.cropAssets.eosin !== null
    || cropQc.cropAssets.he !== null
    || legacyCropQc.cropAssets?.eosin !== null
    || legacyCropQc.cropAssets?.he !== null;

  if (!expectsCanonicalAssets) {
    return {
      ...cropQc,
      cropAssets: {
        eosin: null,
        he: null,
      },
      tissue_hires_scalef: null,
      tissue_lowres_scalef: null,
      spot_diameter_fullres: null,
      fiducial_diameter_fullres: null,
      eosinPreviewDataUrl: null,
      previewDataUrl: null,
      checkerboardPreviewDataUrl: null,
      checkerboardPreview: {
        dataUrl: null,
      },
    };
  }

  return clearHydratedCropQc(cropQc);
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
  cropQc: stripCropQcPayload(project.cropQc),
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
  const [eosinDataUrl, heDataUrl, eosinThumbnailDataUrl, heThumbnailDataUrl, focusedHePayload, cropQc] = await Promise.all([
    readStoreValue(PREPROCESS_SOURCE_IMAGE_STORE, assetStoreKey(meta.id, 'eosin')),
    readStoreValue(PREPROCESS_SOURCE_IMAGE_STORE, assetStoreKey(meta.id, 'he')),
    readStoreValue(PREPROCESS_THUMBNAIL_STORE, assetStoreKey(meta.id, 'eosin')),
    readStoreValue(PREPROCESS_THUMBNAIL_STORE, assetStoreKey(meta.id, 'he')),
    readStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, heFocusDerivedImageStoreKey(meta.id)),
    hydrateCropQcSlice(meta.id, meta.cropQc),
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
    cropQc,
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

const syncDerivedImageStore = async (key: string, dataUrl: string | null) => {
  const payload = dataUrl ? await urlToBlob(dataUrl) : undefined;

  if (payload) {
    await saveStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, key, payload);
    return;
  }

  await deleteStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, key);
};

const syncCropQcDerivedImageStores = async (projectId: string, cropQc: PreprocessProject['cropQc']) => {
  const syncs = PREPROCESS_SOURCE_IMAGE_KINDS.flatMap((kind) => PREPROCESS_CANONICAL_CROP_ASSET_LEVELS.map((level) => syncDerivedImageStore(
    cropQcDerivedImageStoreKey(projectId, kind, level),
    hasCanonicalCropAssets(cropQc) ? cropQc.cropAssets[kind][level].dataUrl : null,
  )));

  syncs.push(syncDerivedImageStore(
    cropQcCheckerboardDerivedImageStoreKey(projectId),
    hasCanonicalCropAssets(cropQc) ? cropQc.checkerboardPreview?.dataUrl ?? null : null,
  ));

  await Promise.all(syncs);
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
    syncDerivedImageStore(heFocusDerivedImageStoreKey(migratedProject.id), migratedProject.heFocus.focusedImageDataUrl),
    syncCropQcDerivedImageStores(migratedProject.id, migratedProject.cropQc),
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
        ...PREPROCESS_CANONICAL_CROP_ASSET_LEVELS.map((level) => deleteStoreValue(
          PREPROCESS_DERIVED_IMAGE_STORE,
          cropQcDerivedImageStoreKey(projectId, kind, level),
        )),
      ]),
      deleteStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, heFocusDerivedImageStoreKey(projectId)),
      deleteStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, cropQcCheckerboardDerivedImageStoreKey(projectId)),
    ],
  );
}
