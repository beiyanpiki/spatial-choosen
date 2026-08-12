import type { PreprocessCropAssetScale, PreprocessImageKind, PreprocessStepId } from "../../types/built-in-admin";

export const PREPROCESS_STORAGE_KEY = "spatial-builtin-admin-projects";
export const PREPROCESS_DB_NAME = "spatial-builtin-admin";
export const PREPROCESS_DB_VERSION = 5;
export const PREPROCESS_STORAGE_SCHEMA_VERSION = 6;
export const PREPROCESS_SOURCE_IMAGE_STORE = "builtin-admin-source-images";
export const PREPROCESS_THUMBNAIL_STORE = "builtin-admin-thumbnails";
export const PREPROCESS_WORKING_IMAGE_STORE = "builtin-admin-working-images";
export const PREPROCESS_DERIVED_IMAGE_STORE = "builtin-admin-derived-images";
export const PREPROCESS_TISSUE_SELECTION_STORE = "builtin-admin-tissue-selection";

export const PREPROCESS_STEP_IDS = [
  "sourceAssets",
  "localization",
  "heFocus",
  "alignment",
  "cropQc",
  "chipConfig",
  "tissueSelection",
  "exportState",
] as const satisfies readonly PreprocessStepId[];

export const PREPROCESS_SOURCE_IMAGE_KINDS = ["eosin", "he"] as const satisfies readonly PreprocessImageKind[];

export const PREPROCESS_CANONICAL_CROP_ASSET_LEVELS = ["fullres", "hires", "lowres"] as const satisfies readonly PreprocessCropAssetScale[];

export const PREPROCESS_WORKING_PROXY_MAX_BYTES = 10_000_000;

export const PREPROCESS_NUMERIC_DEFAULTS = {
  alignmentOverlayOpacity: 0.5,
  cropPaddingRatio: 0.02,
  defaultRotationDegrees: 0,
  defaultScale: 1,
  thumbnailMaxDimension: 1000,
  workingMaxDimension: 2048,
} as const;

export const PREPROCESS_OVERSIZED_IMAGE_LIMITS = {
  hardBytes: 512 * 1024 * 1024,
} as const;
