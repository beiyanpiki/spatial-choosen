import type {
	ChipConfigSlice,
	LegacyPreprocessProject,
	PreprocessProject,
	PreprocessSliceBase,
	PreprocessSourceImage,
	PreprocessStepId,
	SourceAssetsSlice,
	TissueActivationMatrix,
	TissueSelectionSlice,
} from "@/types/built-in";
import {
	PREPROCESS_STORAGE_SCHEMA_VERSION,
	PREPROCESS_STEP_IDS,
} from "./constants";
import { DEFAULT_TISSUE_PARAMS, normalizeTissueParams } from "./tissueThresholds";

const CURRENT_WORKFLOW_VERSION = 3;

const VALID_STEP_IDS = new Set<PreprocessStepId>(
	PREPROCESS_STEP_IDS as readonly PreprocessStepId[],
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object";

const createSliceBase = (
	status: PreprocessSliceBase["status"],
): PreprocessSliceBase => ({
	status,
	isStale: false,
	updatedAt: null,
	error: null,
});

const createDefaultSourceAssetsSlice = (): SourceAssetsSlice => ({
	...createSliceBase("ready"),
	activeImage: "he",
	images: {
		he: null,
	},
	oversizedImageWarning: null,
});

const createDefaultChipConfigSlice = (): ChipConfigSlice => ({
	...createSliceBase("idle"),
	chipType: null,
	rows: null,
	columns: null,
	pitchX: null,
	pitchY: null,
	origin: null,
	rotationDegrees: 0,
	projectedSpots: null,
});

const normalizeMatrix = (
	value: unknown,
): TissueActivationMatrix | null => {
	if (value == null) {
		return null;
	}

	if (
		!isRecord(value)
		|| typeof value.rows !== "number"
		|| typeof value.columns !== "number"
		|| !Array.isArray(value.values)
	) {
		return null;
	}

	try {
		const matrix = value as TissueActivationMatrix;
		if (
			!Number.isInteger(matrix.rows)
			|| matrix.rows <= 0
			|| !Number.isInteger(matrix.columns)
			|| matrix.columns <= 0
		) {
			return null;
		}
		if (matrix.values.length !== matrix.rows * matrix.columns) {
			return null;
		}
		if (!matrix.values.every((entry) => entry === 0 || entry === 1)) {
			return null;
		}
		return {
			rows: matrix.rows,
			columns: matrix.columns,
			values: [...matrix.values],
		};
	} catch {
		return null;
	}
};

const createDefaultTissueSelectionSlice = (): TissueSelectionSlice => ({
	...createSliceBase("idle"),
	mode: "matrix",
	...normalizeTissueParams({}),
	autoSelectedSpotIds: [],
	matrix: null,
	supportState: "unsupported",
	unsupportedReason: null,
	selectedSpotIds: null,
	paritySummary: null,
	warning: null,
});

const normalizeTissueSelectionSlice = (
	value: unknown,
): TissueSelectionSlice => {
	if (!isRecord(value)) {
		return createDefaultTissueSelectionSlice();
	}

	const {
		status,
		isStale,
		updatedAt,
		error,
		mode,
		thresholdMode,
		activationThreshold,
		blockThreshold,
		dbscanEps,
		dbscanMinSamples,
		minConnectedSpotCount,
		autoSelectedSpotIds,
		matrix,
		supportState,
		unsupportedReason,
		selectedSpotIds,
		paritySummary,
		warning,
		// Legacy region-first fields are intentionally dropped.
		...rest
	} = value as Record<string, unknown> & {
		forcedInSpotIds?: unknown;
		forcedOutSpotIds?: unknown;
		overrideNotice?: unknown;
		regions?: unknown;
		selectedRegionId?: unknown;
		previewDataUrl?: unknown;
	};

	void rest;

	const allowedStatuses = new Set([
		"idle",
		"ready",
		"processing",
		"complete",
		"stale",
		"error",
	]);
	const normalizedStatus =
		typeof status === "string" && allowedStatuses.has(status)
			? (status as PreprocessSliceBase["status"])
			: "idle";
	const normalizedMode =
		mode === "imported" || mode === "matrix" ? mode : "matrix";
	const normalizedSupportState =
		supportState === "supported" || supportState === "unsupported"
			? supportState
			: "unsupported";
	const normalizedThresholdMode =
		thresholdMode === "raw"
		|| thresholdMode === "gray-max"
		|| thresholdMode === "gray-min"
			? thresholdMode
			: DEFAULT_TISSUE_PARAMS.thresholdMode;
	const normalizedParams = normalizeTissueParams({
		thresholdMode: normalizedThresholdMode as TissueSelectionSlice["thresholdMode"],
		activationThreshold:
			typeof activationThreshold === "number" ? activationThreshold : undefined,
		blockThreshold:
			typeof blockThreshold === "number" ? blockThreshold : undefined,
		dbscanEps: typeof dbscanEps === "number" ? dbscanEps : undefined,
		dbscanMinSamples:
			typeof dbscanMinSamples === "number" ? dbscanMinSamples : undefined,
		minConnectedSpotCount:
			typeof minConnectedSpotCount === "number"
				? minConnectedSpotCount
				: undefined,
	});
	const normalizedAutoSelectedSpotIds = Array.isArray(autoSelectedSpotIds)
		? autoSelectedSpotIds.filter(
				(entry): entry is string => typeof entry === "string",
			)
		: [];
	const normalizedSelectedSpotIds = Array.isArray(selectedSpotIds)
		? selectedSpotIds.filter(
				(entry): entry is string => typeof entry === "string",
			)
		: null;

	const slice: TissueSelectionSlice = {
		...createSliceBase("idle"),
		status: normalizedStatus,
		isStale: Boolean(isStale),
		updatedAt:
			typeof updatedAt === "string" || updatedAt === null
				? updatedAt
				: null,
		error: typeof error === "string" || error === null ? error : null,
		mode: normalizedMode as TissueSelectionSlice["mode"],
		thresholdMode:
			normalizedParams.thresholdMode as TissueSelectionSlice["thresholdMode"],
		activationThreshold: normalizedParams.activationThreshold,
		blockThreshold: normalizedParams.blockThreshold,
		dbscanEps: normalizedParams.dbscanEps,
		dbscanMinSamples: normalizedParams.dbscanMinSamples,
		minConnectedSpotCount: normalizedParams.minConnectedSpotCount,
		autoSelectedSpotIds: normalizedAutoSelectedSpotIds,
		matrix: normalizeMatrix(matrix),
		supportState: normalizedSupportState as TissueSelectionSlice["supportState"],
		unsupportedReason:
			typeof unsupportedReason === "string" || unsupportedReason === null
				? unsupportedReason
				: null,
		selectedSpotIds: normalizedSelectedSpotIds,
		paritySummary:
			isRecord(paritySummary)
			&& typeof (paritySummary as Record<string, unknown>).selectedCount === "number"
			&& typeof (paritySummary as Record<string, unknown>).selectedPercent === "number"
			&& typeof (paritySummary as Record<string, unknown>).maskCoverage === "number"
				? {
						selectedCount: (paritySummary as Record<string, unknown>)
							.selectedCount as number,
						selectedPercent: (paritySummary as Record<string, unknown>)
							.selectedPercent as number,
						maskCoverage: (paritySummary as Record<string, unknown>)
							.maskCoverage as number,
					}
				: null,
		warning: typeof warning === "string" || warning === null ? warning : null,
	};

	return slice;
};

const normalizeChipConfigSlice = (value: unknown): ChipConfigSlice => {
	if (!isRecord(value)) {
		return createDefaultChipConfigSlice();
	}

	const {
		status,
		isStale,
		updatedAt,
		error,
		chipType,
		rows,
		columns,
		pitchX,
		pitchY,
		origin,
		rotationDegrees,
	} = value as Record<string, unknown>;

	const allowedStatuses = new Set([
		"idle",
		"ready",
		"processing",
		"complete",
		"stale",
		"error",
	]);
	const normalizedStatus =
		typeof status === "string" && allowedStatuses.has(status)
			? (status as PreprocessSliceBase["status"])
			: "idle";

	const normalizedOrigin = isRecord(origin)
		&& typeof (origin as Record<string, unknown>).x === "number"
		&& typeof (origin as Record<string, unknown>).y === "number"
		? {
				x: (origin as Record<string, unknown>).x as number,
				y: (origin as Record<string, unknown>).y as number,
			}
		: null;

	return {
		...createSliceBase("idle"),
		status: normalizedStatus,
		isStale: Boolean(isStale),
		updatedAt:
			typeof updatedAt === "string" || updatedAt === null ? updatedAt : null,
		error: typeof error === "string" || error === null ? error : null,
		chipType:
			typeof chipType === "string" || chipType === null ? chipType : null,
		rows: typeof rows === "number" ? rows : null,
		columns: typeof columns === "number" ? columns : null,
		pitchX: typeof pitchX === "number" ? pitchX : null,
		pitchY: typeof pitchY === "number" ? pitchY : null,
		origin: normalizedOrigin,
		rotationDegrees:
			typeof rotationDegrees === "number" ? rotationDegrees : 0,
		// projectedSpots are recomputed in the UI after load; never persist them.
		projectedSpots: null,
	};
};

const normalizeSourceAssetsSlice = (value: unknown): SourceAssetsSlice => {
	if (!isRecord(value)) {
		return createDefaultSourceAssetsSlice();
	}

	const { status, isStale, updatedAt, error, oversizedImageWarning, images } =
		value as Record<string, unknown>;

	// The HE source-image meta (fileName, dimensions, etc.) must survive
	// migration so storage can pair it with the persisted IDB blobs on
	// hydration. Eosin and any other legacy kinds are dropped.
	const heImageRaw = isRecord(images)
		? (images as Record<string, unknown>).he
		: null;
	const heImage = isRecord(heImageRaw)
		? (heImageRaw as PreprocessSourceImage)
		: null;

	const allowedStatuses = new Set([
		"idle",
		"ready",
		"processing",
		"complete",
		"stale",
		"error",
	]);
	const normalizedStatus =
		typeof status === "string" && allowedStatuses.has(status)
			? (status as PreprocessSliceBase["status"])
			: "ready";

	const normalizedWarning = isRecord(oversizedImageWarning)
		&& typeof (oversizedImageWarning as Record<string, unknown>).kind === "string"
		&& (oversizedImageWarning as Record<string, unknown>).kind === "he"
		&& typeof (oversizedImageWarning as Record<string, unknown>).longestEdge === "number"
		&& typeof (oversizedImageWarning as Record<string, unknown>).totalPixels === "number"
		? {
				kind: "he" as const,
				longestEdge: (oversizedImageWarning as Record<string, unknown>)
					.longestEdge as number,
				totalPixels: (oversizedImageWarning as Record<string, unknown>)
					.totalPixels as number,
			}
		: null;

	return {
		...createSliceBase("ready"),
		status: normalizedStatus,
		isStale: Boolean(isStale),
		updatedAt:
			typeof updatedAt === "string" || updatedAt === null ? updatedAt : null,
		error: typeof error === "string" || error === null ? error : null,
		activeImage: "he",
		images: {
			he: heImage,
		},
		oversizedImageWarning: normalizedWarning,
	};
};

const normalizeCurrentStep = (value: unknown): PreprocessStepId =>
	typeof value === "string" && VALID_STEP_IDS.has(value as PreprocessStepId)
		? (value as PreprocessStepId)
		: "sourceAssets";

export function migratePreprocessProject(
	project: PreprocessProject | LegacyPreprocessProject,
): PreprocessProject {
	const input = project as unknown as Record<string, unknown>;
	const workflowVersion =
		typeof input.workflowVersion === "number"
			? input.workflowVersion
			: 0;
	const sourceAssets = normalizeSourceAssetsSlice(input.sourceAssets);
	const chipConfig = normalizeChipConfigSlice(input.chipConfig);
	const tissueSelection = normalizeTissueSelectionSlice(input.tissueSelection);

	return {
		id: typeof input.id === "string" ? input.id : "",
		name: typeof input.name === "string" ? input.name : "",
		createdAt:
			typeof input.createdAt === "string" ? input.createdAt : "",
		updatedAt:
			typeof input.updatedAt === "string" ? input.updatedAt : "",
		workflowVersion: Math.max(workflowVersion, CURRENT_WORKFLOW_VERSION),
		storageVersion: PREPROCESS_STORAGE_SCHEMA_VERSION,
		currentStep: normalizeCurrentStep(input.currentStep),
		sourceAssets,
		chipConfig,
		tissueSelection,
	};
}
