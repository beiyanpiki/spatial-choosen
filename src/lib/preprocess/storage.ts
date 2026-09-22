import type {
  AlignmentSlice,
  ChipConfigSlice,
  ExportStateSlice,
  PreprocessCropAssetScale,
  PreprocessImageKind,
  PreprocessProject,
  PreprocessSourceImage,
  ProjectedSpot,
  SourceAssetsSlice,
  TissueActivationMatrix,
  TissueSelectionSlice,
} from '@/types/preprocess';
import { loadChipConfigData } from './chipConfigs';
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
  PREPROCESS_TISSUE_SELECTION_STORE,
  PREPROCESS_WORKING_IMAGE_STORE,
} from '@/lib/preprocess/constants';
import { migratePreprocessProject } from './migrations';
import { createThumbnailBlob, createWorkingProxyBlobFromSource, loadImageElement } from '@/lib/preprocess/sourceImage';
import { matrixFromSelectedSpotIds, validateTissueActivationMatrix } from './tissueMatrix';

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

type LegacyStoredSourceImage = StoredSourceImage & {
  dataUrl?: string;
  thumbnailDataUrl?: string;
  workingDataUrl?: string;
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
  | keyof StoredCropQcCanonicalCropState
  | 'eosinPreviewDataUrl'
  | 'previewDataUrl'
  | 'checkerboardPreviewDataUrl'
  | 'checkerboardPreview'
  | 'featureMatchesPreviewDataUrl'
  | 'featureMatchesPreview'
> & StoredCropQcCanonicalCropState & {
  eosinPreviewDataUrl: null;
  previewDataUrl: null;
  checkerboardPreviewDataUrl: null;
  checkerboardPreview: {
    dataUrl: string | null;
  };
  featureMatchesPreviewDataUrl: string | null;
  featureMatchesPreview: {
    dataUrl: string | null;
  };
};

type StoredTissueSelectionSlice = Omit<
  TissueSelectionSlice,
  | 'forcedInSpotIds'
  | 'forcedOutSpotIds'
  | 'overrideNotice'
  | 'regions'
  | 'selectedRegionId'
  | 'previewDataUrl'
  | 'selectedSpotIds'
  | 'matrix'
  | 'autoSelectedSpotIds'
> & {
  previewDataUrl: null;
  selectedSpotIds: null;
  matrix: null;
  autoSelectedSpotIds: null;
};

export type StoredTissueSelectionPayloadV1 = {
  version: 1;
  tissueUpdatedAt: string | null;
  matrix: TissueActivationMatrix | null;
  autoSelectedSpotIds: string[];
};

type ParsedTissueSelectionPayload =
  | { canonical: StoredTissueSelectionPayloadV1 }
  | { legacy: string[] }
  | { invalid: true };

type StoredProjectedSpotIndexEntry = {
  id: string;
  arrayRow: number;
  arrayCol: number;
};

type StoredChipConfigSlice = Omit<ChipConfigSlice, 'projectedSpots'> & {
  projectedSpots: null;
  projectedSpotIndex: StoredProjectedSpotIndexEntry[] | null;
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
  chipConfig: StoredChipConfigSlice;
  tissueSelection: StoredTissueSelectionSlice;
  exportState: Omit<ExportStateSlice, 'artifacts'> & { artifacts: [] };
};

export type PreprocessProjectSummary = Pick<
  PreprocessProjectMeta,
  'id' | 'name' | 'createdAt' | 'updatedAt' | 'currentStep' | 'sourceAssets'
>;

export type PreprocessPersistMode = 'full' | 'metadata' | 'tissue';

const isBrowser = () => typeof window !== 'undefined';

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
);

const parseTissueActivationMatrix = (value: unknown): TissueActivationMatrix | null | undefined => {
  if (value === null) {
    return null;
  }

  if (!isPlainObject(value) || !Array.isArray(value.values)) {
    return undefined;
  }

  try {
    return validateTissueActivationMatrix({
      rows: value.rows,
      columns: value.columns,
      values: value.values,
    } as TissueActivationMatrix);
  } catch {
    return undefined;
  }
};

const parseLegacyTissueSelectionPayload = (value: unknown) => (
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : null
);

export const toStoredTissueSelectionPayload = (
  tissueSelection: PreprocessProject['tissueSelection'],
): StoredTissueSelectionPayloadV1 => ({
  version: 1,
  tissueUpdatedAt: tissueSelection.updatedAt ?? null,
  matrix: tissueSelection.matrix ? validateTissueActivationMatrix(tissueSelection.matrix) : null,
  autoSelectedSpotIds: [...tissueSelection.autoSelectedSpotIds],
});

export const parseTissueSelectionPayload = (rawValue: unknown): ParsedTissueSelectionPayload => {
  if (typeof rawValue !== 'string') {
    return { invalid: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue) as unknown;
  } catch {
    return { invalid: true };
  }

  const legacy = parseLegacyTissueSelectionPayload(parsed);
  if (legacy) {
    return { legacy };
  }

  if (Array.isArray(parsed)) {
    return { invalid: true };
  }

  if (!isPlainObject(parsed)) {
    return { invalid: true };
  }

  if (parsed.version !== 1) {
    return { invalid: true };
  }

  if (typeof parsed.tissueUpdatedAt !== 'string' && parsed.tissueUpdatedAt !== null) {
    return { invalid: true };
  }

  if (!Array.isArray(parsed.autoSelectedSpotIds) || !parsed.autoSelectedSpotIds.every((item) => typeof item === 'string')) {
    return { invalid: true };
  }

  const matrix = parseTissueActivationMatrix(parsed.matrix);
  if (matrix === undefined) {
    return { invalid: true };
  }

  return {
    canonical: {
      version: 1,
      tissueUpdatedAt: parsed.tissueUpdatedAt,
      matrix,
      autoSelectedSpotIds: parsed.autoSelectedSpotIds,
    },
  };
};

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
    if (!db.objectStoreNames.contains(PREPROCESS_DERIVED_IMAGE_STORE)) {
      db.createObjectStore(PREPROCESS_DERIVED_IMAGE_STORE);
    }
    if (!db.objectStoreNames.contains(PREPROCESS_TISSUE_SELECTION_STORE)) {
      db.createObjectStore(PREPROCESS_TISSUE_SELECTION_STORE);
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

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const normalizeStoredCropRect = (value: PreprocessProject['cropQc']['cropRect']) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const rect = value as Partial<NonNullable<PreprocessProject['cropQc']['cropRect']>>;
  return isFiniteNumber(rect.x)
    && isFiniteNumber(rect.y)
    && isFiniteNumber(rect.width)
    && isFiniteNumber(rect.height)
    ? {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      }
    : null;
};

const normalizeStoredCropGeometry = (
  value: PreprocessProject['cropQc']['eosinReferenceGeometry'],
) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const geometry = value as Partial<NonNullable<PreprocessProject['cropQc']['eosinReferenceGeometry']>>;
  const rect = normalizeStoredCropRect(geometry.rect ?? null);
  return rect !== null && isFiniteNumber(geometry.width) && isFiniteNumber(geometry.height)
    ? {
        rect,
        width: geometry.width,
        height: geometry.height,
      }
    : null;
};

const normalizeStoredLegacyCropGeometry = (
  cropRect: PreprocessProject['cropQc']['cropRect'],
  cropWidth: PreprocessProject['cropQc']['cropWidth'],
  cropHeight: PreprocessProject['cropQc']['cropHeight'],
) => {
  const rect = normalizeStoredCropRect(cropRect);
  return rect !== null && isFiniteNumber(cropWidth) && isFiniteNumber(cropHeight)
    ? {
        rect,
        width: cropWidth,
        height: cropHeight,
      }
    : null;
};

type CropGeometryCarrier = {
  storageVersion?: number;
  cropQc: {
    status: PreprocessProject['cropQc']['status'];
    eosinReferenceGeometry?: PreprocessProject['cropQc']['eosinReferenceGeometry'];
    cropRect: PreprocessProject['cropQc']['cropRect'];
    cropWidth: PreprocessProject['cropQc']['cropWidth'];
    cropHeight: PreprocessProject['cropQc']['cropHeight'];
  };
};

const repairCurrentSchemaCropGeometry = <TProject extends {
  storageVersion?: number;
  cropQc: CropGeometryCarrier['cropQc'];
}>(project: TProject): TProject => {
	if ((project.storageVersion ?? 0) < PREPROCESS_STORAGE_SCHEMA_VERSION) {
		return project;
	}

	const canUseLegacyGeometryFallback = project.cropQc.status !== 'stale';
	const eosinReferenceGeometry = normalizeStoredCropGeometry(project.cropQc.eosinReferenceGeometry)
		?? (canUseLegacyGeometryFallback
			? normalizeStoredLegacyCropGeometry(
					project.cropQc.cropRect,
          project.cropQc.cropWidth,
					project.cropQc.cropHeight,
				)
			: null);
	// Keep emitted HE fullres dimensions when present; use source-frame geometry evidence only as fallback.
	const cropWidth = isFiniteNumber(project.cropQc.cropWidth)
		? project.cropQc.cropWidth
		: eosinReferenceGeometry?.width ?? null;
	const cropHeight = isFiniteNumber(project.cropQc.cropHeight)
		? project.cropQc.cropHeight
		: eosinReferenceGeometry?.height ?? null;

  return {
    ...project,
    cropQc: {
      ...project.cropQc,
      eosinReferenceGeometry,
      cropRect: eosinReferenceGeometry?.rect ?? null,
      cropWidth,
      cropHeight,
    },
  };
};

const selectedSpotIdsFromStoredIndex = (
  matrix: PreprocessProject['tissueSelection']['matrix'],
  projectedSpotIndex: StoredProjectedSpotIndexEntry[] | null,
) => {
  if (!matrix || !projectedSpotIndex) {
    return null;
  }

  return projectedSpotIndex.flatMap((spot) => {
    if (
      !Number.isInteger(spot.arrayRow)
      || !Number.isInteger(spot.arrayCol)
      || spot.arrayRow < 1
      || spot.arrayRow > matrix.rows
      || spot.arrayCol < 1
      || spot.arrayCol > matrix.columns
    ) {
      return [];
    }

    const index = (spot.arrayRow - 1) * matrix.columns + (spot.arrayCol - 1);
    return matrix.values[index] === 1 ? [spot.id] : [];
  });
};

const INVALID_TISSUE_SELECTION_PAYLOAD_MESSAGE = 'Invalid stored tissue selection payload';

const repairProjectedSpotIndex = async (
  chipConfig: StoredChipConfigSlice,
): Promise<StoredProjectedSpotIndexEntry[] | null> => {
  if (chipConfig.projectedSpotIndex) {
    return chipConfig.projectedSpotIndex;
  }

  if (!chipConfig.rows || !chipConfig.columns) {
    return null;
  }

  if (chipConfig.chipType !== '50um' && chipConfig.chipType !== '15um') {
    return null;
  }

  const chipConfigData = await loadChipConfigData(chipConfig.chipType);

  return chipConfigData.templateEntries
    .filter((entry) => (
      (chipConfig.rows === null || entry.arrayRow <= chipConfig.rows)
      && (chipConfig.columns === null || entry.arrayCol <= chipConfig.columns)
    ))
    .map((entry) => ({
      id: entry.barcode,
      arrayRow: entry.arrayRow,
      arrayCol: entry.arrayCol,
    }));
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
const cropQcFeatureMatchesDerivedImageStoreKey = (projectId: string) => `${projectId}:crop-qc:feature-matches`;

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
      featureMatchesPreviewDataUrl: null,
      featureMatchesPreview: {
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
    featureMatchesPreviewDataUrl: null,
    featureMatchesPreview: {
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
  eosinReferenceGeometry: null,
  heQcGeometry: null,
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
  featureMatchesPreviewDataUrl: null,
  featureMatchesPreview: {
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
  const legacyCropQc = cropQc as unknown as PreprocessProject['cropQc'];

  for (const kind of PREPROCESS_SOURCE_IMAGE_KINDS) {
    for (const level of PREPROCESS_CANONICAL_CROP_ASSET_LEVELS) {
      cropAssetPayloads[kind][level] = await readStoreValue(
        PREPROCESS_DERIVED_IMAGE_STORE,
        cropQcDerivedImageStoreKey(projectId, kind, level),
      );
    }
  }

  const checkerboardPayload = await readStoreValue(
    PREPROCESS_DERIVED_IMAGE_STORE,
    cropQcCheckerboardDerivedImageStoreKey(projectId),
  );
  const featureMatchesPayload = await readStoreValue(
    PREPROCESS_DERIVED_IMAGE_STORE,
    cropQcFeatureMatchesDerivedImageStoreKey(projectId),
  );
  const eosinCropAssets = await hydrateCropAssetSet(cropAssetPayloads.eosin, legacyCropQc.cropAssets?.eosin);
  const heCropAssets = await hydrateCropAssetSet(cropAssetPayloads.he, legacyCropQc.cropAssets?.he);
  const checkerboardPreviewDataUrl = await hydrateDerivedImagePayload(
    checkerboardPayload ?? legacyCropQc.checkerboardPreviewDataUrl ?? legacyCropQc.checkerboardPreview?.dataUrl ?? undefined,
  );
  const featureMatchesPreviewDataUrl = await hydrateDerivedImagePayload(
    featureMatchesPayload ?? legacyCropQc.featureMatchesPreviewDataUrl ?? legacyCropQc.featureMatchesPreview?.dataUrl ?? undefined,
  );

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
      featureMatchesPreviewDataUrl,
      featureMatchesPreview: {
        dataUrl: featureMatchesPreviewDataUrl,
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
      eosinReferenceGeometry: null,
      heQcGeometry: null,
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
      featureMatchesPreviewDataUrl: null,
      featureMatchesPreview: {
        dataUrl: null,
      },
    };
  }

  return clearHydratedCropQc(cropQc);
};

const toProjectedSpotIndex = (projectedSpots: ProjectedSpot[] | null | undefined) => projectedSpots?.map((spot) => ({
  id: spot.id,
  arrayRow: spot.arrayRow,
  arrayCol: spot.arrayCol,
})) ?? null;

const toProjectMeta = (
  projectInput: PreprocessProject,
  fallbackProjectedSpots?: ProjectedSpot[] | null,
  fallbackTissueSelection?: PreprocessProject['tissueSelection'],
): PreprocessProjectMeta => {
  const project: PreprocessProject = {
    ...projectInput,
    chipConfig: {
      ...projectInput.chipConfig,
      projectedSpots: projectInput.chipConfig.projectedSpots ?? fallbackProjectedSpots ?? null,
    },
  };

  return {
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
      projectedSpotIndex: toProjectedSpotIndex(project.chipConfig.projectedSpots)
        ?? toProjectedSpotIndex(fallbackProjectedSpots)
        ?? ((project.chipConfig as StoredChipConfigSlice).projectedSpotIndex ?? null),
    },
    tissueSelection: (({
      forcedInSpotIds: _forcedInSpotIds,
      forcedOutSpotIds: _forcedOutSpotIds,
      overrideNotice: _overrideNotice,
      regions: _regions,
      selectedRegionId: _selectedRegionId,
      previewDataUrl: _previewDataUrl,
      matrix: _matrix,
      autoSelectedSpotIds: _autoSelectedSpotIds,
      ...canonicalTissueSelection
    }) => ({
      ...canonicalTissueSelection,
      supportState: fallbackTissueSelection?.supportState ?? projectInput.tissueSelection.supportState,
      unsupportedReason: fallbackTissueSelection?.unsupportedReason ?? projectInput.tissueSelection.unsupportedReason,
      previewDataUrl: null,
      selectedSpotIds: null,
      matrix: null,
      autoSelectedSpotIds: null,
    }))(project.tissueSelection),
    exportState: {
      ...project.exportState,
      artifacts: [],
    },
  };
};

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

  const legacyMeta = meta as LegacyStoredSourceImage;
  const source = hydrateSourcePayload(storedSource ?? legacyMeta.dataUrl);
  if (!source) return { image: null, thumbnailRegenerated: false, workingRegenerated: false };
  const thumbnail = hydrateSourcePayload(storedThumbnail ?? legacyMeta.thumbnailDataUrl);
  const working = hydrateSourcePayload(storedWorking ?? legacyMeta.workingDataUrl);

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

const hydrateDerivedImagePayload = async (payload: string | Blob | undefined) => {
  if (!payload) return null;
  if (payload instanceof Blob) {
    return URL.createObjectURL(payload);
  }
  if (payload.startsWith('blob:')) {
    return null;
  }
  return payload;
};

const hydrateProject = async (meta: PreprocessProjectMeta): Promise<PreprocessProject | undefined> => {
  const repairedMeta = repairCurrentSchemaCropGeometry(meta);
  const [
    eosinDataUrl,
    heDataUrl,
    eosinThumbnailDataUrl,
    heThumbnailDataUrl,
    eosinWorkingDataUrl,
    heWorkingDataUrl,
    focusedHePayload,
    cropQc,
  ] = await Promise.all([
    readStoreValue(PREPROCESS_SOURCE_IMAGE_STORE, assetStoreKey(repairedMeta.id, 'eosin')),
    readStoreValue(PREPROCESS_SOURCE_IMAGE_STORE, assetStoreKey(repairedMeta.id, 'he')),
    readStoreValue(PREPROCESS_THUMBNAIL_STORE, assetStoreKey(repairedMeta.id, 'eosin')),
    readStoreValue(PREPROCESS_THUMBNAIL_STORE, assetStoreKey(repairedMeta.id, 'he')),
    readStoreValue(PREPROCESS_WORKING_IMAGE_STORE, assetStoreKey(repairedMeta.id, 'eosin')),
    readStoreValue(PREPROCESS_WORKING_IMAGE_STORE, assetStoreKey(repairedMeta.id, 'he')),
    readStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, heFocusDerivedImageStoreKey(repairedMeta.id)),
    hydrateCropQcSlice(repairedMeta.id, repairedMeta.cropQc),
  ]);

  const [eosinResult, heResult] = await Promise.all([
    hydrateSourceImage(repairedMeta.sourceAssets.images.eosin, eosinDataUrl, eosinThumbnailDataUrl, eosinWorkingDataUrl),
    hydrateSourceImage(repairedMeta.sourceAssets.images.he, heDataUrl, heThumbnailDataUrl, heWorkingDataUrl),
  ]);
  const eosin = eosinResult.image;
  const he = heResult.image;
  const focusedImageDataUrl = await hydrateDerivedImagePayload(focusedHePayload ?? repairedMeta.heFocus?.focusedImageDataUrl ?? undefined);

  if (repairedMeta.sourceAssets.images.eosin && !eosin) return undefined;
  if (repairedMeta.sourceAssets.images.he && !he) return undefined;

  const writes: Promise<void>[] = [];
  if ((eosinResult.thumbnailRegenerated || eosinResult.workingRegenerated) && eosin) {
    writes.push(syncImageStores(repairedMeta.id, eosin, 'eosin'));
  }
  if ((heResult.thumbnailRegenerated || heResult.workingRegenerated) && he) {
    writes.push(syncImageStores(repairedMeta.id, he, 'he'));
  }

  const repairedProjectedSpotIndex = await repairProjectedSpotIndex(repairedMeta.chipConfig);

  const storedTissueSelection = await readTissueSelectionStore(repairedMeta.id);
  let autoSelectedSpotIds: string[] = [];
  let matrix: TissueActivationMatrix | null = null;
  let runtimeSelectedSpotIds: string[] | null = null;
  let invalidTissueSelectionPayload = false;

  if (storedTissueSelection && 'canonical' in storedTissueSelection) {
    autoSelectedSpotIds = [...storedTissueSelection.canonical.autoSelectedSpotIds];
    matrix = storedTissueSelection.canonical.matrix;
    runtimeSelectedSpotIds = matrix
      ? selectedSpotIdsFromStoredIndex(matrix, repairedProjectedSpotIndex)
      : null;
  } else if (storedTissueSelection && 'legacy' in storedTissueSelection) {
    autoSelectedSpotIds = storedTissueSelection.legacy;
    matrix = autoSelectedSpotIds.length > 0 && repairedMeta.chipConfig.rows && repairedMeta.chipConfig.columns && repairedProjectedSpotIndex
      ? matrixFromSelectedSpotIds({
          rows: repairedMeta.chipConfig.rows,
          columns: repairedMeta.chipConfig.columns,
          projectedSpots: repairedProjectedSpotIndex.map((entry) => ({
            id: entry.id,
            barcode: entry.id,
            arrayRow: entry.arrayRow,
            arrayCol: entry.arrayCol,
            x: 0,
            y: 0,
            chipX: 0,
            chipY: 0,
            imageX: 0,
            imageY: 0,
            diameterX: 0,
            diameterY: 0,
          })) as ProjectedSpot[],
          selectedSpotIds: autoSelectedSpotIds,
        })
      : null;
    runtimeSelectedSpotIds = matrix && repairedProjectedSpotIndex
      ? selectedSpotIdsFromStoredIndex(matrix, repairedProjectedSpotIndex)
      : null;
  } else if (storedTissueSelection && 'invalid' in storedTissueSelection) {
    invalidTissueSelectionPayload = true;
  }

  const project = migratePreprocessProject({
    ...repairedMeta,
    sourceAssets: {
      ...repairedMeta.sourceAssets,
      images: {
        eosin,
        he,
      },
    },
    heFocus: repairedMeta.heFocus
      ? {
          ...repairedMeta.heFocus,
          focusedImageDataUrl,
        }
      : repairedMeta.heFocus,
    cropQc,
    chipConfig: {
      ...repairedMeta.chipConfig,
      projectedSpots: null,
    },
    tissueSelection: {
      ...repairedMeta.tissueSelection,
      autoSelectedSpotIds: [],
    } as TissueSelectionSlice,
  });

  const hydratedProject = {
    ...project,
    chipConfig: (({
      projectedSpotIndex: _projectedSpotIndex,
      ...runtimeChipConfig
    }) => ({
      ...runtimeChipConfig,
      projectedSpots: null,
    }))(project.chipConfig as PreprocessProject['chipConfig'] & {
      projectedSpotIndex?: StoredProjectedSpotIndexEntry[] | null;
    }),
    tissueSelection: (({
      forcedInSpotIds: _forcedInSpotIds,
      forcedOutSpotIds: _forcedOutSpotIds,
      overrideNotice: _overrideNotice,
      regions: _regions,
      selectedRegionId: _selectedRegionId,
      previewDataUrl: _previewDataUrl,
      ...runtimeTissueSelection
    }) => ({
      ...runtimeTissueSelection,
      ...(invalidTissueSelectionPayload
        ? {
            status: 'stale' as const,
            isStale: true,
            warning: INVALID_TISSUE_SELECTION_PAYLOAD_MESSAGE,
            error: INVALID_TISSUE_SELECTION_PAYLOAD_MESSAGE,
          }
        : {}),
      matrix,
      selectedSpotIds: runtimeSelectedSpotIds,
      autoSelectedSpotIds,
    }))(project.tissueSelection),
  };

  if (writes.length > 0) {
    await Promise.all(writes);
  }

  return hydratedProject;
};

const readMetas = async (): Promise<PreprocessProjectMeta[]> => readRawProjects() as PreprocessProjectMeta[];

export const upsertPreprocessProjectMetadata = (project: PreprocessProject) => {
  const metas = readRawProjects() as PreprocessProjectMeta[];
  const repairedProject = repairCurrentSchemaCropGeometry(project);
  const migratedProject = migratePreprocessProject(repairedProject);
  const meta = toProjectMeta(
    migratedProject,
    repairedProject.chipConfig.projectedSpots,
    repairedProject.tissueSelection,
  );
  const index = metas.findIndex((entry) => entry.id === project.id);
  if (index >= 0) {
    metas[index] = meta;
  } else {
    metas.unshift(meta);
  }
  persistMetas(metas);
  return migratedProject;
};

const syncImageStores = async (projectId: string, image: PreprocessSourceImage | null, kind: PreprocessImageKind) => {
  const key = assetStoreKey(projectId, kind);
  const sourcePayload = image?.sourceBlob ?? (image?.dataUrl?.startsWith('data:') ? await urlToBlob(image.dataUrl) : undefined);
  const thumbnailPayload = image?.thumbnailBlob ?? (image?.thumbnailDataUrl?.startsWith('data:') ? await urlToBlob(image.thumbnailDataUrl) : undefined);
  const workingPayload = image?.workingBlob ?? (image?.workingDataUrl?.startsWith('data:') ? await urlToBlob(image.workingDataUrl) : undefined);

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

  if (workingPayload) {
    await saveStoreValue(PREPROCESS_WORKING_IMAGE_STORE, key, workingPayload);
  } else {
    await deleteStoreValue(PREPROCESS_WORKING_IMAGE_STORE, key);
  }
};

const syncDerivedImageStore = async (key: string, dataUrl: string | null) => {
  if (!dataUrl) {
    await deleteStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, key);
    return;
  }

  let payload: Blob;
  try {
    payload = await urlToBlob(dataUrl);
  } catch (error) {
    // Blob: preview URLs are transient view pointers — page code revokes them
    // as soon as they leave project state, so a fallback persist of an older
    // snapshot can reference an already-revoked URL. Keep the previously stored
    // payload (hydration prefers this store anyway) instead of aborting the
    // whole snapshot save.
    console.warn('Skipping derived image sync; source URL is no longer readable.', key, error);
    return;
  }

  await saveStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, key, payload);
};

const syncCropQcDerivedImageStores = async (projectId: string, cropQc: PreprocessProject['cropQc']) => {
  for (const kind of PREPROCESS_SOURCE_IMAGE_KINDS) {
    for (const level of PREPROCESS_CANONICAL_CROP_ASSET_LEVELS) {
      await syncDerivedImageStore(
        cropQcDerivedImageStoreKey(projectId, kind, level),
        hasCanonicalCropAssets(cropQc) ? cropQc.cropAssets[kind][level].dataUrl : null,
      );
    }
  }

  await syncDerivedImageStore(
    cropQcCheckerboardDerivedImageStoreKey(projectId),
    hasCanonicalCropAssets(cropQc) ? cropQc.checkerboardPreview?.dataUrl ?? null : null,
  );

  await syncDerivedImageStore(
    cropQcFeatureMatchesDerivedImageStoreKey(projectId),
    hasCanonicalCropAssets(cropQc) ? cropQc.featureMatchesPreview?.dataUrl ?? null : null,
  );
};

const tissueSelectionStoreKey = (projectId: string) => `${projectId}:tissue-selection`;

const syncTissueSelectionStore = async (
  projectId: string,
  tissueSelection: PreprocessProject['tissueSelection'],
) => {
  const key = tissueSelectionStoreKey(projectId);
  const payload = toStoredTissueSelectionPayload(tissueSelection);
  const existing = await readTissueSelectionStore(projectId);

  if (
    existing
    && 'canonical' in existing
    && existing.canonical.tissueUpdatedAt !== null
    && payload.tissueUpdatedAt !== null
    && existing.canonical.tissueUpdatedAt > payload.tissueUpdatedAt
  ) {
    return;
  }

  await saveStoreValue(PREPROCESS_TISSUE_SELECTION_STORE, key, JSON.stringify(payload));
};

const readTissueSelectionStore = async (
  projectId: string,
): Promise<ParsedTissueSelectionPayload | undefined> => {
  const key = tissueSelectionStoreKey(projectId);
  const value = await readStoreValue(PREPROCESS_TISSUE_SELECTION_STORE, key);
  if (value === undefined) {
    return undefined;
  }
  return parseTissueSelectionPayload(value);
};

export async function readPreprocessProjects(): Promise<PreprocessProject[]> {
  const metas = await readMetas();
  const hydrated = await Promise.all(metas.map((meta) => hydrateProject(meta)));
  return hydrated.filter((project): project is PreprocessProject => Boolean(project));
}

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

  if (mode === 'tissue') {
    const metas = readRawProjects() as PreprocessProjectMeta[];
    const existingMeta = metas.find((entry) => entry.id === project.id);
    const previousMetadata = window.localStorage.getItem(PREPROCESS_STORAGE_KEY);
    let metadataUpdated = false;
    if (!existingMeta || existingMeta.updatedAt <= project.updatedAt) {
      upsertPreprocessProjectMetadata(project);
      metadataUpdated = true;
    }
    try {
      await syncTissueSelectionStore(project.id, project.tissueSelection);
    } catch (error) {
      if (metadataUpdated) {
        if (previousMetadata === null) {
          window.localStorage.removeItem(PREPROCESS_STORAGE_KEY);
        } else {
          window.localStorage.setItem(PREPROCESS_STORAGE_KEY, previousMetadata);
        }
      }
      throw error;
    }
    return;
  }

  const migratedProject = upsertPreprocessProjectMetadata(project);

  if (mode === 'metadata') {
    return;
  }

  await Promise.all([
    ...PREPROCESS_SOURCE_IMAGE_KINDS.map((kind) => syncImageStores(migratedProject.id, migratedProject.sourceAssets.images[kind], kind)),
    syncDerivedImageStore(heFocusDerivedImageStoreKey(migratedProject.id), migratedProject.heFocus.focusedImageDataUrl),
    syncCropQcDerivedImageStores(migratedProject.id, migratedProject.cropQc),
    syncTissueSelectionStore(migratedProject.id, project.tissueSelection),
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
        deleteStoreValue(PREPROCESS_WORKING_IMAGE_STORE, assetStoreKey(projectId, kind)),
        ...PREPROCESS_CANONICAL_CROP_ASSET_LEVELS.map((level) => deleteStoreValue(
          PREPROCESS_DERIVED_IMAGE_STORE,
          cropQcDerivedImageStoreKey(projectId, kind, level),
        )),
      ]),
      deleteStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, heFocusDerivedImageStoreKey(projectId)),
      deleteStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, cropQcCheckerboardDerivedImageStoreKey(projectId)),
      deleteStoreValue(PREPROCESS_DERIVED_IMAGE_STORE, cropQcFeatureMatchesDerivedImageStoreKey(projectId)),
      deleteStoreValue(PREPROCESS_TISSUE_SELECTION_STORE, tissueSelectionStoreKey(projectId)),
    ],
  );
}
