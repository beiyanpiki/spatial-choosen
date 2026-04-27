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
  workingBlob?: Blob;
  workingObjectUrl?: string;
  workingDataUrl?: string;
  workingWidth?: number | null;
  workingHeight?: number | null;
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
  autoProposal: HeFocusAutoProposal;
  focusedImageDataUrl: string | null;
};

export type HeFocusAutoProposalStatus = "idle" | "accepted" | "fallback" | "failed";

export type HeFocusAutoProposalQuad = [
  PreprocessPoint,
  PreprocessPoint,
  PreprocessPoint,
  PreprocessPoint,
];

export type HeFocusAutoProposal = {
  status: HeFocusAutoProposalStatus;
  method: string | null;
  coarseBounds: PreprocessRect | null;
  refinedBounds: PreprocessRect | null;
  refinedQuad: HeFocusAutoProposalQuad | null;
  rotationDegrees: number | null;
  eccCorrelation: number | null;
  acceptedTransform?: {
    affineMatrix: AlignmentAffineMatrix;
    transform: AlignmentTransform;
  } | null;
  failureReason: string | null;
};

export type LegacyHeFocusSlice = Omit<HeFocusSlice, "autoProposal"> & {
  autoProposal?: HeFocusAutoProposal | null;
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
  isUniformScale?: boolean;
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
  source: "auto" | "manual" | null;
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

export type LegacyAlignmentSlice = Omit<AlignmentSlice, "source"> & {
  source?: AlignmentSlice["source"];
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
  /**
   * Canonical export frame for this crop variant.
   *
   * `cropAssets.he.fullres` is the H&E crop rendered at the original H&E pixel
   * density over the final crop extent. `hires` and `lowres` are derived by
   * downsampling from this same full-resolution frame only.
   */
  fullres: CropQcCanonicalAsset;
  /**
   * Downsampled derivative of `fullres` for package/UI compatibility.
   */
  hires: CropQcCanonicalAsset;
  /**
   * Downsampled derivative of `fullres` for package/UI compatibility.
   */
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

export type CanonicalCropQcGeometry = {
  /**
   * Normalized rect in the geometry's native source frame.
   *
   * `eosinReferenceGeometry.rect` is normalized against the full eosin/reference
   * image. `heQcGeometry.rect` is normalized against the accepted crop-local QC
   * frame. Export code must convert these rects into the emitted HE fullres
   * pixel frame instead of treating them as pixel coordinates directly.
   */
  rect: PreprocessRect;
  /**
   * Pixel width in the geometry's native source frame.
   *
   * This is geometry evidence, not necessarily the emitted HE fullres export
   * width stored in `cropWidth`.
   */
  width: number;
  /**
   * Pixel height in the geometry's native source frame.
   *
   * This is geometry evidence, not necessarily the emitted HE fullres export
   * height stored in `cropHeight`.
   */
  height: number;
};

/**
 * Transitional runtime contract for Task 2.
 *
 * `eosinReferenceGeometry` is the authoritative crop-domain geometry in
 * eosin/reference-image space. It is not the derived H&E QC projection, and
 * its normalized rect must be remapped onto the emitted HE fullres export frame
 * before export-only math consumes it.
 * `heQcGeometry` is derived QC evidence in crop-local space, produced from the
 * projected H&E geometry when available. It may remain null for workflows that
 * lack accepted/projectable H&E geometry.
 */
export type CropQcTransitionalGeometryContract = {
  eosinReferenceGeometry?: CanonicalCropQcGeometry | null;
  heQcGeometry?: CanonicalCropQcGeometry | null;
};

export type DeprecatedCropQcGeometryAliases = {
  /**
   * @deprecated Transitional alias for `eosinReferenceGeometry.rect`.
   */
  cropRect: PreprocessRect | null;
  /**
   * Canonical emitted HE fullres export width.
   *
   * @deprecated Transitional alias retained on `cropQc` for export/tissue
   * consumers that have not yet moved to the canonical asset contract.
   */
  cropWidth: number | null;
  /**
   * Canonical emitted HE fullres export height.
   *
   * @deprecated Transitional alias retained on `cropQc` for export/tissue
   * consumers that have not yet moved to the canonical asset contract.
   */
  cropHeight: number | null;
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
  /**
   * @deprecated Transitional alias for `featureMatchesPreview.dataUrl`.
   */
  featureMatchesPreviewDataUrl: string | null;
};

export type CropQcSliceCore = PreprocessSliceBase
  & CropQcTransitionalGeometryContract
  & DeprecatedCropQcGeometryAliases
  & DeprecatedCropQcPreviewAliases & {
    paddingRatio: number;
    checkerboardTileSize: number;
    overlayOpacity: number;
    qcAccepted: boolean;
    issues: CropQcIssue[];
  };

export type CanonicalCropQcSlice = CropQcSliceCore & CropQcCanonicalCropState & {
  checkerboardPreview: CropQcCheckerboardPreview;
  featureMatchesPreview: CropQcCheckerboardPreview;
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
  featureMatchesPreview?: CropQcCheckerboardPreview;
};

/**
 * Preferred chip-rect source for export geometry resolution.
 *
 * `eosin-reference-geometry` is the primary crop-domain source, followed by
 * `he-qc-geometry` when present, then `crop-bounds-fallback` as the last resort.
 */
export type SpotExportChipRectSource = 'eosin-reference-geometry' | 'he-qc-geometry' | 'crop-bounds-fallback';

export type SpotExportTemplateAnchor = {
  barcode: string;
  arrayRow: number;
  arrayCol: number;
  /**
   * Canonical template anchor row in the full-resolution export frame.
   */
  pxl_row_in_fullres: number;
  /**
   * Canonical template anchor column in the full-resolution export frame.
   */
  pxl_col_in_fullres: number;
};

export type SpotExportTemplateAnchorBounds = {
  minPxlRowInFullres: number;
  maxPxlRowInFullres: number;
  minPxlColInFullres: number;
  maxPxlColInFullres: number;
};

/**
 * Export-only geometry contract.
 *
 * The chip rect is resolved in the full-resolution export image frame with
 * `eosin-reference-geometry` as the preferred source, then `he-qc-geometry`,
 * then `crop-bounds-fallback`. Template anchors and exported CSV coordinates
 * live in that same canonical full-resolution frame, keeping ZIP/CSV modeling
 * separate from UI `ProjectedSpot` center semantics.
 *
 * Contractually, `pxl_row_in_fullres` / `pxl_col_in_fullres` describe the
 * top-left pixel of each exported spot square in the canonical full-resolution
 * frame.
 */
export type SpotExportGeometryContract = {
  chipRect: PreprocessRect;
  chipRectSource: SpotExportChipRectSource;
  templateAnchorBounds: SpotExportTemplateAnchorBounds;
  templateAnchors: SpotExportTemplateAnchor[];
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
 * Transitional runtime contract for Task 2.
 *
 * Canonical tissue state is matrix-first, but the legacy region-based fields
 * remain available so downstream consumers can keep compiling until later
 * rewiring tasks land.
 */
export type TissueSelectionSlice = CanonicalTissueSelectionSlice
  & Partial<TissueSelectionLegacyCompatibilityFields> & {
    mode: LegacyTissueSelectionMode;
    thresholdMode: LegacyTissueThresholdMode;
  };

/**
 * Legacy migration input contract.
 *
 * Older stored/package payloads may still arrive region-first and without the
 * canonical matrix/support fields until the dedicated migration rewiring lands.
 */
export type LegacyTissueSelectionSlice = Omit<CanonicalTissueSelectionSlice, 'mode' | 'thresholdMode' | 'matrix' | 'supportState' | 'unsupportedReason'>
  & TissueSelectionLegacyCompatibilityFields & {
    mode: LegacyTissueSelectionMode;
    thresholdMode: LegacyTissueThresholdMode;
    matrix?: TissueActivationMatrix | null;
    supportState?: TissueSelectionSupportState;
    unsupportedReason?: string | null;
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

export type LegacyPreprocessProject = Omit<PreprocessProject, "heFocus" | "alignment" | "cropQc" | "chipConfig" | "tissueSelection"> & {
  heFocus?: LegacyHeFocusSlice;
  alignment: LegacyAlignmentSlice;
  cropQc: LegacyCropQcSlice;
  chipConfig: LegacyChipConfigSlice;
  tissueSelection: LegacyTissueSelectionSlice;
};

export type PreprocessProjectSlices = Pick<PreprocessProject, PreprocessStepId>;
