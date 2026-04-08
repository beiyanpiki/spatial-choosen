import { PREPROCESS_STORAGE_SCHEMA_VERSION } from './constants';
import { DEFAULT_LOCALIZATION_IMAGE_TRANSFORM } from './localization';
import { DEFAULT_TISSUE_PARAMS, normalizeTissueParams } from './tissueThresholds';
import type {
  HeFocusSlice,
  LegacyPreprocessProject,
  PreprocessProject,
  PreprocessSliceBase,
  PreprocessStepId,
} from '@/types/preprocess';

const HE_FOCUS_WORKFLOW_VERSION = 2;

const STEPS_BEYOND_LOCALIZATION = new Set<PreprocessStepId>([
  'alignment',
  'cropQc',
  'chipConfig',
  'tissueSelection',
  'exportState',
]);

const createSliceBase = (status: PreprocessSliceBase['status']): PreprocessSliceBase => ({
  status,
  isStale: false,
  updatedAt: null,
  error: null,
});

const createHeFocusSlice = (): HeFocusSlice => ({
  ...createSliceBase('ready'),
  targetImage: 'he',
  chipBounds: null,
  handles: [],
  imageTransform: {
    ...DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
  },
  focusedImageDataUrl: null,
});

const normalizeHeFocusSlice = (slice: HeFocusSlice | undefined): HeFocusSlice => {
  if (!slice) {
    return createHeFocusSlice();
  }

  return {
    ...slice,
    targetImage: 'he',
    focusedImageDataUrl: slice.focusedImageDataUrl ?? null,
  };
};

const markSliceStale = <TSlice extends PreprocessSliceBase>(slice: TSlice): TSlice => ({
  ...slice,
  status: 'stale',
  isStale: true,
  error: null,
});

const shouldRewindToHeFocus = (stepId: PreprocessStepId) => STEPS_BEYOND_LOCALIZATION.has(stepId);

export function migratePreprocessProject(
  project: PreprocessProject | LegacyPreprocessProject,
): PreprocessProject {
  const storageVersion = project.storageVersion ?? 0;
  const workflowVersion = project.workflowVersion ?? 0;
  const needsHeFocusMigration =
    workflowVersion < HE_FOCUS_WORKFLOW_VERSION ||
    storageVersion < PREPROCESS_STORAGE_SCHEMA_VERSION ||
    !project.heFocus;

  const tissueSelection = {
    ...project.tissueSelection,
    ...(project.tissueSelection.thresholdMode === 'gray-min'
      ? normalizeTissueParams({
        activationThreshold: project.tissueSelection.activationThreshold,
        blockThreshold: project.tissueSelection.blockThreshold,
        dbscanEps: project.tissueSelection.dbscanEps,
        dbscanMinSamples: project.tissueSelection.dbscanMinSamples,
        minConnectedSpotCount: project.tissueSelection.minConnectedSpotCount,
      })
      : DEFAULT_TISSUE_PARAMS),
    forcedInSpotIds: project.tissueSelection.forcedInSpotIds ?? [],
    forcedOutSpotIds: project.tissueSelection.forcedOutSpotIds ?? [],
    overrideNotice: project.tissueSelection.overrideNotice ?? null,
    autoSelectedSpotIds: project.tissueSelection.autoSelectedSpotIds ?? [],
    selectedRegionId: project.tissueSelection.selectedRegionId ?? null,
    regions: (project.tissueSelection.regions ?? []).map((region) => ({
      ...region,
      paths: region.paths?.length ? region.paths : [region.points],
    })),
    selectedSpotIds: project.tissueSelection.selectedSpotIds ?? null,
  };

  return {
    ...project,
    workflowVersion: Math.max(workflowVersion, HE_FOCUS_WORKFLOW_VERSION),
    storageVersion: PREPROCESS_STORAGE_SCHEMA_VERSION,
    currentStep:
      needsHeFocusMigration && shouldRewindToHeFocus(project.currentStep)
        ? 'heFocus'
        : project.currentStep,
    tissueSelection: needsHeFocusMigration
      ? markSliceStale(tissueSelection)
      : tissueSelection,
    heFocus: normalizeHeFocusSlice(project.heFocus),
    alignment: needsHeFocusMigration
      ? markSliceStale(project.alignment)
      : project.alignment,
    cropQc: needsHeFocusMigration
      ? markSliceStale(project.cropQc)
      : project.cropQc,
    chipConfig: needsHeFocusMigration
      ? markSliceStale(project.chipConfig)
      : project.chipConfig,
    exportState: needsHeFocusMigration
      ? markSliceStale(project.exportState)
      : project.exportState,
  };
}
