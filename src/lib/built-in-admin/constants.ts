import type { PreprocessCropAssetScale, PreprocessImageKind, PreprocessStepId } from "../../types/built-in-admin";

export const PREPROCESS_STORAGE_KEY = "spatial-builtin-admin-projects";
export const PREPROCESS_DB_NAME = "spatial-builtin-admin";
export const PREPROCESS_DB_VERSION = 8;
export const PREPROCESS_STORAGE_SCHEMA_VERSION = 6;
export const PREPROCESS_SOURCE_IMAGE_STORE = "builtin-admin-source-images";
export const PREPROCESS_THUMBNAIL_STORE = "builtin-admin-thumbnails";
export const PREPROCESS_WORKING_IMAGE_STORE = "builtin-admin-working-images";
export const PREPROCESS_DERIVED_IMAGE_STORE = "builtin-admin-derived-images";
export const PREPROCESS_TISSUE_SELECTION_STORE = "builtin-admin-tissue-selection";
export const PREPROCESS_CHIP_CONFIG_STORE = "builtin-admin-chip-config";
export const PREPROCESS_PROJECT_META_STORE = "builtin-admin-project-metas";

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
  // Decoded-image caps: a compressed 20000x20000 TIFF decodes to ~1.6GB of
  // RGBA in memory, so a byte cap alone cannot protect the tab. 100MP with a
  // 20000px longest edge keeps full-size canvas decoding within safe bounds.
  maxPixels: 100 * 1024 * 1024,
  maxLongestEdge: 20000,
} as const;
