export type PreprocessStepId =
  | "sourceAssets"
  | "localization"
  | "heFocus"
  | "alignment"
  | "cropQc"
  | "chipConfig"
  | "tissueSelection"
  | "exportState";

export type PreprocessStepStatus =
  | "idle"
  | "ready"
  | "processing"
  | "complete"
  | "stale"
  | "error";

export type PreprocessImageKind = "eosin" | "he";

export type PreprocessExportFormat = "json" | "csv" | "png" | "zip";

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
};

export type PreprocessSourceImageSet = {
  eosin: PreprocessSourceImage | null;
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

export type LocalizationHandle = {
  id: string;
  label: string;
  point: PreprocessPoint;
};

export type LocalizationBoxColor = "green" | "white";

export type LocalizationResizeHandle = "nw" | "ne" | "se" | "sw" | "n" | "e" | "s" | "w";

export type LocalizationImageTransform = {
  rotationDegrees: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  scale: number;
};

export type LocalizationSlice = PreprocessSliceBase & {
  targetImage: PreprocessImageKind;
  chipType: string | null;
  method: "manual" | "imported" | "bundle" | null;
  chipBounds: PreprocessRect | null;
  handles: LocalizationHandle[];
  boxColor: LocalizationBoxColor;
  imageTransform: LocalizationImageTransform;
};

export type HeFocusSlice = PreprocessSliceBase & {
  targetImage: "he";
  chipBounds: PreprocessRect | null;
  handles: LocalizationHandle[];
  imageTransform: LocalizationImageTransform;
  focusedImageDataUrl: string | null;
};

export type AlignmentControlPoint = {
  id: string;
  source: PreprocessPoint;
  target: PreprocessPoint;
};

export type AlignmentTransform = {
  translationX: number;
  translationY: number;
  rotationDegrees: number;
  scaleX: number;
  scaleY: number;
};

export type AlignmentAffineMatrix = [number, number, number, number, number, number];

export type AlignmentQualityFlags = {
  minPairs: boolean;
  inlierRatio: boolean;
  rmse: boolean;
  finiteMatrix: boolean;
  scaleRange: boolean;
  accepted: boolean;
};

export type AlignmentFailureReason =
  | 'missing-images'
  | 'insufficient-pairs'
  | 'solve-failed'
  | 'insufficient-inliers'
  | 'rmse-too-high'
  | 'invalid-matrix';

export type AlignmentSlice = PreprocessSliceBase & {
  referenceImage: PreprocessImageKind;
  movingImage: PreprocessImageKind;
  movingImageTransform: LocalizationImageTransform;
  overlayOpacity: number;
  controlPoints: AlignmentControlPoint[];
  inlierMask: boolean[] | null;
  affineMatrix: AlignmentAffineMatrix | null;
  reprojectionRmse: number | null;
  inlierRatio: number | null;
  ransacReprojThreshold: number | null;
  qualityFlags: AlignmentQualityFlags;
  solveAccepted: boolean;
  failureReason: AlignmentFailureReason | null;
  transform: AlignmentTransform | null;
  previewDataUrl: string | null;
};

export type CropQcIssue = {
  id: string;
  level: "info" | "warning" | "error";
  code: string;
  message: string;
};

export type CropQcSlice = PreprocessSliceBase & {
  cropRect: PreprocessRect | null;
  cropWidth: number | null;
  cropHeight: number | null;
  paddingRatio: number;
  checkerboardTileSize: number;
  overlayOpacity: number;
  qcAccepted: boolean;
  issues: CropQcIssue[];
  eosinPreviewDataUrl: string | null;
  previewDataUrl: string | null;
  checkerboardPreviewDataUrl: string | null;
};

export type ProjectedSpot = {
  id: string;
  barcode: string;
  arrayRow: number;
  arrayCol: number;
  x: number;
  y: number;
  diameterX: number;
  diameterY: number;
};

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

export type TissueRegion = {
  id: string;
  label: string;
  color: string;
  points: PreprocessPoint[];
  paths?: PreprocessPoint[][];
};

export type TissueSelectionSlice = PreprocessSliceBase & {
  mode: "polygon" | "brush" | "threshold" | "imported";
  thresholdMode: 'gray-min';
  activationThreshold: number;
  blockThreshold: number;
  dbscanEps: number;
  dbscanMinSamples: number;
  minConnectedSpotCount: number;
  autoSelectedSpotIds: string[];
  forcedInSpotIds: string[];
  forcedOutSpotIds: string[];
  overrideNotice: string | null;
  paritySummary: {
    selectedCount: number;
    selectedPercent: number;
    maskCoverage: number;
  } | null;
  warning: string | null;
  regions: TissueRegion[];
  selectedRegionId: string | null;
  previewDataUrl: string | null;
  selectedSpotIds: string[] | null;
};

export type LegacyTissueSelectionSlice = Omit<TissueSelectionSlice, 'thresholdMode'> & {
  thresholdMode: 'dark' | 'light' | 'gray-min';
};

export type ExportArtifact = {
  id: string;
  kind: PreprocessExportFormat;
  fileName: string;
  mimeType: string;
  createdAt: string;
};

export type ExportStateSlice = PreprocessSliceBase & {
  requestedFormats: PreprocessExportFormat[];
  lastExportedAt: string | null;
  artifacts: ExportArtifact[];
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
  localization: LocalizationSlice;
  heFocus: HeFocusSlice;
  alignment: AlignmentSlice;
  cropQc: CropQcSlice;
  chipConfig: ChipConfigSlice;
  tissueSelection: TissueSelectionSlice;
  exportState: ExportStateSlice;
};

export type LegacyPreprocessProject = Omit<PreprocessProject, "heFocus" | "tissueSelection"> & {
  heFocus?: HeFocusSlice;
  tissueSelection: LegacyTissueSelectionSlice;
};

export type PreprocessProjectSlices = Pick<PreprocessProject, PreprocessStepId>;
