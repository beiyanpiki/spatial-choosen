import { normalizeAlignmentSlice } from "@/lib/preprocess/alignment";
import { PREPROCESS_STORAGE_SCHEMA_VERSION } from "@/lib/preprocess/constants";
import {
	DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
	normalizeLocalizationImageTransform,
	normalizeLocalizationSlice,
} from "@/lib/preprocess/localization";
import { migratePreprocessProject } from "@/lib/preprocess/migrations";
import { DEFAULT_TISSUE_PARAMS } from "@/lib/preprocess/tissueThresholds";
import type {
	AlignmentSlice,
	CanonicalCropQcGeometry,
	CropQcSlice,
	HeFocusAutoProposal,
	HeFocusSlice,
	LegacyHeFocusSlice,
	LegacyPreprocessProject,
	PreprocessPoint,
	PreprocessProject,
	PreprocessRect,
	PreprocessSliceBase,
} from "@/types/preprocess";

const WORKFLOW_VERSION = 2;

const createSlice = (
	status: PreprocessSliceBase["status"],
): PreprocessSliceBase => ({
	status,
	isStale: false,
	updatedAt: null,
	error: null,
});

const createDefaultImageTransform = () => ({
	...DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
});

export const createHeFocusAutoProposal = (): HeFocusAutoProposal => ({
	status: "idle",
	method: null,
	coarseBounds: null,
	refinedBounds: null,
	refinedQuad: null,
	rotationDegrees: null,
	eccCorrelation: null,
	failureReason: null,
});

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const normalizePositiveNumber = (value: unknown): number | null =>
	isFiniteNumber(value) && value > 0 ? value : null;

const normalizeRect = (value: unknown): PreprocessRect | null => {
	if (!value || typeof value !== "object") return null;

	const rect = value as Partial<PreprocessRect>;
	return isFiniteNumber(rect.x) &&
		isFiniteNumber(rect.y) &&
		isFiniteNumber(rect.width) &&
		isFiniteNumber(rect.height)
		? {
				x: rect.x,
				y: rect.y,
				width: rect.width,
				height: rect.height,
			}
		: null;
};

const normalizePoint = (value: unknown): PreprocessPoint | null => {
	if (!value || typeof value !== "object") return null;

	const point = value as Partial<PreprocessPoint>;
	return isFiniteNumber(point.x) && isFiniteNumber(point.y)
		? { x: point.x, y: point.y }
		: null;
};

const buildHeFocusHandles = (rect: PreprocessRect): HeFocusSlice["handles"] => [
	{ id: "nw", label: "NW", point: { x: rect.x, y: rect.y } },
	{
		id: "ne",
		label: "NE",
		point: { x: rect.x + rect.width, y: rect.y },
	},
	{
		id: "se",
		label: "SE",
		point: { x: rect.x + rect.width, y: rect.y + rect.height },
	},
	{
		id: "sw",
		label: "SW",
		point: { x: rect.x, y: rect.y + rect.height },
	},
];

const normalizeQuad = (value: unknown): HeFocusAutoProposal["refinedQuad"] => {
	if (!Array.isArray(value) || value.length !== 4) return null;

	const normalizedPoints = value.map(normalizePoint);
	return normalizedPoints.every((point) => point !== null)
		? [
				normalizedPoints[0],
				normalizedPoints[1],
				normalizedPoints[2],
				normalizedPoints[3],
			]
		: null;
};

const normalizeCropQcGeometry = (
	value: unknown,
): CanonicalCropQcGeometry | null => {
	if (!value || typeof value !== "object") return null;

	const geometry = value as Partial<CanonicalCropQcGeometry>;
	const rect = normalizeRect(geometry.rect);
	return rect !== null &&
		isFiniteNumber(geometry.width) &&
		isFiniteNumber(geometry.height)
		? {
				rect,
				width: geometry.width,
				height: geometry.height,
			}
		: null;
};

const normalizeCropQcLegacyGeometry = (
	cropRect: CropQcSlice["cropRect"],
	cropWidth: CropQcSlice["cropWidth"],
	cropHeight: CropQcSlice["cropHeight"],
): CanonicalCropQcGeometry | null => {
	const rect = normalizeRect(cropRect);
	return rect !== null &&
		isFiniteNumber(cropWidth) &&
		isFiniteNumber(cropHeight)
		? {
				rect,
				width: cropWidth,
				height: cropHeight,
			}
		: null;
};

const normalizeCropQcSlice = (slice: CropQcSlice): CropQcSlice => {
	const isStale = slice.status === "stale";
	const hasExplicitEosinReferenceGeometry = Object.hasOwn(
		slice,
		"eosinReferenceGeometry",
	);
	const canUseLegacyGeometryFallback =
		!isStale || hasExplicitEosinReferenceGeometry;
	const eosinReferenceGeometry =
		isStale
			? null
			: normalizeCropQcGeometry(slice.eosinReferenceGeometry) ??
				(canUseLegacyGeometryFallback
			? normalizeCropQcLegacyGeometry(
					slice.cropRect,
					slice.cropWidth,
					slice.cropHeight,
				)
			: null);
	const heQcGeometry = isStale ? null : normalizeCropQcGeometry(slice.heQcGeometry);
	const cropWidth = normalizePositiveNumber(slice.cropWidth) ?? eosinReferenceGeometry?.width ?? null;
	const cropHeight = normalizePositiveNumber(slice.cropHeight) ?? eosinReferenceGeometry?.height ?? null;

	return {
		...slice,
		eosinReferenceGeometry,
		heQcGeometry,
		cropRect: eosinReferenceGeometry?.rect ?? null,
		cropWidth,
		cropHeight,
	};
};

const normalizeHeFocusAutoProposal = (
	autoProposal: LegacyHeFocusSlice["autoProposal"],
): HeFocusAutoProposal => {
	const defaults = createHeFocusAutoProposal();
	if (!autoProposal) return defaults;

	return {
		status:
			autoProposal.status === "accepted" ||
			autoProposal.status === "fallback" ||
			autoProposal.status === "failed"
				? autoProposal.status
				: defaults.status,
		method:
			typeof autoProposal.method === "string" && autoProposal.method.length > 0
				? autoProposal.method
				: null,
		coarseBounds: normalizeRect(autoProposal.coarseBounds),
		refinedBounds: normalizeRect(autoProposal.refinedBounds),
		refinedQuad: normalizeQuad(autoProposal.refinedQuad),
		rotationDegrees: isFiniteNumber(autoProposal.rotationDegrees)
			? autoProposal.rotationDegrees
			: null,
		eccCorrelation: isFiniteNumber(autoProposal.eccCorrelation)
			? autoProposal.eccCorrelation
			: null,
		failureReason:
			typeof autoProposal.failureReason === "string"
				? autoProposal.failureReason
				: null,
	};
};

export const normalizeAlignmentSource = (
	source: unknown,
): AlignmentSlice["source"] =>
	source === "auto" || source === "manual" ? source : null;

export const createHeFocusSlice = (
	status: PreprocessSliceBase["status"],
): HeFocusSlice => ({
	...createSlice(status),
	targetImage: "he",
	chipBounds: null,
	handles: [],
	imageTransform: createDefaultImageTransform(),
	autoProposal: createHeFocusAutoProposal(),
	focusedImageDataUrl: null,
});

export const normalizeHeFocusSlice = (
	slice: HeFocusSlice | LegacyHeFocusSlice,
): HeFocusSlice => {
	const chipBounds = normalizeRect(slice.chipBounds);

	return {
		...createHeFocusSlice(slice.status),
		...slice,
		targetImage: "he",
		chipBounds,
		handles: chipBounds ? buildHeFocusHandles(chipBounds) : [],
		imageTransform: normalizeLocalizationImageTransform(slice.imageTransform),
		autoProposal: normalizeHeFocusAutoProposal(slice.autoProposal),
		focusedImageDataUrl: slice.focusedImageDataUrl ?? null,
	};
};

export const normalizeProjectForPersistence = (
	project: PreprocessProject,
): PreprocessProject => ({
	...project,
	localization: normalizeLocalizationSlice(project.localization),
	heFocus: normalizeHeFocusSlice(project.heFocus),
	alignment: {
		...normalizeAlignmentSlice(project.alignment),
		source: normalizeAlignmentSource(project.alignment.source),
	},
	cropQc: normalizeCropQcSlice(project.cropQc),
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
			activeImage: "eosin",
			images: {
				eosin: null,
				he: null,
			},
			oversizedImageWarning: null,
		},
		localization: {
			...createSlice("idle"),
			targetImage: "eosin",
			chipType: null,
			method: null,
			chipBounds: null,
			handles: [],
			boxColor: "green",
			imageTransform: createDefaultImageTransform(),
		},
		heFocus: createHeFocusSlice("idle"),
		alignment: {
			...createSlice("idle"),
			referenceImage: "eosin",
			movingImage: "he",
			movingImageTransform: createDefaultImageTransform(),
			overlayOpacity: 0.5,
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
			failureReason: null,
			transform: null,
			previewDataUrl: null,
		},
		cropQc: {
			...createSlice("idle"),
			eosinReferenceGeometry: null,
			heQcGeometry: null,
			cropRect: null,
			cropWidth: null,
			cropHeight: null,
			paddingRatio: 0.02,
			checkerboardTileSize: 64,
			overlayOpacity: 0.5,
			qcAccepted: false,
			issues: [],
			eosinPreviewDataUrl: null,
			previewDataUrl: null,
			checkerboardPreviewDataUrl: null,
			featureMatchesPreviewDataUrl: null,
			featureMatchesPreview: {
				dataUrl: null,
			},
		},
		chipConfig: {
			...createSlice("idle"),
			chipType: null,
			rows: null,
			columns: null,
			pitchX: null,
			pitchY: null,
			origin: null,
			rotationDegrees: 0,
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
		exportState: {
			...createSlice("idle"),
			requestedFormats: [],
			lastExportedAt: null,
			artifacts: [],
		},
	};
};
