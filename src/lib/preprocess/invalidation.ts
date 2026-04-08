import type {
  AlignmentSlice,
  ChipConfigSlice,
  CropQcSlice,
  ExportStateSlice,
  HeFocusSlice,
  PreprocessProject,
  PreprocessSliceBase,
  PreprocessStepId,
  TissueSelectionSlice,
} from "../../types/preprocess";

export const PREPROCESS_INVALIDATION_GRAPH: Record<PreprocessStepId, readonly PreprocessStepId[]> = {
  sourceAssets: ["localization", "heFocus", "alignment", "cropQc", "chipConfig", "tissueSelection", "exportState"],
  localization: ["heFocus", "alignment", "cropQc", "chipConfig", "tissueSelection", "exportState"],
  heFocus: ["alignment", "cropQc", "chipConfig", "tissueSelection", "exportState"],
  alignment: ["cropQc", "chipConfig", "tissueSelection", "exportState"],
  cropQc: ["chipConfig", "tissueSelection", "exportState"],
  chipConfig: ["tissueSelection", "exportState"],
  tissueSelection: ["exportState"],
  exportState: [],
};

const markStale = <T extends PreprocessSliceBase>(slice: T): T => ({
  ...slice,
  status: "stale",
  isStale: true,
  error: null,
});

const invalidateAlignmentSlice = (slice: AlignmentSlice): AlignmentSlice => ({
  ...markStale(slice),
  controlPoints: [],
  inlierMask: null,
  affineMatrix: null,
  reprojectionRmse: null,
  inlierRatio: null,
  ransacReprojThreshold: null,
  qualityFlags: {
    minPairs: false,
    inlierRatio: false,
    rmse: false,
    finiteMatrix: false,
    scaleRange: false,
    accepted: false,
  },
  solveAccepted: false,
  failureReason: null,
  transform: null,
  previewDataUrl: null,
});

const invalidateHeFocusSlice = (slice: HeFocusSlice): HeFocusSlice => ({
  ...markStale(slice),
  focusedImageDataUrl: null,
});

const invalidateCropQcSlice = (slice: CropQcSlice): CropQcSlice => ({
  ...markStale(slice),
  eosinPreviewDataUrl: null,
  previewDataUrl: null,
  checkerboardPreviewDataUrl: null,
  qcAccepted: false,
});

const invalidateChipConfigSlice = (slice: ChipConfigSlice): ChipConfigSlice => ({
  ...markStale(slice),
  projectedSpots: null,
});

const invalidateTissueSelectionSlice = (slice: TissueSelectionSlice): TissueSelectionSlice => ({
  ...markStale(slice),
  previewDataUrl: null,
  autoSelectedSpotIds: [],
  selectedSpotIds: null,
  forcedInSpotIds: [],
  forcedOutSpotIds: [],
  regions: [],
  selectedRegionId: null,
  overrideNotice: slice.forcedInSpotIds.length > 0 || slice.forcedOutSpotIds.length > 0 || slice.regions.length > 0
    ? 'Overrides cleared due to geometry change.'
    : null,
});

const invalidateExportStateSlice = (slice: ExportStateSlice): ExportStateSlice => ({
  ...markStale(slice),
  artifacts: [],
  lastExportedAt: null,
});

const invalidateStep = (project: PreprocessProject, stepId: PreprocessStepId): PreprocessProject => {
  switch (stepId) {
    case "sourceAssets":
      return { ...project, sourceAssets: markStale(project.sourceAssets) };
    case "localization":
      return { ...project, localization: markStale(project.localization) };
    case "heFocus":
      return { ...project, heFocus: invalidateHeFocusSlice(project.heFocus) };
    case "alignment":
      return { ...project, alignment: invalidateAlignmentSlice(project.alignment) };
    case "cropQc":
      return { ...project, cropQc: invalidateCropQcSlice(project.cropQc) };
    case "chipConfig":
      return { ...project, chipConfig: invalidateChipConfigSlice(project.chipConfig) };
    case "tissueSelection":
      return { ...project, tissueSelection: invalidateTissueSelectionSlice(project.tissueSelection) };
    case "exportState":
      return { ...project, exportState: invalidateExportStateSlice(project.exportState) };
    default:
      return project;
  }
};

export function getInvalidatedSteps(stepId: PreprocessStepId): readonly PreprocessStepId[] {
  return PREPROCESS_INVALIDATION_GRAPH[stepId];
}

export function invalidateFromStep(project: PreprocessProject, stepId: PreprocessStepId): PreprocessProject {
  return PREPROCESS_INVALIDATION_GRAPH[stepId].reduce(
    (nextProject, downstreamStepId) => invalidateStep(nextProject, downstreamStepId),
    project,
  );
}

export function invalidateOnSourceAssetsChange(project: PreprocessProject): PreprocessProject {
  return invalidateFromStep(project, "sourceAssets");
}

export function invalidateOnLocalizationChange(project: PreprocessProject): PreprocessProject {
  return invalidateFromStep(project, "localization");
}

export function invalidateOnHeFocusChange(project: PreprocessProject): PreprocessProject {
  return invalidateFromStep(project, "heFocus");
}

export function invalidateOnAlignmentChange(project: PreprocessProject): PreprocessProject {
  return invalidateFromStep(project, "alignment");
}

export function invalidateOnCropQcChange(project: PreprocessProject): PreprocessProject {
  return invalidateFromStep(project, "cropQc");
}

export function invalidateOnChipConfigChange(project: PreprocessProject): PreprocessProject {
  return invalidateFromStep(project, "chipConfig");
}

export function invalidateOnTissueSelectionChange(project: PreprocessProject): PreprocessProject {
  return invalidateFromStep(project, "tissueSelection");
}
