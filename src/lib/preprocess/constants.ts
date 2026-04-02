import type { PreprocessImageKind, PreprocessStepId } from "../../types/preprocess";

export const PREPROCESS_STORAGE_KEY = "spatial-preprocess-projects";
export const PREPROCESS_DB_NAME = "spatial-preprocess";
export const PREPROCESS_DB_VERSION = 2;
export const PREPROCESS_STORAGE_SCHEMA_VERSION = 2;
export const PREPROCESS_SOURCE_IMAGE_STORE = "preprocess-source-images";
export const PREPROCESS_THUMBNAIL_STORE = "preprocess-thumbnails";

export const PREPROCESS_STEP_IDS = [
  "sourceAssets",
  "localization",
  "alignment",
  "cropQc",
  "chipConfig",
  "tissueSelection",
  "exportState",
] as const satisfies readonly PreprocessStepId[];

export const PREPROCESS_SOURCE_IMAGE_KINDS = ["eosin", "he"] as const satisfies readonly PreprocessImageKind[];

export const PREPROCESS_NUMERIC_DEFAULTS = {
  alignmentOverlayOpacity: 0.5,
  cropPaddingRatio: 0.02,
  defaultRotationDegrees: 0,
  defaultScale: 1,
  thumbnailMaxDimension: 1024,
} as const;

export const PREPROCESS_OVERSIZED_IMAGE_LIMITS = {
  hardBytes: 512 * 1024 * 1024,
} as const;
