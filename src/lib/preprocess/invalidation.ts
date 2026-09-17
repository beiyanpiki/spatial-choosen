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
  source: null,
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
  forceAccepted: false,
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
  eosinReferenceGeometry: null,
  heQcGeometry: null,
  cropRect: null,
  cropWidth: null,
  cropHeight: null,
  cropAssets: {
    eosin: null,
    he: null,
  },
  tissue_hires_scalef: null,
  tissue_lowres_scalef: null,
  spot_diameter_fullres: null,
  fiducial_diameter_fullres: null,
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
  qcAccepted: false,
  issues: [],
});

const invalidateChipConfigSlice = (slice: ChipConfigSlice): ChipConfigSlice => ({
  ...markStale(slice),
  projectedSpots: null,
});

const invalidateTissueSelectionSlice = (
  slice: TissueSelectionSlice,
  options?: { resetSupportMetadata?: boolean },
): TissueSelectionSlice => ({
  ...markStale(slice),
  previewDataUrl: null,
  matrix: null,
  autoSelectedSpotIds: [],
  selectedSpotIds: null,
  paritySummary: null,
  supportState: options?.resetSupportMetadata ? 'unsupported' : slice.supportState,
  unsupportedReason: options?.resetSupportMetadata ? null : slice.unsupportedReason,
});

const invalidateExportStateSlice = (slice: ExportStateSlice): ExportStateSlice => ({
  ...markStale(slice),
  artifacts: [],
  lastExportedAt: null,
});

const invalidateStep = (
  project: PreprocessProject,
  stepId: PreprocessStepId,
  causeStepId: PreprocessStepId = stepId,
): PreprocessProject => {
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
      return {
        ...project,
        tissueSelection: invalidateTissueSelectionSlice(project.tissueSelection, {
          resetSupportMetadata: causeStepId !== 'tissueSelection',
        }),
      };
    case "exportState":
      return { ...project, exportState: invalidateExportStateSlice(project.exportState) };
    default:
      return project;
  }
};

const invalidateSpecificSteps = (
  project: PreprocessProject,
  stepIds: readonly PreprocessStepId[],
  causeStepId: PreprocessStepId,
): PreprocessProject => stepIds.reduce(
  (nextProject, downstreamStepId) => invalidateStep(nextProject, downstreamStepId, causeStepId),
  project,
);

export function getInvalidatedSteps(stepId: PreprocessStepId): readonly PreprocessStepId[] {
  return PREPROCESS_INVALIDATION_GRAPH[stepId];
}

export function invalidateFromStep(project: PreprocessProject, stepId: PreprocessStepId): PreprocessProject {
  return invalidateSpecificSteps(project, PREPROCESS_INVALIDATION_GRAPH[stepId], stepId);
}

export function invalidateOnSourceAssetsChange(project: PreprocessProject): PreprocessProject {
  return invalidateFromStep(project, "sourceAssets");
}

export function invalidateOnLocalizationChange(project: PreprocessProject): PreprocessProject {
  return invalidateFromStep(project, "localization");
}

export function invalidateOnHeFocusChange(project: PreprocessProject): PreprocessProject {
  return invalidateOnHeFocusCommit(project);
}

export function invalidateOnHeFocusCommit(project: PreprocessProject): PreprocessProject {
  return invalidateOnHeFocusChipBoundsChange(project);
}

export function invalidateOnHeFocusChipBoundsChange(project: PreprocessProject): PreprocessProject {
  return invalidateFromStep(project, "heFocus");
}


export function invalidateOnAlignmentChange(project: PreprocessProject): PreprocessProject {
  return invalidateFromStep(project, "alignment");
}

export function invalidateOnCropQcChange(project: PreprocessProject): PreprocessProject {
  return invalidateFromStep(project, 'cropQc');
}

export function invalidateOnChipConfigChange(project: PreprocessProject): PreprocessProject {
  return invalidateFromStep(invalidateStep(project, 'chipConfig', 'chipConfig'), 'chipConfig');
}

export function invalidateOnTissueSelectionChange(project: PreprocessProject): PreprocessProject {
  return invalidateFromStep(project, "tissueSelection");
}
