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

export type PreprocessCropAssetScale = "fullres" | "hires" | "lowres";

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

export type CropQcCanonicalAsset = {
  dataUrl: string;
};

export type CropQcCanonicalAssetSet = {
  fullres: CropQcCanonicalAsset;
  hires: CropQcCanonicalAsset;
  lowres: CropQcCanonicalAsset;
};

export type CropQcCanonicalCropState =
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
        eosin: CropQcCanonicalAssetSet;
        he: CropQcCanonicalAssetSet;
      };
      tissue_hires_scalef: number;
      tissue_lowres_scalef: number;
      spot_diameter_fullres: number | null;
      fiducial_diameter_fullres: number;
    };

export type CropQcCheckerboardPreview = {
  dataUrl: string | null;
};

export type DeprecatedCropQcPreviewAliases = {
  /**
   * @deprecated Transitional alias for `cropAssets.eosin.fullres.dataUrl`.
   */
  eosinPreviewDataUrl: string | null;
  /**
   * @deprecated Transitional alias for `cropAssets.he.fullres.dataUrl`.
   */
  previewDataUrl: string | null;
  /**
   * @deprecated Transitional alias for `checkerboardPreview.dataUrl`.
   */
  checkerboardPreviewDataUrl: string | null;
};

export type CropQcSliceCore = PreprocessSliceBase & DeprecatedCropQcPreviewAliases & {
  cropRect: PreprocessRect | null;
  cropWidth: number | null;
  cropHeight: number | null;
  paddingRatio: number;
  checkerboardTileSize: number;
  overlayOpacity: number;
  qcAccepted: boolean;
  issues: CropQcIssue[];
};

export type CanonicalCropQcSlice = CropQcSliceCore & CropQcCanonicalCropState & {
  checkerboardPreview: CropQcCheckerboardPreview;
};

/**
 * Transitional compatibility contract for Task 1.
 *
 * Canonical persisted data should include the full crop asset contract, but
 * existing cold-start project constructors may still omit those fields until
 * later tasks rewire creation and UI consumption.
 */
export type CropQcSlice = CropQcSliceCore & {
  cropAssets?: CanonicalCropQcSlice["cropAssets"];
  tissue_hires_scalef?: CanonicalCropQcSlice["tissue_hires_scalef"];
  tissue_lowres_scalef?: CanonicalCropQcSlice["tissue_lowres_scalef"];
  spot_diameter_fullres?: CanonicalCropQcSlice["spot_diameter_fullres"];
  fiducial_diameter_fullres?: CanonicalCropQcSlice["fiducial_diameter_fullres"];
  checkerboardPreview?: CropQcCheckerboardPreview;
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
   * @deprecated Transitional alias for `width`. Remove after downstream spot consumers adopt square geometry.
   */
  diameterX: number;
  /**
   * @deprecated Transitional alias for `height`. Remove after downstream spot consumers adopt square geometry.
   */
  diameterY: number;
};

export type CanonicalProjectedSpot = ProjectedSpotBase
  & CanonicalProjectedSpotDimensions
  & DeprecatedProjectedSpotDiameterAliases;

/**
 * Transitional compatibility contract for Task 1.
 *
 * `width` / `height` are the intended square-geometry fields, while
 * `diameterX` / `diameterY` remain available only so existing downstream
 * callers can continue compiling until the later projection/UI rewiring tasks.
 */
export type ProjectedSpot = ProjectedSpotBase
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

export type LegacyProjectedSpot = ProjectedSpotBase
  & DeprecatedProjectedSpotDiameterAliases
  & Partial<CanonicalProjectedSpotDimensions>;

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

export type LegacyCropQcSlice = Omit<
  CropQcSlice,
  keyof CropQcCanonicalCropState | "checkerboardPreview"
> & {
  cropAssets?: CropQcSlice["cropAssets"];
  tissue_hires_scalef?: CropQcSlice["tissue_hires_scalef"];
  tissue_lowres_scalef?: CropQcSlice["tissue_lowres_scalef"];
  spot_diameter_fullres?: CropQcSlice["spot_diameter_fullres"];
  fiducial_diameter_fullres?: CropQcSlice["fiducial_diameter_fullres"];
  checkerboardPreview?: CropQcCheckerboardPreview;
  eosinPreviewDataUrl?: string | null;
  previewDataUrl?: string | null;
  checkerboardPreviewDataUrl?: string | null;
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

export type LegacyPreprocessProject = Omit<PreprocessProject, "heFocus" | "cropQc" | "chipConfig" | "tissueSelection"> & {
  heFocus?: HeFocusSlice;
  cropQc: LegacyCropQcSlice;
  chipConfig: LegacyChipConfigSlice;
  tissueSelection: LegacyTissueSelectionSlice;
};

export type PreprocessProjectSlices = Pick<PreprocessProject, PreprocessStepId>;
