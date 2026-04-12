import JSZip from 'jszip';
import type {
  LegacyPreprocessProject,
  PreprocessImageKind,
  PreprocessProject,
  PreprocessSourceImage,
  PreprocessStepId,
} from '../../types/preprocess';
import {
  PREPROCESS_DB_NAME,
  PREPROCESS_DERIVED_IMAGE_STORE,
  PREPROCESS_STORAGE_KEY,
} from './constants';
import { migratePreprocessProject } from './migrations';

export const PACKAGE_VERSION = 3;

type PackagedSourceImage = Omit<
  PreprocessSourceImage,
  'sourceBlob' | 'thumbnailBlob' | 'objectUrl' | 'thumbnailObjectUrl' | 'dataUrl' | 'thumbnailDataUrl'
>;

type PreprocessPackagedProject = Omit<
  PreprocessProject,
  "sourceAssets" | "heFocus" | "alignment" | "cropQc" | "chipConfig" | "tissueSelection" | "exportState"
> & {
  sourceAssets: Omit<PreprocessProject["sourceAssets"], "images"> & {
    images: Record<PreprocessImageKind, PackagedSourceImage | null>;
  };
  heFocus: Omit<PreprocessProject["heFocus"], "focusedImageDataUrl"> & {
    focusedImageDataUrl: null;
  };
  alignment: Omit<PreprocessProject["alignment"], "previewDataUrl"> & { previewDataUrl: null };
  cropQc: Omit<
    PreprocessProject["cropQc"],
    | "eosinPreviewDataUrl"
    | "previewDataUrl"
    | "checkerboardPreviewDataUrl"
    | "featureMatchesPreviewDataUrl"
    | "checkerboardPreview"
    | "featureMatchesPreview"
  > & {
    eosinPreviewDataUrl: null;
    previewDataUrl: null;
    checkerboardPreviewDataUrl: null;
    checkerboardPreview: {
      dataUrl: null;
    };
    featureMatchesPreviewDataUrl: null;
    featureMatchesPreview: {
      dataUrl: null;
    };
  };
  chipConfig: Omit<PreprocessProject["chipConfig"], "projectedSpots"> & { projectedSpots: null };
  tissueSelection: Omit<PreprocessProject["tissueSelection"], "previewDataUrl" | "selectedSpotIds"> & {
    previewDataUrl: null;
    selectedSpotIds: null;
  };
  exportState: Omit<PreprocessProject["exportState"], "artifacts"> & { artifacts: [] };
};

type LegacyPreprocessPackagedProject = Omit<PreprocessPackagedProject, 'heFocus'> & {
  heFocus?: PreprocessPackagedProject['heFocus'];
};

type PreprocessPackageV1 = {
  version: 1;
  project: LegacyPreprocessPackagedProject;
};

type PreprocessPackageV2 = {
  version: 2;
  project: LegacyPreprocessPackagedProject;
};

type PreprocessPackageV3 = {
  version: typeof PACKAGE_VERSION;
  project: PreprocessPackagedProject;
};

type PreprocessPackage = PreprocessPackageV1 | PreprocessPackageV2 | PreprocessPackageV3;

const isBrowser = () => typeof window !== "undefined";

const stripRuntimeImageState = (image: PreprocessSourceImage | null): PackagedSourceImage | null => {
  if (!image) return null;
  const { sourceBlob, thumbnailBlob, objectUrl, thumbnailObjectUrl, dataUrl, thumbnailDataUrl, ...rest } = image;
  void sourceBlob;
  void thumbnailBlob;
  void objectUrl;
  void thumbnailObjectUrl;
  void dataUrl;
  void thumbnailDataUrl;
  return rest;
};

const toPackagedProject = (project: PreprocessProject): PreprocessPackagedProject => ({
  ...project,
  sourceAssets: {
    ...project.sourceAssets,
    images: {
      eosin: stripRuntimeImageState(project.sourceAssets.images.eosin),
      he: stripRuntimeImageState(project.sourceAssets.images.he),
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
    checkerboardPreview: {
      dataUrl: null,
    },
    featureMatchesPreviewDataUrl: null,
    featureMatchesPreview: {
      dataUrl: null,
    },
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

const packageSourcePath = (kind: PreprocessImageKind) => `source-assets/${kind}`;
const packageHeFocusPath = () => 'derived-assets/he-focus';
const packageHeFocusStoreKey = (projectId: string) => `${projectId}:he-focus`;

const openPackagedAssetDb = async () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = window.indexedDB.open(PREPROCESS_DB_NAME);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const readPackagedStoreValue = async (storeName: string, key: string): Promise<string | Blob | undefined> => {
  const db = await openPackagedAssetDb();
  if (!db.objectStoreNames.contains(storeName)) {
    db.close();
    return undefined;
  }

  const tx = db.transaction(storeName, 'readonly');
  const req = tx.objectStore(storeName).get(key);
  const value = await new Promise<string | Blob | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as string | Blob | undefined);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  return value ?? undefined;
};

const readLegacyFocusedHeImageDataUrl = (projectId: string) => {
  const raw = window.localStorage.getItem(PREPROCESS_STORAGE_KEY);
  if (!raw) return null;

  try {
    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const project = projects.find((entry) => entry.id === projectId);
    const heFocus = project && typeof project.heFocus === 'object' && project.heFocus !== null
      ? project.heFocus as Record<string, unknown>
      : null;
    return typeof heFocus?.focusedImageDataUrl === 'string'
      ? heFocus.focusedImageDataUrl
      : null;
  } catch {
    return null;
  }
};

const resolvePackagedHeFocusAsset = async (project: PreprocessProject) => {
  if (project.heFocus.focusedImageDataUrl) {
    return project.heFocus.focusedImageDataUrl;
  }

  const storedAsset = await readPackagedStoreValue(
    PREPROCESS_DERIVED_IMAGE_STORE,
    packageHeFocusStoreKey(project.id),
  );
  if (storedAsset) {
    return storedAsset;
  }

  return readLegacyFocusedHeImageDataUrl(project.id);
};

const imageUrlToBlob = async (image: PreprocessSourceImage) => {
  const source = image.sourceBlob ?? image.dataUrl ?? image.objectUrl;
  if (!source) {
    throw new Error(`Source image "${image.kind}" is missing its binary payload`);
  }
  if (source instanceof Blob) return source;
  const response = await fetch(source);
  return response.blob();
};

export async function getPreprocessPackageSourceEntries(project: PreprocessProject) {
  const sourceEntries = await Promise.all(
    (['eosin', 'he'] as const).map(async (kind) => {
      const image = project.sourceAssets.images[kind];
      if (!image) return null;
      return {
        kind,
        path: packageSourcePath(kind),
        blob: await imageUrlToBlob(image),
      };
    }),
  );

  const focusedHeAsset = await resolvePackagedHeFocusAsset(project);

  const focusedHeEntry = focusedHeAsset
    ? {
        kind: 'he-focus',
        path: packageHeFocusPath(),
        blob: focusedHeAsset instanceof Blob
          ? focusedHeAsset
          : await fetch(focusedHeAsset).then((response) => response.blob()),
      }
    : null;

  return [
    ...sourceEntries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    ...(focusedHeEntry ? [focusedHeEntry] : []),
  ];
}

const hydratePackagedSourceBlob = (image: PreprocessSourceImage, blob: Blob): PreprocessSourceImage => {
  const objectUrl = URL.createObjectURL(blob);
  return {
    ...image,
    sourceBlob: blob,
    objectUrl,
    dataUrl: objectUrl,
  };
};

const attachPackagedSourceBlobs = async (project: PreprocessProject, zip: JSZip) => {
  const images = { ...project.sourceAssets.images };

  for (const kind of ['eosin', 'he'] as const) {
    const image = images[kind];
    if (!image) continue;

    const entry = zip.file(packageSourcePath(kind));
    if (!entry) {
      throw new Error(`ZIP is missing ${packageSourcePath(kind)}`);
    }

    images[kind] = hydratePackagedSourceBlob(image, await entry.async('blob'));
  }

  return {
    ...project,
    sourceAssets: {
      ...project.sourceAssets,
      images,
    },
  };
};

const attachPackagedDerivedImage = async (project: PreprocessProject, zip: JSZip) => {
  const entry = zip.file(packageHeFocusPath());
  if (!entry) {
    return project;
  }

  return {
    ...project,
    heFocus: {
      ...project.heFocus,
      focusedImageDataUrl: URL.createObjectURL(await entry.async('blob')),
    },
  };
};

const attachPackagedAssets = async (project: PreprocessProject, zip: JSZip) => {
  const withSources = await attachPackagedSourceBlobs(project, zip);
  return attachPackagedDerivedImage(withSources, zip);
};

const assertString = (value: unknown, fieldName: string) => {
  if (typeof value !== "string") {
    throw new Error(`Project field "${fieldName}" is invalid or missing`);
  }
};

const assertObject = (value: unknown, fieldName: string) => {
  if (!value || typeof value !== "object") {
    throw new Error(`Project field "${fieldName}" is invalid or missing`);
  }
};

const assertArray = (value: unknown, fieldName: string) => {
  if (!Array.isArray(value)) {
    throw new Error(`Project field "${fieldName}" is invalid or missing`);
  }
};

const assertBoolean = (value: unknown, fieldName: string) => {
  if (typeof value !== "boolean") {
    throw new Error(`Project field "${fieldName}" is invalid or missing`);
  }
};

const assertNumber = (value: unknown, fieldName: string) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Project field "${fieldName}" is invalid or missing`);
  }
};

const assertNullableString = (value: unknown, fieldName: string) => {
  if (value !== null && typeof value !== "string") {
    throw new Error(`Project field "${fieldName}" is invalid or missing`);
  }
};

const assertNonEmptyString = (value: unknown, fieldName: string) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Project field "${fieldName}" is invalid or missing`);
  }
};

const assertPositiveNumber = (value: unknown, fieldName: string) => {
  assertNumber(value, fieldName);
  if ((value as number) <= 0) {
    throw new Error(`Project field "${fieldName}" is invalid or missing`);
  }
};

const assertNullablePositiveNumber = (value: unknown, fieldName: string) => {
  if (value === null) {
    return;
  }

  assertPositiveNumber(value, fieldName);
};

const assertPreprocessStepId = (value: unknown, fieldName: string) => {
  const allowedStepIds: readonly PreprocessStepId[] = [
    'sourceAssets',
    'localization',
    'heFocus',
    'alignment',
    'cropQc',
    'chipConfig',
    'tissueSelection',
    'exportState',
  ];

  if (typeof value !== 'string' || !allowedStepIds.includes(value as PreprocessStepId)) {
    throw new Error(`Project field "${fieldName}" is invalid or missing`);
  }
};

const assertPreprocessRect = (value: unknown, fieldName: string) => {
  assertObject(value, fieldName);
  const rect = value as Record<string, unknown>;
  assertNumber(rect.x, `${fieldName}.x`);
  assertNumber(rect.y, `${fieldName}.y`);
  assertNumber(rect.width, `${fieldName}.width`);
  assertNumber(rect.height, `${fieldName}.height`);
};

const assertPreprocessPoint = (value: unknown, fieldName: string) => {
  assertObject(value, fieldName);
  const point = value as Record<string, unknown>;
  assertNumber(point.x, `${fieldName}.x`);
  assertNumber(point.y, `${fieldName}.y`);
};

const assertPreprocessSliceBase = (value: unknown, fieldName: string) => {
  assertObject(value, fieldName);
  const slice = value as Record<string, unknown>;
  const allowedStatuses = new Set([
    "idle",
    "ready",
    "processing",
    "complete",
    "stale",
    "error",
  ]);
  if (typeof slice.status !== "string" || !allowedStatuses.has(slice.status)) {
    throw new Error(`Project field "${fieldName}.status" is invalid or missing`);
  }
  assertBoolean(slice.isStale, `${fieldName}.isStale`);
  assertNullableString(slice.updatedAt, `${fieldName}.updatedAt`);
  assertNullableString(slice.error, `${fieldName}.error`);
};

const assertSourceImageKind = (value: unknown, fieldName: string) => {
  if (value !== "eosin" && value !== "he") {
    throw new Error(`Project field "${fieldName}" is invalid or missing`);
  }
};

const assertLocalizationSlice = (value: unknown) => {
  assertPreprocessSliceBase(value, "localization");
  const slice = value as Record<string, unknown>;
  assertSourceImageKind(slice.targetImage, "localization.targetImage");
  if (slice.chipType !== null && typeof slice.chipType !== "string") {
    throw new Error('Project field "localization.chipType" is invalid or missing');
  }
  if (slice.method !== null && slice.method !== "manual" && slice.method !== "imported" && slice.method !== "bundle") {
    throw new Error('Project field "localization.method" is invalid or missing');
  }
  if (slice.chipBounds !== null) {
    assertPreprocessRect(slice.chipBounds, "localization.chipBounds");
  }
  assertArray(slice.handles, "localization.handles");
  for (const [index, handle] of (slice.handles as unknown[]).entries()) {
    assertObject(handle, `localization.handles[${index}]`);
    const item = handle as Record<string, unknown>;
    assertString(item.id, `localization.handles[${index}].id`);
    assertString(item.label, `localization.handles[${index}].label`);
    assertPreprocessPoint(item.point, `localization.handles[${index}].point`);
  }
  if (slice.boxColor !== "green" && slice.boxColor !== "white") {
    throw new Error('Project field "localization.boxColor" is invalid or missing');
  }
  assertObject(slice.imageTransform, "localization.imageTransform");
  const transform = slice.imageTransform as Record<string, unknown>;
  assertNumber(transform.rotationDegrees, "localization.imageTransform.rotationDegrees");
  assertBoolean(transform.flipHorizontal, "localization.imageTransform.flipHorizontal");
  assertBoolean(transform.flipVertical, "localization.imageTransform.flipVertical");
  assertNumber(transform.scale, "localization.imageTransform.scale");
};

const assertHeFocusSlice = (value: unknown) => {
  assertPreprocessSliceBase(value, 'heFocus');
  const slice = value as Record<string, unknown>;
  if (slice.targetImage !== 'he') {
    throw new Error('Project field "heFocus.targetImage" is invalid or missing');
  }
  if (slice.chipBounds !== null) {
    assertPreprocessRect(slice.chipBounds, 'heFocus.chipBounds');
  }
  assertArray(slice.handles, 'heFocus.handles');
  for (const [index, handle] of (slice.handles as unknown[]).entries()) {
    assertObject(handle, `heFocus.handles[${index}]`);
    const item = handle as Record<string, unknown>;
    assertString(item.id, `heFocus.handles[${index}].id`);
    assertString(item.label, `heFocus.handles[${index}].label`);
    assertPreprocessPoint(item.point, `heFocus.handles[${index}].point`);
  }
  assertObject(slice.imageTransform, 'heFocus.imageTransform');
  const transform = slice.imageTransform as Record<string, unknown>;
  assertNumber(transform.rotationDegrees, 'heFocus.imageTransform.rotationDegrees');
  assertBoolean(transform.flipHorizontal, 'heFocus.imageTransform.flipHorizontal');
  assertBoolean(transform.flipVertical, 'heFocus.imageTransform.flipVertical');
  assertNumber(transform.scale, 'heFocus.imageTransform.scale');
  assertNullableString(slice.focusedImageDataUrl, 'heFocus.focusedImageDataUrl');
};

const assertAlignmentSlice = (value: unknown) => {
  assertPreprocessSliceBase(value, "alignment");
  const slice = value as Record<string, unknown>;
  assertSourceImageKind(slice.referenceImage, "alignment.referenceImage");
  assertSourceImageKind(slice.movingImage, "alignment.movingImage");
  assertObject(slice.movingImageTransform, "alignment.movingImageTransform");
  const transform = slice.movingImageTransform as Record<string, unknown>;
  assertNumber(transform.rotationDegrees, "alignment.movingImageTransform.rotationDegrees");
  assertBoolean(transform.flipHorizontal, "alignment.movingImageTransform.flipHorizontal");
  assertBoolean(transform.flipVertical, "alignment.movingImageTransform.flipVertical");
  assertNumber(transform.scale, "alignment.movingImageTransform.scale");
  assertNumber(slice.overlayOpacity, "alignment.overlayOpacity");
  assertArray(slice.controlPoints, "alignment.controlPoints");
  for (const [index, controlPoint] of (slice.controlPoints as unknown[]).entries()) {
    assertObject(controlPoint, `alignment.controlPoints[${index}]`);
    const point = controlPoint as Record<string, unknown>;
    assertString(point.id, `alignment.controlPoints[${index}].id`);
    assertPreprocessPoint(point.source, `alignment.controlPoints[${index}].source`);
    assertPreprocessPoint(point.target, `alignment.controlPoints[${index}].target`);
  }
  if (slice.inlierMask !== null) {
    assertArray(slice.inlierMask, "alignment.inlierMask");
    for (const [index, flag] of (slice.inlierMask as unknown[]).entries()) {
      assertBoolean(flag, `alignment.inlierMask[${index}]`);
    }
  }
  if (slice.affineMatrix !== null) {
    assertArray(slice.affineMatrix, "alignment.affineMatrix");
    if ((slice.affineMatrix as unknown[]).length !== 6) {
      throw new Error('Project field "alignment.affineMatrix" is invalid or missing');
    }
    for (const [index, entry] of (slice.affineMatrix as unknown[]).entries()) {
      assertNumber(entry, `alignment.affineMatrix[${index}]`);
    }
  }
  if (slice.reprojectionRmse !== null) assertNumber(slice.reprojectionRmse, "alignment.reprojectionRmse");
  if (slice.inlierRatio !== null) assertNumber(slice.inlierRatio, "alignment.inlierRatio");
  if (slice.ransacReprojThreshold !== null) assertNumber(slice.ransacReprojThreshold, "alignment.ransacReprojThreshold");
  assertObject(slice.qualityFlags, "alignment.qualityFlags");
  const flags = slice.qualityFlags as Record<string, unknown>;
  for (const key of ["minPairs", "inlierRatio", "rmse", "finiteMatrix", "scaleRange", "accepted"] as const) {
    assertBoolean(flags[key], `alignment.qualityFlags.${key}`);
  }
  if (slice.failureReason !== null && !["missing-images", "insufficient-pairs", "solve-failed", "insufficient-inliers", "rmse-too-high", "invalid-matrix"].includes(slice.failureReason as string)) {
    throw new Error('Project field "alignment.failureReason" is invalid or missing');
  }
  assertNullableString(slice.previewDataUrl, "alignment.previewDataUrl");
};

const assertCropQcCanonicalAsset = (value: unknown, fieldName: string) => {
  assertObject(value, fieldName);
  const asset = value as Record<string, unknown>;
  assertNonEmptyString(asset.dataUrl, `${fieldName}.dataUrl`);
};

const assertCropQcCanonicalAssetSet = (value: unknown, fieldName: string) => {
  assertObject(value, fieldName);
  const assetSet = value as Record<string, unknown>;
  for (const level of ['fullres', 'hires', 'lowres'] as const) {
    assertCropQcCanonicalAsset(assetSet[level], `${fieldName}.${level}`);
  }
};

const hasAnyCanonicalCropField = (slice: Record<string, unknown>) => (
  'cropAssets' in slice
  || 'checkerboardPreview' in slice
  || 'featureMatchesPreview' in slice
  || 'tissue_hires_scalef' in slice
  || 'tissue_lowres_scalef' in slice
  || 'spot_diameter_fullres' in slice
  || 'fiducial_diameter_fullres' in slice
);

const assertCanonicalCropQcContract = (slice: Record<string, unknown>) => {
  assertObject(slice.cropAssets, 'cropQc.cropAssets');
  const cropAssets = slice.cropAssets as Record<string, unknown>;

  assertObject(slice.checkerboardPreview, 'cropQc.checkerboardPreview');
  const checkerboardPreview = slice.checkerboardPreview as Record<string, unknown>;
  assertNullableString(checkerboardPreview.dataUrl, 'cropQc.checkerboardPreview.dataUrl');
  assertNullableString(slice.featureMatchesPreviewDataUrl, 'cropQc.featureMatchesPreviewDataUrl');
  assertObject(slice.featureMatchesPreview, 'cropQc.featureMatchesPreview');
  const featureMatchesPreview = slice.featureMatchesPreview as Record<string, unknown>;
  assertNullableString(featureMatchesPreview.dataUrl, 'cropQc.featureMatchesPreview.dataUrl');

  const eosinAssets = cropAssets.eosin;
  const heAssets = cropAssets.he;
  const hasNoAssets = eosinAssets === null && heAssets === null;
  const hasFullAssets = eosinAssets !== null && heAssets !== null;

  if (!hasNoAssets && !hasFullAssets) {
    throw new Error('Project field "cropQc.cropAssets" is invalid or missing');
  }

  if (hasNoAssets) {
    for (const key of [
      'tissue_hires_scalef',
      'tissue_lowres_scalef',
      'spot_diameter_fullres',
      'fiducial_diameter_fullres',
    ] as const) {
      if (slice[key] !== null) {
        throw new Error(`Project field "cropQc.${key}" is invalid or missing`);
      }
    }
    if (checkerboardPreview.dataUrl !== null) {
      throw new Error('Project field "cropQc.checkerboardPreview.dataUrl" is invalid or missing');
    }
    if (featureMatchesPreview.dataUrl !== null) {
      throw new Error('Project field "cropQc.featureMatchesPreview.dataUrl" is invalid or missing');
    }
    return;
  }

  assertCropQcCanonicalAssetSet(eosinAssets, 'cropQc.cropAssets.eosin');
  assertCropQcCanonicalAssetSet(heAssets, 'cropQc.cropAssets.he');
  assertPositiveNumber(slice.tissue_hires_scalef, 'cropQc.tissue_hires_scalef');
  assertPositiveNumber(slice.tissue_lowres_scalef, 'cropQc.tissue_lowres_scalef');
  assertNullablePositiveNumber(slice.spot_diameter_fullres, 'cropQc.spot_diameter_fullres');
  assertPositiveNumber(slice.fiducial_diameter_fullres, 'cropQc.fiducial_diameter_fullres');
  if (featureMatchesPreview.dataUrl !== null) {
    throw new Error('Project field "cropQc.featureMatchesPreview.dataUrl" is invalid or missing');
  }
};

const assertLegacyCropQcContract = (slice: Record<string, unknown>) => {
  assertNullableString(slice.eosinPreviewDataUrl ?? null, 'cropQc.eosinPreviewDataUrl');
  assertNullableString(slice.previewDataUrl ?? null, 'cropQc.previewDataUrl');
  assertNullableString(slice.checkerboardPreviewDataUrl ?? null, 'cropQc.checkerboardPreviewDataUrl');
  assertNullableString(slice.featureMatchesPreviewDataUrl ?? null, 'cropQc.featureMatchesPreviewDataUrl');
};

const assertCropQcSlice = (value: unknown) => {
  assertPreprocessSliceBase(value, "cropQc");
  const slice = value as Record<string, unknown>;
  if (slice.cropRect !== null) assertPreprocessRect(slice.cropRect, "cropQc.cropRect");
  if (slice.cropWidth !== null) assertNumber(slice.cropWidth, "cropQc.cropWidth");
  if (slice.cropHeight !== null) assertNumber(slice.cropHeight, "cropQc.cropHeight");
  assertNumber(slice.paddingRatio, "cropQc.paddingRatio");
  assertNumber(slice.checkerboardTileSize, "cropQc.checkerboardTileSize");
  assertNumber(slice.overlayOpacity, "cropQc.overlayOpacity");
  assertBoolean(slice.qcAccepted, "cropQc.qcAccepted");
  assertArray(slice.issues, "cropQc.issues");
  for (const [index, issue] of (slice.issues as unknown[]).entries()) {
    assertObject(issue, `cropQc.issues[${index}]`);
    const item = issue as Record<string, unknown>;
    assertString(item.id, `cropQc.issues[${index}].id`);
    if (item.level !== "info" && item.level !== "warning" && item.level !== "error") {
      throw new Error(`Project field "cropQc.issues[${index}].level" is invalid or missing`);
    }
    assertString(item.code, `cropQc.issues[${index}].code`);
    assertString(item.message, `cropQc.issues[${index}].message`);
  }
  if (hasAnyCanonicalCropField(slice)) {
    assertCanonicalCropQcContract(slice);
    return;
  }

  assertLegacyCropQcContract(slice);
};

const assertProjectedSpot = (value: unknown, fieldName: string) => {
  assertObject(value, fieldName);
  const spot = value as Record<string, unknown>;
  assertString(spot.id, `${fieldName}.id`);
  assertString(spot.barcode, `${fieldName}.barcode`);
  for (const key of ['arrayRow', 'arrayCol', 'x', 'y'] as const) {
    assertNumber(spot[key], `${fieldName}.${key}`);
  }

  const hasNewDimensions = 'width' in spot || 'height' in spot;
  const hasLegacyDiameters = 'diameterX' in spot || 'diameterY' in spot;

  if (!hasNewDimensions && !hasLegacyDiameters) {
    throw new Error(`Project field "${fieldName}" is invalid or missing`);
  }

  if (hasNewDimensions) {
    assertNumber(spot.width, `${fieldName}.width`);
    assertNumber(spot.height, `${fieldName}.height`);
  }

  if (hasLegacyDiameters) {
    assertNumber(spot.diameterX, `${fieldName}.diameterX`);
    assertNumber(spot.diameterY, `${fieldName}.diameterY`);
  }
};

const assertChipConfigSlice = (value: unknown) => {
  assertPreprocessSliceBase(value, "chipConfig");
  const slice = value as Record<string, unknown>;
  if (slice.chipType !== null && typeof slice.chipType !== "string") {
    throw new Error('Project field "chipConfig.chipType" is invalid or missing');
  }
  for (const key of ["rows", "columns", "pitchX", "pitchY"] as const) {
    if (slice[key] !== null) assertNumber(slice[key], `chipConfig.${key}`);
  }
  if (slice.origin !== null) assertPreprocessPoint(slice.origin, "chipConfig.origin");
  assertNumber(slice.rotationDegrees, "chipConfig.rotationDegrees");
  if (slice.projectedSpots !== null) {
    assertArray(slice.projectedSpots, "chipConfig.projectedSpots");
    for (const [index, spot] of (slice.projectedSpots as unknown[]).entries()) {
      assertProjectedSpot(spot, `chipConfig.projectedSpots[${index}]`);
    }
  }
};

const assertTissueSelectionSlice = (value: unknown) => {
  assertPreprocessSliceBase(value, "tissueSelection");
  const slice = value as Record<string, unknown>;
  if (slice.mode !== "polygon" && slice.mode !== "brush" && slice.mode !== "threshold" && slice.mode !== "imported") {
    throw new Error('Project field "tissueSelection.mode" is invalid or missing');
  }
  if (slice.thresholdMode !== "gray-min" && slice.thresholdMode !== "dark" && slice.thresholdMode !== "light") {
    throw new Error('Project field "tissueSelection.thresholdMode" is invalid or missing');
  }
  for (const key of ["activationThreshold", "blockThreshold", "dbscanEps", "dbscanMinSamples", "minConnectedSpotCount"] as const) {
    assertNumber(slice[key], `tissueSelection.${key}`);
  }
  for (const key of ["autoSelectedSpotIds", "forcedInSpotIds", "forcedOutSpotIds"] as const) {
    assertArray(slice[key], `tissueSelection.${key}`);
    for (const [index, entry] of (slice[key] as unknown[]).entries()) {
      assertString(entry, `tissueSelection.${key}[${index}]`);
    }
  }
  assertNullableString(slice.overrideNotice, "tissueSelection.overrideNotice");
  if (slice.paritySummary !== null) {
    assertObject(slice.paritySummary, "tissueSelection.paritySummary");
    const summary = slice.paritySummary as Record<string, unknown>;
    assertNumber(summary.selectedCount, "tissueSelection.paritySummary.selectedCount");
    assertNumber(summary.selectedPercent, "tissueSelection.paritySummary.selectedPercent");
    assertNumber(summary.maskCoverage, "tissueSelection.paritySummary.maskCoverage");
  }
  assertNullableString(slice.warning, "tissueSelection.warning");
  assertArray(slice.regions, "tissueSelection.regions");
  for (const [index, region] of (slice.regions as unknown[]).entries()) {
    assertObject(region, `tissueSelection.regions[${index}]`);
    const item = region as Record<string, unknown>;
    assertString(item.id, `tissueSelection.regions[${index}].id`);
    assertString(item.label, `tissueSelection.regions[${index}].label`);
    assertString(item.color, `tissueSelection.regions[${index}].color`);
    assertArray(item.points, `tissueSelection.regions[${index}].points`);
    for (const [pointIndex, point] of (item.points as unknown[]).entries()) {
      assertPreprocessPoint(point, `tissueSelection.regions[${index}].points[${pointIndex}]`);
    }
    if (Array.isArray(item.paths)) {
      for (const [pathIndex, ring] of item.paths.entries()) {
        assertArray(ring, `tissueSelection.regions[${index}].paths[${pathIndex}]`);
        for (const [pointIndex, point] of ring.entries()) {
          assertPreprocessPoint(point, `tissueSelection.regions[${index}].paths[${pathIndex}][${pointIndex}]`);
        }
      }
    }
  }
  assertNullableString(slice.selectedRegionId, "tissueSelection.selectedRegionId");
  assertNullableString(slice.previewDataUrl, "tissueSelection.previewDataUrl");
  if (slice.selectedSpotIds !== null) {
    assertArray(slice.selectedSpotIds, "tissueSelection.selectedSpotIds");
    for (const [index, entry] of (slice.selectedSpotIds as unknown[]).entries()) {
      assertString(entry, `tissueSelection.selectedSpotIds[${index}]`);
    }
  }
};

const assertExportStateSlice = (value: unknown) => {
  assertPreprocessSliceBase(value, "exportState");
  const slice = value as Record<string, unknown>;
  assertArray(slice.requestedFormats, "exportState.requestedFormats");
  for (const [index, format] of (slice.requestedFormats as unknown[]).entries()) {
    if (format !== "json" && format !== "csv" && format !== "png" && format !== "zip") {
      throw new Error(`Project field "exportState.requestedFormats[${index}]" is invalid or missing`);
    }
  }
  assertNullableString(slice.lastExportedAt, "exportState.lastExportedAt");
  assertArray(slice.artifacts, "exportState.artifacts");
  for (const [index, artifact] of (slice.artifacts as unknown[]).entries()) {
    assertObject(artifact, `exportState.artifacts[${index}]`);
    const item = artifact as Record<string, unknown>;
    assertString(item.id, `exportState.artifacts[${index}].id`);
    if (item.kind !== "json" && item.kind !== "csv" && item.kind !== "png" && item.kind !== "zip") {
      throw new Error(`Project field "exportState.artifacts[${index}].kind" is invalid or missing`);
    }
    assertString(item.fileName, `exportState.artifacts[${index}].fileName`);
    assertString(item.mimeType, `exportState.artifacts[${index}].mimeType`);
    assertString(item.createdAt, `exportState.artifacts[${index}].createdAt`);
  }
};

const assertSourceImage = (value: unknown, kind: PreprocessImageKind, requireDataUrl: boolean): PackagedSourceImage | null => {
  if (value === null) return null;
  assertObject(value, `sourceAssets.images.${kind}`);
  const image = value as Record<string, unknown>;
  assertSourceImageKind(image.kind, `sourceAssets.images.${kind}.kind`);
  if (image.kind !== kind) {
    throw new Error(`Project field "sourceAssets.images.${kind}.kind" is invalid or missing`);
  }
  assertString(image.id, `sourceAssets.images.${kind}.id`);
  assertString(image.fileName, `sourceAssets.images.${kind}.fileName`);
  assertString(image.mimeType, `sourceAssets.images.${kind}.mimeType`);
  if (requireDataUrl) {
    assertString(image.dataUrl, `sourceAssets.images.${kind}.dataUrl`);
  }
  if (typeof image.sizeBytes !== "number") {
    throw new Error(`Project field "sourceAssets.images.${kind}.sizeBytes" is invalid or missing`);
  }
  return image as PackagedSourceImage;
};

const assertPreprocessProjectShape = (
  value: unknown,
  requireSourceDataUrls: boolean,
  requireHeFocus: boolean,
): LegacyPreprocessProject => {
  assertObject(value, "project");
  const project = value as Record<string, unknown>;

  assertString(project.id, "id");
  assertString(project.name, "name");
  assertString(project.createdAt, "createdAt");
  assertString(project.updatedAt, "updatedAt");
  if (typeof project.workflowVersion !== "number") {
    throw new Error('Project field "workflowVersion" is invalid or missing');
  }
  assertPreprocessStepId(project.currentStep, 'currentStep');

  assertObject(project.sourceAssets, "sourceAssets");
  assertObject(project.localization, "localization");
  if (requireHeFocus) {
    assertObject(project.heFocus, 'heFocus');
  }
  assertObject(project.alignment, "alignment");
  assertObject(project.cropQc, "cropQc");
  assertObject(project.chipConfig, "chipConfig");
  assertObject(project.tissueSelection, "tissueSelection");
  assertObject(project.exportState, "exportState");

  const sourceAssets = project.sourceAssets as Record<string, unknown>;
  assertObject(sourceAssets.images, "sourceAssets.images");
  const images = sourceAssets.images as Record<string, unknown>;
  const sourceAssetsSlice = sourceAssets as Record<string, unknown>;

  assertPreprocessSliceBase(sourceAssetsSlice, "sourceAssets");
  assertSourceImageKind(sourceAssetsSlice.activeImage, "sourceAssets.activeImage");
  if (sourceAssetsSlice.oversizedImageWarning !== null) {
    assertObject(sourceAssetsSlice.oversizedImageWarning, "sourceAssets.oversizedImageWarning");
    const warning = sourceAssetsSlice.oversizedImageWarning as Record<string, unknown>;
    assertSourceImageKind(warning.kind, "sourceAssets.oversizedImageWarning.kind");
    assertNumber(warning.longestEdge, "sourceAssets.oversizedImageWarning.longestEdge");
    assertNumber(warning.totalPixels, "sourceAssets.oversizedImageWarning.totalPixels");
  }

  assertLocalizationSlice(project.localization);
  if (project.heFocus !== undefined) {
    assertHeFocusSlice(project.heFocus);
  }
  assertAlignmentSlice(project.alignment);
  assertCropQcSlice(project.cropQc);
  assertChipConfigSlice(project.chipConfig);
  assertTissueSelectionSlice(project.tissueSelection);
  assertExportStateSlice(project.exportState);

  const storageVersion = typeof project.storageVersion === 'number' ? project.storageVersion : 0;
  const packagedProject = {
    ...(project as LegacyPreprocessProject),
    storageVersion,
    sourceAssets: {
      ...(project.sourceAssets as LegacyPreprocessProject["sourceAssets"]),
      images: {
        eosin: assertSourceImage(images.eosin, "eosin", requireSourceDataUrls),
        he: assertSourceImage(images.he, "he", requireSourceDataUrls),
      },
    },
    heFocus: project.heFocus as LegacyPreprocessProject['heFocus'],
  } as LegacyPreprocessProject;

  return packagedProject;
};

export async function serializePreprocessProject(project: PreprocessProject): Promise<Blob> {
  if (!isBrowser()) {
    throw new Error("Preprocess project export is available in-browser only");
  }

  const payload: PreprocessPackageV3 = {
    version: PACKAGE_VERSION,
    project: toPackagedProject(project),
  };

  return new Blob([JSON.stringify(payload)], {
    type: "application/x-spatial-preprocess+json",
  });
}

export async function deserializePreprocessProject(file: File | Blob): Promise<PreprocessProject> {
  if (!isBrowser()) {
    throw new Error("Preprocess project import is available in-browser only");
  }

  const text = await file.text();
  return deserializePreprocessProjectText(text);
}

function deserializePreprocessProjectText(text: string): PreprocessProject {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON");
  }

  const pkg = parsed as Partial<PreprocessPackage>;
  if (pkg.version !== 1 && pkg.version !== 2 && pkg.version !== PACKAGE_VERSION) {
    throw new Error("Unsupported package version. Please re-export with the latest app.");
  }

  return migratePreprocessProject(
    assertPreprocessProjectShape(
      pkg.project,
      pkg.version === 1,
      pkg.version === PACKAGE_VERSION,
    ),
  );
}

export async function deserializePreprocessImport(file: File | Blob): Promise<PreprocessProject> {
  const fileName = file instanceof File ? file.name.toLowerCase() : '';
  if (fileName.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(file);
    const projectEntry = zip.file('project.json');
    if (!projectEntry) {
      throw new Error('ZIP does not contain project.json');
    }
    const text = await projectEntry.async('text');
    const project = deserializePreprocessProjectText(text);
    const pkg = JSON.parse(text) as Partial<PreprocessPackage>;
    if (pkg.version !== 1) {
      return attachPackagedAssets(project, zip);
    }
    return project;
  }

  return deserializePreprocessProject(file);
}
