import { PREPROCESS_STORAGE_SCHEMA_VERSION } from "@/lib/built-in/constants";
import { migratePreprocessProject } from "@/lib/built-in/migrations";
import { DEFAULT_TISSUE_PARAMS } from "@/lib/built-in/tissueThresholds";
import type {
	LegacyPreprocessProject,
	PreprocessProject,
	PreprocessSliceBase,
} from "@/types/built-in";

const WORKFLOW_VERSION = 2;

const createSlice = (
	status: PreprocessSliceBase["status"],
): PreprocessSliceBase => ({
	status,
	isStale: false,
	updatedAt: null,
	error: null,
});

export const normalizeProjectForPersistence = (
	project: PreprocessProject,
): PreprocessProject => ({
	...project,
});

export const normalizeProjectForWorkspace = (
	project: PreprocessProject | LegacyPreprocessProject,
): PreprocessProject => {
	return normalizeProjectForPersistence(migratePreprocessProject(project));
};

export const buildEmptyPreprocessProject = (
	name: string,
): PreprocessProject => {
	const now = new Date().toISOString();

	return {
		id:
			typeof crypto !== "undefined" && crypto.randomUUID
				? crypto.randomUUID()
				: `preprocess-${Date.now()}`,
		name: name.trim(),
		createdAt: now,
		updatedAt: now,
		workflowVersion: WORKFLOW_VERSION,
		storageVersion: PREPROCESS_STORAGE_SCHEMA_VERSION,
		currentStep: "sourceAssets",
		sourceAssets: {
			...createSlice("ready"),
			activeImage: "he",
			images: {
				he: null,
			},
			oversizedImageWarning: null,
		},
		chipConfig: {
			...createSlice("idle"),
			chipType: null,
			rows: null,
			columns: null,
			pitchX: null,
			pitchY: null,
			spotDiameter: null,
			origin: null,
			rotationDegrees: 0,
			placement: null,
			projectedSpots: null,
		},
		tissueSelection: {
			...createSlice("idle"),
			...DEFAULT_TISSUE_PARAMS,
			mode: "matrix",
			thresholdMode: "raw",
			autoSelectedSpotIds: [],
			matrix: null,
			supportState: "unsupported",
			unsupportedReason: null,
			paritySummary: null,
			warning: null,
			selectedSpotIds: null,
		},
	};
};
