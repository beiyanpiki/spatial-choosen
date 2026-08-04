import type {
	CanonicalCropQcSlice,
	CanonicalProjectedSpot,
	HeFocusSlice,
	LegacyAlignmentSlice,
	LegacyChipConfigSlice,
	LegacyCropQcSlice,
	LegacyPreprocessProject,
	LegacyProjectedSpot,
	LegacyTissueSelectionSlice,
	PreprocessProject,
	PreprocessSliceBase,
	PreprocessStepId,
	ProjectedSpot,
	TissueThresholdMode,
} from "@/types/built-in";
import { computeAlignmentStatus, normalizeAlignmentSlice } from "./alignment";
import {
	PREPROCESS_CANONICAL_CROP_ASSET_LEVELS,
	PREPROCESS_STORAGE_SCHEMA_VERSION,
} from "./constants";
import { DEFAULT_LOCALIZATION_IMAGE_TRANSFORM } from "./localization";
import {
	createEmptyMatrix,
	matrixFromSelectedSpotIds,
	selectedSpotIdsFromMatrix,
	validateTissueActivationMatrix,
} from "./tissueMatrix";
import { resolveTissueSelectionSupport } from "./tissueSupport";
import {
	DEFAULT_TISSUE_PARAMS,
	normalizeTissueParams,
} from "./tissueThresholds";

const HE_FOCUS_WORKFLOW_VERSION = 2;
const HE_FOCUS_STORAGE_SCHEMA_VERSION = 3;
const TISSUE_MATRIX_WORKFLOW_VERSION = 3;

const STEPS_BEYOND_LOCALIZATION = new Set<PreprocessStepId>([
	"alignment",
	"cropQc",
	"chipConfig",
	"tissueSelection",
	"exportState",
]);

const STEPS_BEYOND_CROP_QC = new Set<PreprocessStepId>([
	"chipConfig",
	"tissueSelection",
	"exportState",
]);

const STEPS_AT_OR_BEYOND_CROP_QC = new Set<PreprocessStepId>([
	"cropQc",
	"chipConfig",
	"tissueSelection",
	"exportState",
]);

const STEPS_BEYOND_CHIP_CONFIG = new Set<PreprocessStepId>([
	"tissueSelection",
	"exportState",
]);

const createSliceBase = (
	status: PreprocessSliceBase["status"],
): PreprocessSliceBase => ({
	status,
	isStale: false,
	updatedAt: null,
	error: null,
});

const createHeFocusSlice = (): HeFocusSlice => ({
	...createSliceBase("ready"),
	targetImage: "he",
	chipBounds: null,
	handles: [],
	imageTransform: {
		...DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
	},
	focusedImageDataUrl: null,
});

const normalizeHeFocusSlice = (
	slice: HeFocusSlice | undefined,
): HeFocusSlice => {
	if (!slice) {
		return createHeFocusSlice();
	}

	return {
		...slice,
		targetImage: "he",
		focusedImageDataUrl: slice.focusedImageDataUrl ?? null,
	};
};

const normalizeLegacyAlignmentSource = (
	slice: LegacyAlignmentSlice | PreprocessProject["alignment"],
): PreprocessProject["alignment"] => ({
	...slice,
	source:
		slice.source === "manual" ? slice.source : null,
});

const markSliceStale = <TSlice extends PreprocessSliceBase>(
	slice: TSlice,
): TSlice => ({
	...slice,
	status: "stale",
	isStale: true,
	error: null,
});

const shouldRewindToHeFocus = (stepId: PreprocessStepId) =>
	STEPS_BEYOND_LOCALIZATION.has(stepId);
const shouldRewindToCropQc = (stepId: PreprocessStepId) =>
	STEPS_BEYOND_CROP_QC.has(stepId);
const shouldRewindToAlignment = (stepId: PreprocessStepId) =>
	STEPS_AT_OR_BEYOND_CROP_QC.has(stepId);
const shouldRewindToChipConfig = (stepId: PreprocessStepId) =>
	STEPS_BEYOND_CHIP_CONFIG.has(stepId);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object";

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0;

const isPositiveInteger = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value > 0;

const isCanonicalCropQcGeometry = (value: unknown) => {
	if (!isRecord(value) || !isRecord(value.rect)) {
		return false;
	}

	return (
		isFiniteNumber(value.rect.x) &&
		isFiniteNumber(value.rect.y) &&
		isFiniteNumber(value.rect.width) &&
		isFiniteNumber(value.rect.height) &&
		isFiniteNumber(value.width) &&
		isFiniteNumber(value.height)
	);
};

const isSupportedTissueChipType = (
	chipType: string | null,
): chipType is "15um" | "50um" => chipType === "15um" || chipType === "50um";

const normalizeLegacyThresholdMode = (
	thresholdMode: LegacyTissueSelectionSlice["thresholdMode"] | undefined,
): TissueThresholdMode => {
	if (thresholdMode === "dark") {
		return "gray-min";
	}

	if (thresholdMode === "light") {
		return "raw";
	}

	if (
		thresholdMode === "gray-min" ||
		thresholdMode === "gray-max" ||
		thresholdMode === "raw"
	) {
		return thresholdMode;
	}

	return DEFAULT_TISSUE_PARAMS.thresholdMode;
};

const extractLegacyRegionSpotIds = (
	regions: LegacyTissueSelectionSlice["regions"] | undefined,
): string[] =>
	(regions ?? []).flatMap((region) => {
		const spotIds = (region as Record<string, unknown>).spotIds;
		if (!Array.isArray(spotIds)) {
			return [];
		}

		return spotIds.filter(isNonEmptyString);
	});

const isCanonicalTissueSelectionInput = (
	project: PreprocessProject | LegacyPreprocessProject,
): boolean => {
	const slice = project.tissueSelection;

	return (
		(slice.mode === "matrix" || slice.mode === "imported") &&
		(slice.thresholdMode === "raw" ||
			slice.thresholdMode === "gray-max" ||
			slice.thresholdMode === "gray-min") &&
		typeof slice.supportState === "string" &&
		"matrix" in slice
	);
};

const normalizeCanonicalMatrixFirstTissueSelection = (
	project: PreprocessProject | LegacyPreprocessProject,
): PreprocessProject["tissueSelection"] => {
	const {
		forcedInSpotIds: _forcedInSpotIds,
		forcedOutSpotIds: _forcedOutSpotIds,
		overrideNotice: _overrideNotice,
		regions: _regions,
		selectedRegionId: _selectedRegionId,
		previewDataUrl: _previewDataUrl,
		matrix,
		supportState,
		unsupportedReason,
		...rest
	} = project.tissueSelection;

	void _forcedInSpotIds;
	void _forcedOutSpotIds;
	void _overrideNotice;
	void _regions;
	void _selectedRegionId;
	void _previewDataUrl;

	const normalizedParams = normalizeTissueParams({
		thresholdMode: normalizeLegacyThresholdMode(
			project.tissueSelection.thresholdMode,
		),
		activationThreshold: project.tissueSelection.activationThreshold,
		blockThreshold: project.tissueSelection.blockThreshold,
		dbscanEps: project.tissueSelection.dbscanEps,
		dbscanMinSamples: project.tissueSelection.dbscanMinSamples,
		minConnectedSpotCount: project.tissueSelection.minConnectedSpotCount,
	});
	const legacyCompatibilityFields = {
		forcedInSpotIds: [],
		forcedOutSpotIds: [],
		overrideNotice: null,
		regions: [],
		selectedRegionId: null,
		previewDataUrl: null,
	};
	const projectedSpots = project.chipConfig.projectedSpots;
	const normalizedMatrix =
		matrix == null ? null : validateTissueActivationMatrix(matrix);
	const selectedSpotIds =
		normalizedMatrix && projectedSpots
			? selectedSpotIdsFromMatrix(normalizedMatrix, projectedSpots)
			: null;
	const normalizedMode =
		project.tissueSelection.mode === "imported" ? "imported" : "matrix";
	const normalizedSupportState =
		supportState === "supported" ? "supported" : "unsupported";
	const normalizedUnsupportedReason = unsupportedReason ?? null;

	return {
		...rest,
		...normalizedParams,
		...legacyCompatibilityFields,
		mode: normalizedMode,
		matrix: normalizedMatrix,
		supportState: normalizedSupportState,
		unsupportedReason: normalizedUnsupportedReason,
		selectedSpotIds,
	};
};

const normalizeLegacyTissueSelection = (
	project: PreprocessProject | LegacyPreprocessProject,
): PreprocessProject["tissueSelection"] => {
	const {
		forcedInSpotIds,
		forcedOutSpotIds,
		overrideNotice: _overrideNotice,
		regions,
		selectedRegionId: _selectedRegionId,
		previewDataUrl: _previewDataUrl,
		selectedSpotIds,
		matrix: _legacyMatrix,
		supportState: _legacySupportState,
		unsupportedReason: _legacyUnsupportedReason,
		...rest
	} = project.tissueSelection;

	void _overrideNotice;
	void _selectedRegionId;
	void _previewDataUrl;
	void _legacyMatrix;
	void _legacySupportState;
	void _legacyUnsupportedReason;

	const legacyCompatibilityFields = {
		forcedInSpotIds: [],
		forcedOutSpotIds: [],
		overrideNotice: null,
		regions: [],
		selectedRegionId: null,
		previewDataUrl: null,
	};

	const thresholdMode = normalizeLegacyThresholdMode(
		project.tissueSelection.thresholdMode,
	);
	const normalizedParams = normalizeTissueParams({
		thresholdMode,
		activationThreshold: project.tissueSelection.activationThreshold,
		blockThreshold: project.tissueSelection.blockThreshold,
		dbscanEps: project.tissueSelection.dbscanEps,
		dbscanMinSamples: project.tissueSelection.dbscanMinSamples,
		minConnectedSpotCount: project.tissueSelection.minConnectedSpotCount,
	});
	const chipType =
		project.chipConfig.chipType ?? project.localization.chipType ?? null;
	const rows = project.chipConfig.rows;
	const columns = project.chipConfig.columns;
	const support = resolveTissueSelectionSupport({
		chipType,
		rows,
		columns,
	});
	const autoSelectedSpotIds = project.tissueSelection.autoSelectedSpotIds ?? [];
	const forcedOutIdSet = new Set(forcedOutSpotIds ?? []);
	const derivedAutoIds = Array.from(
		new Set(
			[...autoSelectedSpotIds, ...(forcedInSpotIds ?? [])].filter(
				(id) => !forcedOutIdSet.has(id),
			),
		),
	);
	const projectedSpots = project.chipConfig.projectedSpots;
	const legacySelectedIds =
		selectedSpotIds && selectedSpotIds.length > 0
			? selectedSpotIds
			: extractLegacyRegionSpotIds(regions).length > 0
				? extractLegacyRegionSpotIds(regions)
				: derivedAutoIds;

	if (
		support.supportState === "unsupported" &&
		!isSupportedTissueChipType(chipType)
	) {
		return {
			...rest,
			...normalizedParams,
			...legacyCompatibilityFields,
			mode: "matrix",
			autoSelectedSpotIds,
			matrix: null,
			supportState: support.supportState,
			unsupportedReason: support.unsupportedReason,
			selectedSpotIds: null,
		};
	}

	if (!isPositiveInteger(rows) || !isPositiveInteger(columns)) {
		return {
			...rest,
			...normalizedParams,
			...legacyCompatibilityFields,
			mode: "matrix",
			autoSelectedSpotIds,
			matrix: null,
			supportState: support.supportState,
			unsupportedReason: support.unsupportedReason,
			selectedSpotIds: null,
			warning:
				project.tissueSelection.warning ??
				"Legacy tissue selection could not be safely migrated because the chip matrix dimensions are invalid.",
		};
	}

	const emptyMatrix = createEmptyMatrix(rows, columns);

	if (support.supportState === "unsupported") {
		return {
			...rest,
			...normalizedParams,
			...legacyCompatibilityFields,
			mode: "matrix",
			autoSelectedSpotIds,
			matrix: emptyMatrix,
			supportState: support.supportState,
			unsupportedReason: support.unsupportedReason,
			selectedSpotIds: [],
			warning:
				project.tissueSelection.warning ??
				`${chipType ?? "This chip"} legacy tissue data could not be safely migrated, so an empty matrix was created.`,
		};
	}

	if (!projectedSpots) {
		return {
			...rest,
			...normalizedParams,
			...legacyCompatibilityFields,
			mode: "matrix",
			autoSelectedSpotIds,
			matrix: emptyMatrix,
			supportState: support.supportState,
			unsupportedReason: support.unsupportedReason,
			selectedSpotIds: [],
			warning:
				project.tissueSelection.warning ??
				"Legacy tissue selection could not be safely migrated because projected spots are unavailable.",
		};
	}

	const matrix = matrixFromSelectedSpotIds({
		rows,
		columns,
		projectedSpots,
		selectedSpotIds: legacySelectedIds,
	});

	return {
		...rest,
		...normalizedParams,
		...legacyCompatibilityFields,
		mode: "matrix",
		autoSelectedSpotIds,
		matrix,
		supportState: support.supportState,
		unsupportedReason: support.unsupportedReason,
		selectedSpotIds: selectedSpotIdsFromMatrix(matrix, projectedSpots),
	};
};

const normalizeCanonicalTissueSelection = (
	project: PreprocessProject | LegacyPreprocessProject,
): PreprocessProject["tissueSelection"] =>
	isCanonicalTissueSelectionInput(project)
		? normalizeCanonicalMatrixFirstTissueSelection(project)
		: normalizeLegacyTissueSelection(project);

const createEmptyCropAssets = () => ({
	eosin: null,
	he: null,
});

const createEmptyCheckerboardPreview =
	(): CanonicalCropQcSlice["checkerboardPreview"] => ({
		dataUrl: null,
	});

const createEmptyFeatureMatchesPreview =
	(): CanonicalCropQcSlice["featureMatchesPreview"] => ({
		dataUrl: null,
	});

const createEmptyCropPreviewAliases = (): Pick<
	CanonicalCropQcSlice,
	| "eosinPreviewDataUrl"
	| "previewDataUrl"
	| "checkerboardPreviewDataUrl"
	| "featureMatchesPreviewDataUrl"
> => ({
	eosinPreviewDataUrl: null,
	previewDataUrl: null,
	checkerboardPreviewDataUrl: null,
	featureMatchesPreviewDataUrl: null,
});

const isCanonicalCropAsset = (value: unknown): value is { dataUrl: string } =>
	isRecord(value) && isNonEmptyString(value.dataUrl);

const isCanonicalCropAssetSet = (
	value: unknown,
): value is NonNullable<CanonicalCropQcSlice["cropAssets"]["eosin"]> => {
	if (!isRecord(value)) {
		return false;
	}

	return PREPROCESS_CANONICAL_CROP_ASSET_LEVELS.every((level) =>
		isCanonicalCropAsset(value[level]),
	);
};

const hasCanonicalCropContract = (
	slice: LegacyCropQcSlice,
): slice is CanonicalCropQcSlice => {
	if (!isRecord(slice.cropAssets) || !isRecord(slice.checkerboardPreview)) {
		return false;
	}

	const { cropAssets, checkerboardPreview } = slice;
	const checkerboardDataUrl = checkerboardPreview.dataUrl;
	if (checkerboardDataUrl !== null && typeof checkerboardDataUrl !== "string") {
		return false;
	}

	const eosinAssets = cropAssets.eosin;
	const heAssets = cropAssets.he;
	const hasNoAssets = eosinAssets === null && heAssets === null;
	const hasFullAssets =
		isCanonicalCropAssetSet(eosinAssets) && isCanonicalCropAssetSet(heAssets);
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
		return (
			scaleValues.every((value) => value === null) &&
			checkerboardDataUrl === null
		);
	}

	return (
		isFiniteNumber(slice.tissue_hires_scalef) &&
		isFiniteNumber(slice.tissue_lowres_scalef) &&
		(slice.spot_diameter_fullres === null ||
			isFiniteNumber(slice.spot_diameter_fullres)) &&
		isFiniteNumber(slice.fiducial_diameter_fullres)
	);
};

const hasLegacyCropOutputs = (slice: LegacyCropQcSlice) =>
	isNonEmptyString(slice.eosinPreviewDataUrl) ||
	isNonEmptyString(slice.previewDataUrl) ||
	isNonEmptyString(slice.checkerboardPreviewDataUrl);

const hasRepairedCropQcMetadata = (slice: LegacyCropQcSlice) => {
	if (!isRecord(slice) || !("eosinReferenceGeometry" in slice)) {
		return false;
	}

	const geometry = (slice as Record<string, unknown>).eosinReferenceGeometry;
	return geometry === null || isCanonicalCropQcGeometry(geometry);
};

const isHydrationMissingCanonicalAssets = (slice: LegacyCropQcSlice) =>
	isRecord(slice) &&
	(slice as Record<string, unknown>).hydrationMissingCanonicalAssets === true;

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
		keyof CanonicalCropQcSlice &
			(
				| "cropAssets"
				| "tissue_hires_scalef"
				| "tissue_lowres_scalef"
				| "spot_diameter_fullres"
				| "fiducial_diameter_fullres"
				| "eosinPreviewDataUrl"
				| "previewDataUrl"
				| "checkerboardPreviewDataUrl"
				| "checkerboardPreview"
			)
	>;

	if (hasCanonicalCropContract(slice)) {
		if (slice.cropAssets.eosin === null) {
			return {
				hasCanonicalCropContract: true as const,
				slice: {
					...baseCropQcSlice,
 					eosinReferenceGeometry: null,
 					heQcGeometry: null,
 					cropRect: null,
 					cropWidth: null,
 					cropHeight: null,
					cropAssets: createEmptyCropAssets(),
					tissue_hires_scalef: null,
					tissue_lowres_scalef: null,
					spot_diameter_fullres: null,
					fiducial_diameter_fullres: null,
					...createEmptyCropPreviewAliases(),
					checkerboardPreview: createEmptyCheckerboardPreview(),
					featureMatchesPreview: createEmptyFeatureMatchesPreview(),
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
			heAssets === null ||
			tissueHiresScalef === null ||
			tissueLowresScalef === null ||
			fiducialDiameterFullres === null
		) {
			return {
				hasCanonicalCropContract: false as const,
				slice: {
					...baseCropQcSlice,
 					eosinReferenceGeometry: null,
 					heQcGeometry: null,
 					cropRect: null,
 					cropWidth: null,
 					cropHeight: null,
					cropAssets: createEmptyCropAssets(),
					tissue_hires_scalef: null,
					tissue_lowres_scalef: null,
					spot_diameter_fullres: null,
					fiducial_diameter_fullres: null,
					...createEmptyCropPreviewAliases(),
					checkerboardPreview: createEmptyCheckerboardPreview(),
					featureMatchesPreview: createEmptyFeatureMatchesPreview(),
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
				featureMatchesPreviewDataUrl:
					slice.featureMatchesPreview?.dataUrl ?? null,
				featureMatchesPreview: {
					dataUrl: slice.featureMatchesPreview?.dataUrl ?? null,
				},
			} satisfies CanonicalCropQcSlice,
		};
	}

	return {
		hasCanonicalCropContract: false as const,
		slice: {
			...baseCropQcSlice,
			eosinReferenceGeometry: null,
			heQcGeometry: null,
			cropRect: null,
			cropWidth: null,
			cropHeight: null,
			cropAssets: createEmptyCropAssets(),
			tissue_hires_scalef: null,
			tissue_lowres_scalef: null,
			spot_diameter_fullres: null,
			fiducial_diameter_fullres: null,
			...createEmptyCropPreviewAliases(),
			checkerboardPreview: createEmptyCheckerboardPreview(),
			featureMatchesPreview: createEmptyFeatureMatchesPreview(),
			qcAccepted: false,
			issues: [],
		} satisfies CanonicalCropQcSlice,
	};
};

const normalizeProjectedSpot = (
	spot: ProjectedSpot | LegacyProjectedSpot,
): CanonicalProjectedSpot | null => {
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
		!isNonEmptyString(spot.id) ||
		!isNonEmptyString(spot.barcode) ||
		!isFiniteNumber(spot.arrayRow) ||
		!isFiniteNumber(spot.arrayCol) ||
		!isFiniteNumber(spot.x) ||
		!isFiniteNumber(spot.y) ||
		width === null ||
		height === null
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
			} satisfies PreprocessProject["chipConfig"],
		};
	}

	const normalizedProjectedSpots = slice.projectedSpots.map(
		normalizeProjectedSpot,
	);
	if (normalizedProjectedSpots.some((spot) => spot === null)) {
		return {
			resetProjectedSpots: slice.projectedSpots.length > 0,
			slice: {
				...slice,
				projectedSpots: null,
			} satisfies PreprocessProject["chipConfig"],
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
		} satisfies PreprocessProject["chipConfig"],
	};
};

const invalidateImportedCropQcSlice = (
	slice: CanonicalCropQcSlice,
): CanonicalCropQcSlice => ({
	...markCropQcStale(slice),
	cropAssets: createEmptyCropAssets(),
	tissue_hires_scalef: null,
	tissue_lowres_scalef: null,
	spot_diameter_fullres: null,
	fiducial_diameter_fullres: null,
	...createEmptyCropPreviewAliases(),
	checkerboardPreview: createEmptyCheckerboardPreview(),
	featureMatchesPreview: createEmptyFeatureMatchesPreview(),
	qcAccepted: false,
	issues: [],
});

const markCropQcStale = (
	slice: CanonicalCropQcSlice,
): CanonicalCropQcSlice => ({
	...markSliceStale(slice),
	eosinReferenceGeometry: null,
	heQcGeometry: null,
	cropRect: null,
	cropWidth: null,
	cropHeight: null,
});

const invalidateImportedChipConfigSlice = (
	slice: PreprocessProject["chipConfig"],
): PreprocessProject["chipConfig"] => ({
	...markSliceStale(slice),
	projectedSpots: null,
});

const invalidateImportedTissueSelectionSlice = (
	slice: PreprocessProject["tissueSelection"],
): PreprocessProject["tissueSelection"] => ({
	...markSliceStale(slice),
	previewDataUrl: null,
	matrix: null,
	autoSelectedSpotIds: [],
	selectedSpotIds: null,
	paritySummary: null,
	supportState: "unsupported",
	unsupportedReason: null,
});

const invalidateImportedExportStateSlice = (
	slice: PreprocessProject["exportState"],
): PreprocessProject["exportState"] => ({
	...markSliceStale(slice),
	artifacts: [],
	lastExportedAt: null,
});

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
	const needsRepairedCropQcMetadataReset =
		!hasRepairedCropQcMetadata(project.cropQc) &&
		(project.cropQc.qcAccepted ||
			project.currentStep === "cropQc" ||
			shouldRewindToCropQc(project.currentStep) ||
			project.cropQc.status === "complete" ||
			project.cropQc.status === "processing");
	const needsCropQcReset =
		isHydrationMissingCanonicalAssets(project.cropQc) ||
		needsRepairedCropQcMetadataReset ||
		(!normalizedCropQc.hasCanonicalCropContract &&
			(hasLegacyCropOutputs(project.cropQc) ||
				project.cropQc.qcAccepted ||
				project.currentStep === "cropQc" ||
				shouldRewindToCropQc(project.currentStep) ||
				project.cropQc.status === "complete" ||
				project.cropQc.status === "processing"));
	const needsChipConfigReset =
		normalizedChipConfig.resetProjectedSpots &&
		(project.currentStep === "chipConfig" ||
			shouldRewindToChipConfig(project.currentStep) ||
			(project.chipConfig.projectedSpots?.length ?? 0) > 0 ||
			project.chipConfig.status === "complete" ||
			project.chipConfig.status === "processing");
	const normalizedAlignment = normalizeAlignmentSlice(
		normalizeLegacyAlignmentSource(project.alignment),
	);
	const effectiveAlignmentAccepted =
		normalizedAlignment.solveAccepted &&
		(normalizedAlignment.qualityFlags.accepted ||
			normalizedAlignment.forceAccepted);
	const normalizedAlignmentStatus = computeAlignmentStatus({
		hasReferenceImage: Boolean(
			project.sourceAssets.images[normalizedAlignment.referenceImage],
		),
		hasMovingImage: Boolean(
			project.sourceAssets.images[normalizedAlignment.movingImage],
		),
		solveAccepted: effectiveAlignmentAccepted,
		failureReason: normalizedAlignment.failureReason,
	});
	const migratedAlignmentStatus =
		project.alignment.status === "complete"
			? normalizedAlignmentStatus
			: normalizedAlignment.status;
	const hasInvalidLegacyCompleteAlignment =
		project.alignment.status === "complete" &&
		migratedAlignmentStatus !== "complete";
	const needsAlignmentRewind =
		hasInvalidLegacyCompleteAlignment &&
		shouldRewindToAlignment(project.currentStep);
	const needsAlignmentDownstreamReset =
		hasInvalidLegacyCompleteAlignment &&
		(shouldRewindToAlignment(project.currentStep) ||
			project.cropQc.qcAccepted ||
			project.cropQc.status === "complete" ||
			project.cropQc.status === "processing" ||
			project.chipConfig.status === "complete" ||
			project.chipConfig.status === "processing" ||
			project.tissueSelection.status === "complete" ||
			project.tissueSelection.status === "processing" ||
			project.exportState.status === "ready" ||
			project.exportState.status === "complete" ||
			project.exportState.status === "processing");

	const tissueSelection = normalizeCanonicalTissueSelection(project);

	return {
		...project,
		workflowVersion: Math.max(
			workflowVersion,
			HE_FOCUS_WORKFLOW_VERSION,
			TISSUE_MATRIX_WORKFLOW_VERSION,
		),
		storageVersion: PREPROCESS_STORAGE_SCHEMA_VERSION,
		currentStep:
			needsHeFocusMigration && shouldRewindToHeFocus(project.currentStep)
				? "heFocus"
				: needsAlignmentRewind
					? "alignment"
					: needsCropQcReset && shouldRewindToCropQc(project.currentStep)
						? "cropQc"
						: needsChipConfigReset &&
								shouldRewindToChipConfig(project.currentStep)
							? "chipConfig"
							: project.currentStep,
		tissueSelection: needsHeFocusMigration
			? markSliceStale(tissueSelection)
			: needsRepairedCropQcMetadataReset
				? invalidateImportedTissueSelectionSlice(tissueSelection)
				: needsAlignmentDownstreamReset ||
						needsCropQcReset ||
						needsChipConfigReset
					? markSliceStale(tissueSelection)
					: tissueSelection,
		heFocus: normalizeHeFocusSlice(project.heFocus),
		alignment: needsHeFocusMigration
			? markSliceStale(normalizedAlignment)
			: {
					...normalizedAlignment,
					status: migratedAlignmentStatus,
				},
		cropQc: needsHeFocusMigration
			? markCropQcStale(normalizedCropQc.slice)
			: needsRepairedCropQcMetadataReset
				? invalidateImportedCropQcSlice(normalizedCropQc.slice)
				: needsAlignmentDownstreamReset || needsCropQcReset
					? markCropQcStale(normalizedCropQc.slice)
					: normalizedCropQc.slice,
		chipConfig: needsHeFocusMigration
			? markSliceStale(normalizedChipConfig.slice)
			: needsRepairedCropQcMetadataReset
				? invalidateImportedChipConfigSlice(normalizedChipConfig.slice)
				: needsAlignmentDownstreamReset ||
						needsCropQcReset ||
						needsChipConfigReset
					? markSliceStale(normalizedChipConfig.slice)
					: normalizedChipConfig.slice,
		exportState: needsHeFocusMigration
			? markSliceStale(project.exportState)
			: needsRepairedCropQcMetadataReset
				? invalidateImportedExportStateSlice(project.exportState)
				: needsAlignmentDownstreamReset ||
						needsCropQcReset ||
						needsChipConfigReset
					? markSliceStale(project.exportState)
					: project.exportState,
	};
}
