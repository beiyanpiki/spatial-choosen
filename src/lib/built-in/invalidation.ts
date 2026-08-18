import type {
  PreprocessProject,
  PreprocessSliceBase,
  PreprocessStepId,
  TissueSelectionSlice,
} from "../../types/built-in";

export const PREPROCESS_INVALIDATION_GRAPH: Record<PreprocessStepId, readonly PreprocessStepId[]> = {
  sourceAssets: [],
  tissueSelection: [],
  exportState: [],
};

const markStale = <T extends PreprocessSliceBase>(slice: T): T => ({
  ...slice,
  status: "stale",
  isStale: true,
  error: null,
});

const invalidateTissueSelectionSlice = (
  slice: TissueSelectionSlice,
): TissueSelectionSlice => ({
  ...markStale(slice),
  previewDataUrl: null,
  selectedSpotIds: null,
  paritySummary: null,
});

const invalidateStep = (
  project: PreprocessProject,
  stepId: PreprocessStepId,
): PreprocessProject => {
  switch (stepId) {
    case "sourceAssets":
      return { ...project, sourceAssets: markStale(project.sourceAssets) };
    case "tissueSelection":
      return { ...project, tissueSelection: invalidateTissueSelectionSlice(project.tissueSelection) };
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
  return invalidateStep(project, "sourceAssets");
}

export function invalidateOnTissueSelectionChange(project: PreprocessProject): PreprocessProject {
  return invalidateStep(project, "tissueSelection");
}
