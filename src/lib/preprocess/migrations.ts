import {
  PREPROCESS_CANONICAL_CROP_ASSET_LEVELS,
  PREPROCESS_STORAGE_SCHEMA_VERSION,
} from './constants';
import { DEFAULT_LOCALIZATION_IMAGE_TRANSFORM } from './localization';
import { DEFAULT_TISSUE_PARAMS, normalizeTissueParams } from './tissueThresholds';
import type {
  CanonicalCropQcSlice,
  CanonicalProjectedSpot,
  HeFocusSlice,
  LegacyChipConfigSlice,
  LegacyCropQcSlice,
  LegacyPreprocessProject,
  LegacyProjectedSpot,
  PreprocessProject,
  PreprocessSliceBase,
  PreprocessStepId,
  ProjectedSpot,
} from '@/types/preprocess';

const HE_FOCUS_WORKFLOW_VERSION = 2;
const HE_FOCUS_STORAGE_SCHEMA_VERSION = 3;

const STEPS_BEYOND_LOCALIZATION = new Set<PreprocessStepId>([
  'alignment',
  'cropQc',
  'chipConfig',
  'tissueSelection',
  'exportState',
]);

const STEPS_BEYOND_CROP_QC = new Set<PreprocessStepId>([
  'chipConfig',
  'tissueSelection',
  'exportState',
]);

const STEPS_BEYOND_CHIP_CONFIG = new Set<PreprocessStepId>([
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
const shouldRewindToCropQc = (stepId: PreprocessStepId) => STEPS_BEYOND_CROP_QC.has(stepId);
const shouldRewindToChipConfig = (stepId: PreprocessStepId) => STEPS_BEYOND_CHIP_CONFIG.has(stepId);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const createEmptyCropAssets = () => ({
  eosin: null,
  he: null,
});

const createEmptyCheckerboardPreview = (): CanonicalCropQcSlice['checkerboardPreview'] => ({
  dataUrl: null,
});

const createEmptyCropPreviewAliases = (): Pick<
  CanonicalCropQcSlice,
  'eosinPreviewDataUrl' | 'previewDataUrl' | 'checkerboardPreviewDataUrl'
> => ({
  eosinPreviewDataUrl: null,
  previewDataUrl: null,
  checkerboardPreviewDataUrl: null,
});

const isCanonicalCropAsset = (value: unknown): value is { dataUrl: string } => (
  isRecord(value) && isNonEmptyString(value.dataUrl)
);

const isCanonicalCropAssetSet = (
  value: unknown,
): value is NonNullable<CanonicalCropQcSlice['cropAssets']['eosin']> => {
  if (!isRecord(value)) {
    return false;
  }

  return PREPROCESS_CANONICAL_CROP_ASSET_LEVELS.every((level) => isCanonicalCropAsset(value[level]));
};

const hasCanonicalCropContract = (slice: LegacyCropQcSlice): slice is CanonicalCropQcSlice => {
  if (!isRecord(slice.cropAssets) || !isRecord(slice.checkerboardPreview)) {
    return false;
  }

  const { cropAssets, checkerboardPreview } = slice;
  const checkerboardDataUrl = checkerboardPreview.dataUrl;
  if (checkerboardDataUrl !== null && typeof checkerboardDataUrl !== 'string') {
    return false;
  }

  const eosinAssets = cropAssets.eosin;
  const heAssets = cropAssets.he;
  const hasNoAssets = eosinAssets === null && heAssets === null;
  const hasFullAssets = isCanonicalCropAssetSet(eosinAssets) && isCanonicalCropAssetSet(heAssets);
  if (!hasNoAssets && !hasFullAssets) {
    return false;
  }

  const scaleValues = [
    slice.tissue_hires_scalef,
    slice.tissue_lowres_scalef,
    slice.spot_diameter_fullres,
    slice.fiducial_diameter_fullres,
  ];

  if (hasNoAssets) {
    return scaleValues.every((value) => value === null) && checkerboardDataUrl === null;
  }

  return (
    isFiniteNumber(slice.tissue_hires_scalef)
    && isFiniteNumber(slice.tissue_lowres_scalef)
    && (slice.spot_diameter_fullres === null || isFiniteNumber(slice.spot_diameter_fullres))
    && isFiniteNumber(slice.fiducial_diameter_fullres)
  );
};

const hasLegacyCropOutputs = (slice: LegacyCropQcSlice) => (
  isNonEmptyString(slice.eosinPreviewDataUrl)
  || isNonEmptyString(slice.previewDataUrl)
  || isNonEmptyString(slice.checkerboardPreviewDataUrl)
);

const isHydrationMissingCanonicalAssets = (slice: LegacyCropQcSlice) => (
  isRecord(slice)
  && (slice as Record<string, unknown>).hydrationMissingCanonicalAssets === true
);

const normalizeCropQcSlice = (slice: LegacyCropQcSlice) => {
  const hydrationAwareSlice = slice as LegacyCropQcSlice & {
    hydrationMissingCanonicalAssets?: boolean;
  };
  const {
    hydrationMissingCanonicalAssets: _hydrationMissingCanonicalAssets,
    eosinPreviewDataUrl: _legacyEosinPreviewDataUrl,
    previewDataUrl: _legacyPreviewDataUrl,
    checkerboardPreviewDataUrl: _legacyCheckerboardPreviewDataUrl,
    cropAssets: _legacyCropAssets,
    checkerboardPreview: _legacyCheckerboardPreview,
    tissue_hires_scalef: _legacyTissueHiresScalef,
    tissue_lowres_scalef: _legacyTissueLowresScalef,
    spot_diameter_fullres: _legacySpotDiameterFullres,
    fiducial_diameter_fullres: _legacyFiducialDiameterFullres,
    ...rest
  } = hydrationAwareSlice;

  void _legacyEosinPreviewDataUrl;
  void _legacyPreviewDataUrl;
  void _legacyCheckerboardPreviewDataUrl;
  void _hydrationMissingCanonicalAssets;
  void _legacyCropAssets;
  void _legacyCheckerboardPreview;
  void _legacyTissueHiresScalef;
  void _legacyTissueLowresScalef;
  void _legacySpotDiameterFullres;
  void _legacyFiducialDiameterFullres;

  const baseCropQcSlice = rest as Omit<
    CanonicalCropQcSlice,
    keyof CanonicalCropQcSlice & (
      | 'cropAssets'
      | 'tissue_hires_scalef'
      | 'tissue_lowres_scalef'
      | 'spot_diameter_fullres'
      | 'fiducial_diameter_fullres'
      | 'eosinPreviewDataUrl'
      | 'previewDataUrl'
      | 'checkerboardPreviewDataUrl'
      | 'checkerboardPreview'
    )
  >;

  if (hasCanonicalCropContract(slice)) {
    if (slice.cropAssets.eosin === null) {
      return {
        hasCanonicalCropContract: true as const,
        slice: {
          ...baseCropQcSlice,
          cropAssets: createEmptyCropAssets(),
          tissue_hires_scalef: null,
          tissue_lowres_scalef: null,
          spot_diameter_fullres: null,
          fiducial_diameter_fullres: null,
          ...createEmptyCropPreviewAliases(),
          checkerboardPreview: createEmptyCheckerboardPreview(),
        } satisfies CanonicalCropQcSlice,
      };
    }

    const eosinAssets = slice.cropAssets.eosin;
    const heAssets = slice.cropAssets.he;
    const tissueHiresScalef = slice.tissue_hires_scalef;
    const tissueLowresScalef = slice.tissue_lowres_scalef;
    const spotDiameterFullres = slice.spot_diameter_fullres;
    const fiducialDiameterFullres = slice.fiducial_diameter_fullres;

    if (
      heAssets === null
      || tissueHiresScalef === null
      || tissueLowresScalef === null
      || fiducialDiameterFullres === null
    ) {
      return {
        hasCanonicalCropContract: false as const,
        slice: {
          ...baseCropQcSlice,
          cropAssets: createEmptyCropAssets(),
          tissue_hires_scalef: null,
          tissue_lowres_scalef: null,
          spot_diameter_fullres: null,
          fiducial_diameter_fullres: null,
          ...createEmptyCropPreviewAliases(),
          checkerboardPreview: createEmptyCheckerboardPreview(),
          qcAccepted: false,
          issues: [],
        } satisfies CanonicalCropQcSlice,
      };
    }

    return {
      hasCanonicalCropContract: true as const,
      slice: {
        ...baseCropQcSlice,
        cropAssets: {
          eosin: eosinAssets,
          he: heAssets,
        },
        tissue_hires_scalef: tissueHiresScalef,
        tissue_lowres_scalef: tissueLowresScalef,
        spot_diameter_fullres: spotDiameterFullres,
        fiducial_diameter_fullres: fiducialDiameterFullres,
        eosinPreviewDataUrl: eosinAssets.fullres.dataUrl,
        previewDataUrl: heAssets.fullres.dataUrl,
        checkerboardPreviewDataUrl: slice.checkerboardPreview.dataUrl,
        checkerboardPreview: {
          dataUrl: slice.checkerboardPreview.dataUrl,
        },
      } satisfies CanonicalCropQcSlice,
    };
  }

  return {
    hasCanonicalCropContract: false as const,
    slice: {
      ...baseCropQcSlice,
      cropAssets: createEmptyCropAssets(),
      tissue_hires_scalef: null,
      tissue_lowres_scalef: null,
      spot_diameter_fullres: null,
      fiducial_diameter_fullres: null,
      ...createEmptyCropPreviewAliases(),
      checkerboardPreview: createEmptyCheckerboardPreview(),
      qcAccepted: false,
      issues: [],
    } satisfies CanonicalCropQcSlice,
  };
};

const normalizeProjectedSpot = (spot: ProjectedSpot | LegacyProjectedSpot): CanonicalProjectedSpot | null => {
  const canonicalWidth = (spot as ProjectedSpot).width;
  const canonicalHeight = (spot as ProjectedSpot).height;
  const legacyDiameterX = (spot as LegacyProjectedSpot).diameterX;
  const legacyDiameterY = (spot as LegacyProjectedSpot).diameterY;

  const width = isFiniteNumber(canonicalWidth)
    ? canonicalWidth
    : isFiniteNumber(legacyDiameterX)
      ? legacyDiameterX
      : null;
  const height = isFiniteNumber(canonicalHeight)
    ? canonicalHeight
    : isFiniteNumber(legacyDiameterY)
      ? legacyDiameterY
      : null;

  if (
    !isNonEmptyString(spot.id)
    || !isNonEmptyString(spot.barcode)
    || !isFiniteNumber(spot.arrayRow)
    || !isFiniteNumber(spot.arrayCol)
    || !isFiniteNumber(spot.x)
    || !isFiniteNumber(spot.y)
    || width === null
    || height === null
  ) {
    return null;
  }

  return {
    id: spot.id,
    barcode: spot.barcode,
    arrayRow: spot.arrayRow,
    arrayCol: spot.arrayCol,
    x: spot.x,
    y: spot.y,
    width,
    height,
    diameterX: width,
    diameterY: height,
  } satisfies CanonicalProjectedSpot;
};

const normalizeChipConfigSlice = (slice: LegacyChipConfigSlice) => {
  if (slice.projectedSpots === null) {
    return {
      resetProjectedSpots: false,
      slice: {
        ...slice,
        projectedSpots: null,
      } satisfies PreprocessProject['chipConfig'],
    };
  }

  const normalizedProjectedSpots = slice.projectedSpots.map(normalizeProjectedSpot);
  if (normalizedProjectedSpots.some((spot) => spot === null)) {
    return {
      resetProjectedSpots: slice.projectedSpots.length > 0,
      slice: {
        ...slice,
        projectedSpots: null,
      } satisfies PreprocessProject['chipConfig'],
    };
  }

  const canonicalProjectedSpots = normalizedProjectedSpots.filter(
    (spot): spot is CanonicalProjectedSpot => spot !== null,
  );

  return {
    resetProjectedSpots: false,
    slice: {
      ...slice,
      projectedSpots: canonicalProjectedSpots,
    } satisfies PreprocessProject['chipConfig'],
  };
};

export function migratePreprocessProject(
  project: PreprocessProject | LegacyPreprocessProject,
): PreprocessProject {
  const storageVersion = project.storageVersion ?? 0;
  const workflowVersion = project.workflowVersion ?? 0;
  const needsHeFocusMigration =
    workflowVersion < HE_FOCUS_WORKFLOW_VERSION ||
    storageVersion < HE_FOCUS_STORAGE_SCHEMA_VERSION ||
    !project.heFocus;
  const normalizedCropQc = normalizeCropQcSlice(project.cropQc);
  const normalizedChipConfig = normalizeChipConfigSlice(project.chipConfig);
  const needsCropQcReset = isHydrationMissingCanonicalAssets(project.cropQc)
    || (!normalizedCropQc.hasCanonicalCropContract && (
      hasLegacyCropOutputs(project.cropQc)
      || project.cropQc.qcAccepted
      || project.currentStep === 'cropQc'
      || shouldRewindToCropQc(project.currentStep)
      || project.cropQc.status === 'complete'
      || project.cropQc.status === 'processing'
    ));
  const needsChipConfigReset = normalizedChipConfig.resetProjectedSpots && (
    project.currentStep === 'chipConfig'
    || shouldRewindToChipConfig(project.currentStep)
    || ((project.chipConfig.projectedSpots?.length ?? 0) > 0)
    || project.chipConfig.status === 'complete'
    || project.chipConfig.status === 'processing'
  );

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
        : needsCropQcReset && shouldRewindToCropQc(project.currentStep)
          ? 'cropQc'
          : needsChipConfigReset && shouldRewindToChipConfig(project.currentStep)
            ? 'chipConfig'
            : project.currentStep,
    tissueSelection: needsHeFocusMigration
      ? markSliceStale(tissueSelection)
      : needsCropQcReset || needsChipConfigReset
        ? markSliceStale(tissueSelection)
      : tissueSelection,
    heFocus: normalizeHeFocusSlice(project.heFocus),
    alignment: needsHeFocusMigration
      ? markSliceStale(project.alignment)
      : project.alignment,
    cropQc: needsHeFocusMigration
      ? markSliceStale(normalizedCropQc.slice)
      : needsCropQcReset
        ? markSliceStale(normalizedCropQc.slice)
        : normalizedCropQc.slice,
    chipConfig: needsHeFocusMigration
      ? markSliceStale(normalizedChipConfig.slice)
      : needsCropQcReset || needsChipConfigReset
        ? markSliceStale(normalizedChipConfig.slice)
        : normalizedChipConfig.slice,
    exportState: needsHeFocusMigration
      ? markSliceStale(project.exportState)
      : needsCropQcReset || needsChipConfigReset
        ? markSliceStale(project.exportState)
      : project.exportState,
  };
}
