import type { PreprocessImageKind, PreprocessStepId } from "../../types/built-in";

export const PREPROCESS_STORAGE_KEY = "spatial-builtin-projects";
export const PREPROCESS_DB_NAME = "spatial-builtin";
export const PREPROCESS_DB_VERSION = 5;
export const PREPROCESS_STORAGE_SCHEMA_VERSION = 8;
export const PREPROCESS_SOURCE_IMAGE_STORE = "builtin-source-images";
export const PREPROCESS_THUMBNAIL_STORE = "builtin-thumbnails";
export const PREPROCESS_WORKING_IMAGE_STORE = "builtin-working-images";
export const PREPROCESS_TISSUE_SELECTION_STORE = "builtin-tissue-selection";

export const PREPROCESS_STEP_IDS = [
  "sourceAssets",
  "tissueSelection",
  "exportState",
] as const satisfies readonly PreprocessStepId[];

export const PREPROCESS_EXPORT_HIRES_MAX_SIDE = 2000;
export const PREPROCESS_EXPORT_LOWRES_MAX_SIDE = 800;

export const PREPROCESS_SOURCE_IMAGE_KINDS = ["he"] as const satisfies readonly PreprocessImageKind[];

export const PREPROCESS_WORKING_PROXY_MAX_BYTES = 10_000_000;

export const PREPROCESS_NUMERIC_DEFAULTS = {
  thumbnailMaxDimension: 1000,
  workingMaxDimension: 2048,
} as const;

export const PREPROCESS_OVERSIZED_IMAGE_LIMITS = {
  hardBytes: 512 * 1024 * 1024,
} as const;
