export type PreprocessStepId = "sourceAssets" | "tissueSelection";

export type PreprocessStepStatus =
  | "idle"
  | "ready"
  | "processing"
  | "complete"
  | "stale"
  | "error";

export type PreprocessImageKind = "he";

export type PreprocessPoint = {
  x: number;
  y: number;
};

export type PreprocessRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PreprocessSliceBase = {
  status: PreprocessStepStatus;
  isStale: boolean;
  updatedAt: string | null;
  error: string | null;
};

export type PreprocessSourceImage = {
  id: string;
  kind: PreprocessImageKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  lastModified: number | null;
  sourceBlob?: Blob;
  thumbnailBlob?: Blob;
  objectUrl?: string;
  thumbnailObjectUrl?: string;
  dataUrl?: string;
  thumbnailDataUrl?: string;
  workingBlob?: Blob;
  workingObjectUrl?: string;
  workingDataUrl?: string;
  workingWidth?: number | null;
  workingHeight?: number | null;
};

export type PreprocessSourceImageSet = {
  he: PreprocessSourceImage | null;
};

export type SourceAssetsSlice = PreprocessSliceBase & {
  activeImage: PreprocessImageKind;
  images: PreprocessSourceImageSet;
  oversizedImageWarning: {
    kind: PreprocessImageKind;
    longestEdge: number;
    totalPixels: number;
  } | null;
};

export type ProjectedSpotBase = {
  id: string;
  barcode: string;
  arrayRow: number;
  arrayCol: number;
  x: number;
  y: number;
};

export type CanonicalProjectedSpotDimensions = {
  width: number;
  height: number;
};

export type DeprecatedProjectedSpotDiameterAliases = {
  /**
   * @deprecated Transitional alias for `width`.
   */
  diameterX: number;
  /**
   * @deprecated Transitional alias for `height`.
   */
  diameterY: number;
};

export type CanonicalProjectedSpot = ProjectedSpotBase
  & CanonicalProjectedSpotDimensions
  & DeprecatedProjectedSpotDiameterAliases;

export type ProjectedSpot = ProjectedSpotBase
  & DeprecatedProjectedSpotDiameterAliases
  & Partial<CanonicalProjectedSpotDimensions>;

export type LegacyProjectedSpot = ProjectedSpotBase
  & DeprecatedProjectedSpotDiameterAliases
  & Partial<CanonicalProjectedSpotDimensions>;

export type ChipConfigSlice = PreprocessSliceBase & {
  chipType: string | null;
  rows: number | null;
  columns: number | null;
  pitchX: number | null;
  pitchY: number | null;
  origin: PreprocessPoint | null;
  rotationDegrees: number;
  projectedSpots: ProjectedSpot[] | null;
};

export type LegacyChipConfigSlice = Omit<ChipConfigSlice, "projectedSpots"> & {
  projectedSpots: Array<ProjectedSpot | LegacyProjectedSpot> | null;
};

export type TissueRegion = {
  id: string;
  label: string;
  color: string;
  points: PreprocessPoint[];
  paths?: PreprocessPoint[][];
};

export type TissueActivationValue = 0 | 1;

export type TissueActivationMatrix = {
  rows: number;
  columns: number;
  values: TissueActivationValue[];
};

export type TissueSelectionSupportState = 'supported' | 'unsupported';

export type TissueThresholdMode = 'raw' | 'gray-max' | 'gray-min';

export type LegacyTissueThresholdMode = TissueThresholdMode | 'dark' | 'light';

export type CanonicalTissueSelectionMode = 'matrix' | 'imported';

export type LegacyTissueSelectionMode = CanonicalTissueSelectionMode | 'polygon' | 'brush' | 'threshold';

export type CanonicalTissueSelectionSlice = PreprocessSliceBase & {
  mode: CanonicalTissueSelectionMode;
  thresholdMode: TissueThresholdMode;
  activationThreshold: number;
  blockThreshold: number;
  dbscanEps: number;
  dbscanMinSamples: number;
  minConnectedSpotCount: number;
  autoSelectedSpotIds: string[];
  matrix: TissueActivationMatrix | null;
  supportState: TissueSelectionSupportState;
  unsupportedReason: string | null;
  selectedSpotIds: string[] | null;
  paritySummary: {
    selectedCount: number;
    selectedPercent: number;
    maskCoverage: number;
  } | null;
  warning: string | null;
};

type TissueSelectionLegacyCompatibilityFields = {
  forcedInSpotIds: string[];
  forcedOutSpotIds: string[];
  overrideNotice: string | null;
  regions: TissueRegion[];
  selectedRegionId: string | null;
  previewDataUrl: string | null;
};

/**
 * Canonical tissue state is matrix-first; the legacy region-based fields remain
 * available as optional compatibility for older payloads.
 */
export type TissueSelectionSlice = CanonicalTissueSelectionSlice
  & Partial<TissueSelectionLegacyCompatibilityFields> & {
    mode: LegacyTissueSelectionMode;
    thresholdMode: LegacyTissueThresholdMode;
  };

/**
 * Legacy migration input contract for older stored/package payloads that may
 * arrive region-first and without the canonical matrix/support fields.
 */
export type LegacyTissueSelectionSlice = Omit<CanonicalTissueSelectionSlice, 'mode' | 'thresholdMode' | 'matrix' | 'supportState' | 'unsupportedReason'>
  & TissueSelectionLegacyCompatibilityFields & {
    mode: LegacyTissueSelectionMode;
    thresholdMode: LegacyTissueThresholdMode;
    matrix?: TissueActivationMatrix | null;
    supportState?: TissueSelectionSupportState;
    unsupportedReason?: string | null;
  };

export type PreprocessProject = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  workflowVersion: number;
  storageVersion: number;
  currentStep: PreprocessStepId;
  sourceAssets: SourceAssetsSlice;
  chipConfig: ChipConfigSlice;
  tissueSelection: TissueSelectionSlice;
};

export type LegacyPreprocessProject = Omit<PreprocessProject, "chipConfig" | "tissueSelection"> & {
  chipConfig: LegacyChipConfigSlice;
  tissueSelection: LegacyTissueSelectionSlice;
};

export type PreprocessProjectSlices = Pick<PreprocessProject, PreprocessStepId>;
