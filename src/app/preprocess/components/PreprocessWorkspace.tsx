"use client";

import {
	Badge,
	Box,
	Button,
	Card,
	CardBody,
	Flex,
	FormControl,
	FormLabel,
	Heading,
	HStack,
	Image,
	Input,
	Select,
	Spinner,
	Stack,
	Text,
	useToast,
} from "@chakra-ui/react";
import {
	type ComponentProps,
	type ComponentType,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	AlignmentSlice,
	CropQcSlice,
	HeFocusSlice,
	LocalizationBoxColor,
	LocalizationImageTransform,
	LocalizationSlice,
	PreprocessProject,
	PreprocessPoint,
	PreprocessRect,
	PreprocessSourceImage,
	PreprocessStepId,
	TissueActivationValue,
} from "@/types/preprocess";
import {
	normalizeAlignmentSlice,
} from "@/lib/preprocess/alignment";
import {
	type ChipConfigData,
	type ChipConfigManifest,
	loadAllChipConfigManifests,
	loadChipConfigData,
} from "@/lib/preprocess/chipConfigs";
import { runCropQc } from "@/lib/preprocess/cropQc";
import {
	exportPreprocessZip,
	getPreprocessZipExportReadiness,
} from "@/lib/preprocess/exportBundle";
import {
	invalidateOnAlignmentChange,
	invalidateOnCropQcChange,
	invalidateOnHeFocusChange,
	invalidateOnHeFocusChipBoundsChange,
	invalidateOnHeFocusCommit,
	invalidateOnLocalizationChange,
	invalidateOnSourceAssetsChange,
} from "@/lib/preprocess/invalidation";
import { loadOpenCv } from "@/lib/preprocess/loadOpenCv";
import {
	buildLocalizationHandles,
	buildPermissiveHeFocusHandles,
	clampNormalizedSquareRect,
	computeLocalizationStatus,
	createDefaultChipBounds,
	DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
	normalizeLocalizationImageTransform,
	normalizeLocalizationSlice,
} from "@/lib/preprocess/localization";
import { getOrientedChipBoundsPixelRect } from "@/lib/preprocess/imageTransforms";
import {
	buildInvertedTissueSelectionState,
	buildManualTissueSelectionState,
} from "@/lib/preprocess/projectUpdates";
import {
	buildSourceImage,
	createThumbnailBlob,
} from "@/lib/preprocess/sourceImage";
import {
	projectSpotsForCrop,
	resolveAuthoritativeSpotDiameterFullres,
} from "@/lib/preprocess/spotProjection";
import type { PreprocessPersistMode } from "@/lib/preprocess/storage";
import { selectedSpotIdsFromMatrix } from "@/lib/preprocess/tissueMatrix";
import { runTissueAutoSelection } from "@/lib/preprocess/tissuePipeline";
import { resolveTissueSelectionSupport } from "@/lib/preprocess/tissueSupport";
import { AlignmentPanel } from "./AlignmentPanel";
import { CanvasStage } from "./CanvasStage";
import { CropQcPanel } from "./CropQcPanel";
import { ExportPanel } from "./ExportPanel";
import { StepSidebar } from "./StepSidebar";
import {
	TissueSelectionControls,
	type TissueTool,
} from "./TissueSelectionControls";
import { TissueSelectionPanel } from "./TissueSelectionPanel";

type AutosaveStatus = "saving" | "saved" | "retrying" | "error";

type ProjectPersistOptions = {
	mode?: PreprocessPersistMode;
	strategy?: "immediate" | "debounced";
};

type PreprocessWorkspaceProps = {
	autosaveStatus: AutosaveStatus;
	autosaveDetail: string | null;
	isLoading: boolean;
	loadError: string | null;
	onBackToLanding: () => void;
	onProjectMutate: (
		updater: (current: PreprocessProject) => PreprocessProject,
		persistOptions?: ProjectPersistOptions,
	) => void;
	onProjectNameChange: (value: string) => void;
	onStepChange: (stepId: PreprocessStepId) => void;
	project: PreprocessProject | null;
};

type HeFocusComparisonSource = {
	sourceDataUrl: string;
	chipBounds: PreprocessRect;
	imageTransform: LocalizationImageTransform;
};

type AlignmentPanelWithPaddingBoundaryProps = ComponentProps<
	typeof AlignmentPanel
> & {
	showMovingImagePaddingBoundary: boolean;
};

const autosaveTone: Record<AutosaveStatus, string> = {
	saving: "orange",
	saved: "green",
	retrying: "orange",
	error: "red",
};

const METADATA_DEBOUNCED_PERSIST_OPTIONS = {
	mode: "metadata",
	strategy: "debounced",
} satisfies ProjectPersistOptions;

const hasCropQcPersistentPayload = (cropQc: CropQcSlice) => Boolean(
	cropQc.cropAssets?.eosin?.fullres.dataUrl ||
		cropQc.cropAssets?.he?.fullres.dataUrl ||
		cropQc.checkerboardPreview?.dataUrl ||
		cropQc.featureMatchesPreview?.dataUrl ||
		cropQc.eosinPreviewDataUrl ||
		cropQc.previewDataUrl ||
		cropQc.checkerboardPreviewDataUrl ||
		cropQc.featureMatchesPreviewDataUrl,
);

const hasTissuePersistentPayload = (tissueSelection: PreprocessProject["tissueSelection"]) => (
	tissueSelection.matrix !== null || tissueSelection.autoSelectedSpotIds.length > 0
);

const hasLocalizationDownstreamPersistentPayload = (project: PreprocessProject | null) => Boolean(
	project && (
		project.heFocus.focusedImageDataUrl ||
		hasCropQcPersistentPayload(project.cropQc) ||
		hasTissuePersistentPayload(project.tissueSelection)
	),
);

const AlignmentPanelWithPaddingBoundary =
	AlignmentPanel as ComponentType<AlignmentPanelWithPaddingBoundaryProps>;

const clampLocalizationScale = (value: number) =>
	Math.min(4, Math.max(0.5, value));

const MAX_ACTIVATION_THRESHOLD = 0.3;

const clampActivationThreshold = (value: number, fallback = 0) => {
	if (!Number.isFinite(value)) {
		return fallback;
	}

	const normalized = Math.round(value * 100) / 100;
	return Math.min(MAX_ACTIVATION_THRESHOLD, Math.max(0, normalized));
};

const normalizeLocalizationRotationDegrees = (value: number) => {
	const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
	return Object.is(wrapped, -0) ? 0 : wrapped;
};

const normalizeHeFocusSlice = (
	slice: HeFocusSlice,
	imageAspectRatio = 1,
	options?: { clampChipBounds?: boolean },
): HeFocusSlice => {
	const nextRect = slice.chipBounds
		? options?.clampChipBounds === false
			? slice.chipBounds
			: clampNormalizedSquareRect(slice.chipBounds, imageAspectRatio)
		: null;

	return {
		...slice,
		chipBounds: nextRect,
		handles: nextRect
			? options?.clampChipBounds === false
				? buildPermissiveHeFocusHandles(nextRect)
				: buildLocalizationHandles(nextRect)
			: [],
		imageTransform: normalizeLocalizationImageTransform(slice.imageTransform),
		focusedImageDataUrl: slice.focusedImageDataUrl ?? null,
	};
};

const loadDataUrlImage = (dataUrl: string) =>
	new Promise<HTMLImageElement>((resolve, reject) => {
		const image = new window.Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Focused HE image decoding failed"));
		image.src = dataUrl;
	});

type TissueAutoDetectionImageArgs = {
	eosinLowresCropDataUrl: string;
	cropWidth: number;
	cropHeight: number;
	tissueLowresScaleFactor: number;
};

type TissueAutoDetectionReadiness =
	| {
			ready: false;
			reason: string;
	  }
	| {
			ready: true;
			reason: null;
			tissueImageArgs: TissueAutoDetectionImageArgs;
			matrixRows: number;
			matrixColumns: number;
			projectedSpots: NonNullable<
				PreprocessProject["chipConfig"]["projectedSpots"]
			>;
	  };

const toFocusedHeFileName = (sourceFileName: string | null | undefined) => {
	const baseName = sourceFileName?.replace(/\.[^.]+$/, "") ?? "he";
	return `${baseName}-focused.png`;
};

const createFocusedHeImageRecord = async (
	dataUrl: string,
	metadata?: Partial<PreprocessSourceImage> | null,
): Promise<PreprocessSourceImage> => {
	const image = await loadDataUrlImage(dataUrl);
	const thumbnailBlob = await createThumbnailBlob(dataUrl);
	const thumbnailObjectUrl = URL.createObjectURL(thumbnailBlob);

	return {
		id: metadata?.id ?? `focused-he-${Date.now()}`,
		kind: "he",
		fileName: toFocusedHeFileName(metadata?.fileName),
		mimeType: "image/png",
		sizeBytes: dataUrl.length,
		width: image.naturalWidth,
		height: image.naturalHeight,
		lastModified: metadata?.lastModified ?? Date.now(),
		dataUrl,
		thumbnailBlob,
		thumbnailObjectUrl,
		thumbnailDataUrl: thumbnailObjectUrl,
	};
};

export const generateFocusedHeDataUrl = async (args: {
	sourceDataUrl: string;
	chipBounds: PreprocessRect;
	imageTransform: LocalizationImageTransform;
}) => {
	const sourceImage = await loadDataUrlImage(args.sourceDataUrl);
	const sourceWidth = sourceImage.naturalWidth;
	const sourceHeight = sourceImage.naturalHeight;
	const radians = (args.imageTransform.rotationDegrees * Math.PI) / 180;
	const orientedWidth = Math.max(
		1,
		Math.round(
			sourceWidth * Math.abs(Math.cos(radians)) +
				sourceHeight * Math.abs(Math.sin(radians)),
		),
	);
	const orientedHeight = Math.max(
		1,
		Math.round(
			sourceWidth * Math.abs(Math.sin(radians)) +
				sourceHeight * Math.abs(Math.cos(radians)),
		),
	);
	const orientedChipBounds = getOrientedChipBoundsPixelRect(
		args.chipBounds,
		args.imageTransform,
		{ width: sourceWidth, height: sourceHeight },
		{ width: orientedWidth, height: orientedHeight },
	);
	const requestedX = orientedChipBounds.x;
	const requestedY = orientedChipBounds.y;
	const requestedWidth = orientedChipBounds.width;
	const requestedHeight = orientedChipBounds.height;
	const orientedCanvas = document.createElement("canvas");
	orientedCanvas.width = orientedWidth;
	orientedCanvas.height = orientedHeight;
	const orientedContext = orientedCanvas.getContext("2d");
	if (!orientedContext) {
		throw new Error("Focused HE oriented frame context unavailable");
	}
	orientedContext.imageSmoothingEnabled = true;
	orientedContext.imageSmoothingQuality = "high";
	orientedContext.fillStyle = "#ffffff";
	orientedContext.fillRect(0, 0, orientedWidth, orientedHeight);
	orientedContext.translate(orientedWidth / 2, orientedHeight / 2);
	orientedContext.scale(
		args.imageTransform.flipHorizontal ? -1 : 1,
		args.imageTransform.flipVertical ? -1 : 1,
	);
	orientedContext.rotate((args.imageTransform.rotationDegrees * Math.PI) / 180);
	orientedContext.drawImage(
		sourceImage,
		-sourceWidth / 2,
		-sourceHeight / 2,
		sourceWidth,
		sourceHeight,
	);

	const intersectionX = Math.max(0, requestedX);
	const intersectionY = Math.max(0, requestedY);
	const intersectionEndX = Math.min(
		orientedWidth,
		requestedX + requestedWidth,
	);
	const intersectionEndY = Math.min(
		orientedHeight,
		requestedY + requestedHeight,
	);
	const intersectionWidth = Math.max(0, intersectionEndX - intersectionX);
	const intersectionHeight = Math.max(0, intersectionEndY - intersectionY);
	const cropCanvas = document.createElement("canvas");
	cropCanvas.width = requestedWidth;
	cropCanvas.height = requestedHeight;
	const cropContext = cropCanvas.getContext("2d");
	if (!cropContext) {
		throw new Error("Focused HE crop context unavailable");
	}
	cropContext.imageSmoothingEnabled = true;
	cropContext.imageSmoothingQuality = "high";
	cropContext.fillStyle = "#ffffff";
	cropContext.fillRect(0, 0, requestedWidth, requestedHeight);
	if (intersectionWidth > 0 && intersectionHeight > 0) {
		cropContext.drawImage(
			orientedCanvas,
			intersectionX,
			intersectionY,
			intersectionWidth,
			intersectionHeight,
			intersectionX - requestedX,
			intersectionY - requestedY,
			intersectionWidth,
			intersectionHeight,
		);
	}

	return cropCanvas.toDataURL("image/png");
};

export const getHeFocusComparisonSource = (
	project: PreprocessProject | null,
): HeFocusComparisonSource | null => {
	if (!project?.localization.chipBounds) {
		return null;
	}

	const localizationImage =
		project.sourceAssets.images[project.localization.targetImage] ?? null;
	if (!localizationImage?.dataUrl) {
		return null;
	}

	return {
		sourceDataUrl: localizationImage.dataUrl,
		chipBounds: project.localization.chipBounds,
		imageTransform: project.localization.imageTransform,
	};
};

const placeholderCopyByStep: Record<
	PreprocessStepId,
	{ title: string; body: string }
> = {
	sourceAssets: {
		title: "Source image intake",
		body: "Upload the NATA Align image and the corresponding H&E stained tissue image. Supported image formats: PNG, JPG, and JPEG. All image processing performed on this page is saved locally.",
	},
	localization: {
		title: "Chip localization",
		body: "Orient the eosin reference image and place the capture-area box over the chip region. Saved coordinates remain normalized in source-image space.",
	},
	heFocus: {
		title: "HE focus",
		body: "Define the HE region used for registration. Match the chip-localized tissue area from the eosin reference while preserving the original HE coordinate system.",
	},
	alignment: {
		title: "Image registration",
		body: "Create paired eosin and HE landmarks, verify coverage, and solve the affine registration with OpenCV quality gates.",
	},
	cropQc: {
		title: "Crop QC",
		body: "Generate the registered crop, inspect checkerboard and landmark-match QC, then accept the crop before spot projection and tissue selection.",
	},
	chipConfig: {
		title: "Chip projection",
		body: "Choose the capture pitch and project the chip spot grid onto the accepted eosin crop.",
	},
	tissueSelection: {
		title: "Tissue spot selection",
		body: "Auto-select tissue-covered capture spots from the eosin crop, then manually refine the spot matrix.",
	},
	exportState: {
		title: "Export package",
		body: "Download the registered crop outputs, tissue spot matrix, and optional recovery file for downstream analysis.",
	},
};

const resolveTissueAutoDetectionImageArgs = (
	project: PreprocessProject | null,
): TissueAutoDetectionImageArgs | null => {
	const eosinLowresCropDataUrl =
		project?.cropQc.cropAssets?.eosin?.lowres.dataUrl ?? null;
	const cropWidth = project?.cropQc.cropWidth ?? null;
	const cropHeight = project?.cropQc.cropHeight ?? null;
	const tissueLowresScaleFactor = project?.cropQc.tissue_lowres_scalef;

	if (
		!eosinLowresCropDataUrl ||
		typeof cropWidth !== "number" ||
		typeof cropHeight !== "number" ||
		typeof tissueLowresScaleFactor !== "number"
	) {
		return null;
	}

	return {
		eosinLowresCropDataUrl,
		cropWidth,
		cropHeight,
		tissueLowresScaleFactor,
	};
};

const resolveTissueAutoDetectionReadiness = (
	project: PreprocessProject | null,
): TissueAutoDetectionReadiness => {
	if (!project) {
		return {
			ready: false,
			reason: "Project unavailable.",
		};
	}

	if (project.cropQc.status !== "complete" || project.cropQc.isStale) {
		return {
			ready: false,
			reason:
				"Crop QC output is stale or incomplete. Regenerate and accept crop QC before tissue auto-selection.",
		};
	}

	const tissueImageArgs = resolveTissueAutoDetectionImageArgs(project);
	if (!tissueImageArgs) {
		return {
			ready: false,
			reason:
				"Crop QC assets are missing. Regenerate crop QC before tissue auto-selection.",
		};
	}

	if (project.chipConfig.status !== "complete" || project.chipConfig.isStale) {
		return {
			ready: false,
			reason:
				"Spot projection is stale or incomplete. Reapply the capture pitch before tissue auto-selection.",
		};
	}

	const projectedSpots = project.chipConfig.projectedSpots;
	if (
		!projectedSpots ||
		projectedSpots.length === 0 ||
		typeof project.chipConfig.rows !== "number" ||
		project.chipConfig.rows <= 0 ||
		typeof project.chipConfig.columns !== "number" ||
		project.chipConfig.columns <= 0
	) {
		return {
			ready: false,
			reason:
				"Projected capture spots are missing. Reapply the capture pitch before tissue auto-selection.",
		};
	}

	return {
		ready: true,
		reason: null,
		tissueImageArgs,
		matrixRows: project.chipConfig.rows,
		matrixColumns: project.chipConfig.columns,
		projectedSpots,
	};
};

const buildProjectedSpotSignature = (
	projectedSpots: NonNullable<
		PreprocessProject["chipConfig"]["projectedSpots"]
	>,
) =>
	projectedSpots
		.map(
			(spot) => `${spot.id}:${spot.x}:${spot.y}:${spot.width}:${spot.height}`,
		)
		.join("|");

const buildTissueDetectionSnapshot = (args: {
	project: PreprocessProject;
	tissueImageArgs: TissueAutoDetectionImageArgs;
	projectedSpots: NonNullable<
		PreprocessProject["chipConfig"]["projectedSpots"]
	>;
}) => ({
	chipType: args.project.chipConfig.chipType,
	rows: args.project.chipConfig.rows,
	columns: args.project.chipConfig.columns,
	eosinLowresCropDataUrl: args.tissueImageArgs.eosinLowresCropDataUrl,
	cropWidth: args.tissueImageArgs.cropWidth,
	cropHeight: args.tissueImageArgs.cropHeight,
	tissueLowresScaleFactor: args.tissueImageArgs.tissueLowresScaleFactor,
	activationThreshold: clampActivationThreshold(
		args.project.tissueSelection.activationThreshold,
	),
	blockThreshold: args.project.tissueSelection.blockThreshold,
	thresholdMode: args.project.tissueSelection.thresholdMode,
	projectedSpotSignature: buildProjectedSpotSignature(args.projectedSpots),
});

const matchesTissueDetectionSnapshot = (
	project: PreprocessProject,
	snapshot: ReturnType<typeof buildTissueDetectionSnapshot>,
) => {
	const readiness = resolveTissueAutoDetectionReadiness(project);
	if (!readiness.ready) {
		return false;
	}

	return (
		project.chipConfig.chipType === snapshot.chipType &&
		project.chipConfig.rows === snapshot.rows &&
		project.chipConfig.columns === snapshot.columns &&
		readiness.tissueImageArgs.eosinLowresCropDataUrl ===
			snapshot.eosinLowresCropDataUrl &&
		readiness.tissueImageArgs.cropWidth === snapshot.cropWidth &&
		readiness.tissueImageArgs.cropHeight === snapshot.cropHeight &&
		readiness.tissueImageArgs.tissueLowresScaleFactor ===
			snapshot.tissueLowresScaleFactor &&
		clampActivationThreshold(project.tissueSelection.activationThreshold) ===
			snapshot.activationThreshold &&
		project.tissueSelection.blockThreshold === snapshot.blockThreshold &&
		project.tissueSelection.thresholdMode === snapshot.thresholdMode &&
		buildProjectedSpotSignature(readiness.projectedSpots) ===
			snapshot.projectedSpotSignature
	);
};

const deriveChipProjectionForCrop = (args: {
	config: ChipConfigData;
	cropWidth: number;
	cropHeight: number;
}) => {
	const { config, cropWidth, cropHeight } = args;
	const projectedSpots = projectSpotsForCrop({
		chip: config.manifest,
		templateEntries: config.templateEntries,
		cropWidth,
		cropHeight,
	});
	const spotDiameterFullres = resolveAuthoritativeSpotDiameterFullres({
		projectedSpots,
		cropWidth,
		cropHeight,
	});
	if (spotDiameterFullres === null) {
		throw new Error("Projected spot diameter metadata is unavailable.");
	}

	return {
		projectedSpots,
		spotDiameterFullres,
		tissueSupport: resolveTissueSelectionSupport({
			chipType: config.manifest.id,
			rows: config.manifest.gridRows,
			columns: config.manifest.gridCols,
		}),
	};
};

function SourceAssetUploader({
	label,
	description,
	buttonLabel,
	emptyText,
	image,
	onUpload,
}: {
	label: string;
	description: string;
	buttonLabel: string;
	emptyText: string;
	image: PreprocessProject["sourceAssets"]["images"]["eosin"] | null;
	onUpload: (fileList: FileList | null) => void;
}) {
	return (
		<Box
			border="1px solid"
			borderColor="gray.200"
			borderRadius="xl"
			bg="white"
			px={4}
			py={4}
			h="full"
		>
			<Stack spacing={3}>
				<Flex justify="space-between" align="flex-start" gap={3} wrap="wrap">
					<Stack spacing={1}>
						<Heading size="sm">{label}</Heading>
						<Text fontSize="sm" color="gray.500">
							{description}
						</Text>
					</Stack>
					<Badge
						colorScheme={image ? "green" : "orange"}
						alignSelf="flex-start"
						borderRadius="full"
					>
						{image ? "Ready" : "Missing"}
					</Badge>
				</Flex>
				<Text fontSize="sm" color="gray.600">
					{image
						? `${image.fileName} • ${image.width ?? "?"}×${image.height ?? "?"} px`
						: emptyText}
				</Text>
				<Box>
					<Button
						colorScheme="brand"
						variant={image ? "outline" : "solid"}
						size="sm"
						onClick={(event) => {
							const input = event.currentTarget.nextElementSibling;
							if (input instanceof HTMLInputElement) {
								input.click();
							}
						}}
					>
						{buttonLabel}
					</Button>
					<Input
						type="file"
						accept="image/*,.tif,.tiff"
						display="none"
						onChange={(event) => {
							onUpload(event.target.files);
							event.target.value = "";
						}}
					/>
				</Box>
			</Stack>
		</Box>
	);
}

export function PreprocessWorkspace({
	autosaveStatus,
	autosaveDetail,
	isLoading,
	loadError,
	onBackToLanding,
	onProjectMutate,
	onProjectNameChange,
	onStepChange,
	project,
}: PreprocessWorkspaceProps) {
	const toast = useToast();
	const [chipManifests, setChipManifests] = useState<ChipConfigManifest[]>([]);
	const [chipConfigError, setChipConfigError] = useState<string | null>(null);
	const [includeProjectJson, setIncludeProjectJson] = useState(false);
	const includeAlignedImage = true;
	const [isExporting, setIsExporting] = useState(false);
	const [isEditingProjectName, setIsEditingProjectName] = useState(false);
	const [projectNameDraft, setProjectNameDraft] = useState("");
	const [heFocusComparisonImageDataUrl, setHeFocusComparisonImageDataUrl] =
		useState<string | null>(null);
	const [focusedHeMovingImage, setFocusedHeMovingImage] =
		useState<PreprocessSourceImage | null>(null);
	const [localizationDraftChipBounds, setLocalizationDraftChipBounds] =
		useState<PreprocessRect | null>(null);
	const [heFocusDraftChipBounds, setHeFocusDraftChipBounds] =
		useState<PreprocessRect | null>(null);
	const [tissueTool, setTissueTool] = useState<TissueTool>("activate");
	const [isDetectingTissue, setIsDetectingTissue] = useState(false);
	const tissueDetectionRequestTokenRef = useRef(0);
	const chipConfigRequestTokenRef = useRef(0);

	useEffect(
		() => () => {
			if (focusedHeMovingImage?.thumbnailObjectUrl) {
				URL.revokeObjectURL(focusedHeMovingImage.thumbnailObjectUrl);
			}
		},
		[focusedHeMovingImage],
	);

	const localizationImage = project
		? (project.sourceAssets.images[project.localization.targetImage] ?? null)
		: null;
	const currentHeImageSource = project
		? (project.sourceAssets.images[project.heFocus.targetImage] ?? null)
		: null;
	const alignmentReferenceImage = project
		? (project.sourceAssets.images[project.alignment.referenceImage] ?? null)
		: null;
	const alignmentMovingImage = project
		? project.alignment.movingImage === "he" &&
			project.heFocus.status === "complete"
			? focusedHeMovingImage
			: (project.sourceAssets.images[project.alignment.movingImage] ?? null)
		: null;
	const localizationImageDataUrl =
		localizationImage?.workingDataUrl ?? localizationImage?.dataUrl ?? null;
	const localizationChipBounds = project?.localization.chipBounds ?? null;
	const localizationStageChipBounds =
		localizationDraftChipBounds ?? localizationChipBounds;
	const localizationImageTransform =
		project?.localization.imageTransform ?? null;
	const currentHeImageDataUrl =
		currentHeImageSource?.workingDataUrl ??
		currentHeImageSource?.dataUrl ??
		null;
	const focusedHeImageDataUrl = project?.heFocus.focusedImageDataUrl ?? null;
	const localizationMetadataPersistOptions = hasLocalizationDownstreamPersistentPayload(project)
		? undefined
		: METADATA_DEBOUNCED_PERSIST_OPTIONS;
	const heFocusMetadataPersistOptions = focusedHeImageDataUrl
		? undefined
		: METADATA_DEBOUNCED_PERSIST_OPTIONS;
	const heFocusStageChipBounds =
		heFocusDraftChipBounds ?? project?.heFocus.chipBounds ?? null;
	const heFocusComparisonSource = useMemo(() => {
		if (
			!localizationImageDataUrl ||
			!localizationChipBounds ||
			!localizationImageTransform
		) {
			return null;
		}

		return {
			sourceDataUrl: localizationImageDataUrl,
			chipBounds: localizationChipBounds,
			imageTransform: localizationImageTransform,
		};
	}, [
		localizationChipBounds,
		localizationImageDataUrl,
		localizationImageTransform,
	]);
	const heFocusChipBounds = project?.heFocus.chipBounds ?? null;
	const heFocusImageTransform = project?.heFocus.imageTransform ?? null;
	const heFocusStatus = project?.heFocus.status ?? null;
	const alignmentMovingImageKind = project?.alignment.movingImage ?? null;
	const showMovingImagePaddingBoundary =
		alignmentMovingImageKind === "he" &&
		heFocusStatus === "complete" &&
		heFocusChipBounds !== null &&
		(heFocusChipBounds.x < 0 ||
			heFocusChipBounds.y < 0 ||
			heFocusChipBounds.x + heFocusChipBounds.width > 1 ||
			heFocusChipBounds.y + heFocusChipBounds.height > 1);
	const currentStepId = project?.currentStep ?? null;
	const hasLocalizationChipBounds = Boolean(project?.localization.chipBounds);
	const hasHeFocusChipBounds = Boolean(project?.heFocus.chipBounds);
	const tissueAutoDetectionReadiness =
		resolveTissueAutoDetectionReadiness(project);
	const exportReadiness = project
		? getPreprocessZipExportReadiness(project, { includeAlignedImage })
		: { canExport: false as const, reason: "Project unavailable." };
	const chipProjectionCropStatus = project?.cropQc.status ?? null;
	const chipProjectionQcAccepted = project?.cropQc.qcAccepted ?? false;
	const chipProjectionChipId = project?.chipConfig.chipType ?? null;
	const chipProjectionProjectedSpots =
		project?.chipConfig.projectedSpots ?? null;
	const chipProjectionCropWidth = project?.cropQc.cropWidth ?? null;
	const chipProjectionCropHeight = project?.cropQc.cropHeight ?? null;
	const hasAcceptedCropAssets = Boolean(
		project?.cropQc.cropAssets?.eosin?.fullres.dataUrl &&
			project?.cropQc.cropAssets?.he?.fullres.dataUrl,
	);

	useEffect(() => {
		if (
			project?.currentStep !== "localization" ||
			!project?.localization.chipBounds
		) {
			setLocalizationDraftChipBounds(null);
			return;
		}

		setLocalizationDraftChipBounds(null);
	}, [project?.currentStep, project?.localization.chipBounds]);

	useEffect(() => {
		if (project?.currentStep !== "heFocus" || !project?.heFocus.chipBounds) {
			setHeFocusDraftChipBounds(null);
			return;
		}

		setHeFocusDraftChipBounds(null);
	}, [project?.currentStep, project?.heFocus.chipBounds]);

	const applyLocalizationUpdate = useCallback(
		(
			updater: (current: LocalizationSlice) => LocalizationSlice,
			options?: {
				invalidateDownstream?: boolean;
				persistOptions?: ProjectPersistOptions;
			},
		) => {
			onProjectMutate((current) => {
				const nextLocalizationBase = normalizeLocalizationSlice(
					updater(current.localization),
				);
				const nextHasImage = Boolean(
					current.sourceAssets.images[nextLocalizationBase.targetImage]
						?.dataUrl,
				);
				const nextLocalization: LocalizationSlice = {
					...nextLocalizationBase,
					method:
						nextLocalizationBase.method ??
						(nextLocalizationBase.chipBounds ? "manual" : null),
					status: computeLocalizationStatus(
						nextHasImage,
						nextLocalizationBase.chipBounds,
					),
					isStale: false,
					error: null,
					updatedAt: new Date().toISOString(),
				};

				const nextProject = {
					...current,
					localization: nextLocalization,
				};

				return options?.invalidateDownstream === false
					? nextProject
					: invalidateOnLocalizationChange(nextProject);
			}, options?.persistOptions);
		},
		[onProjectMutate],
	);

	const applyHeFocusUpdate = useCallback(
		(
			updater: (current: HeFocusSlice) => HeFocusSlice,
			options?: {
				invalidateDownstream?: boolean;
				invalidationScope?: "change" | "commit";
				persistOptions?: ProjectPersistOptions;
				preserveFocusedImage?: boolean;
			},
		) => {
			onProjectMutate((current) => {
				const currentImage =
					current.sourceAssets.images[current.heFocus.targetImage];
				const imageAspectRatio =
					currentImage?.width && currentImage.height
						? currentImage.width / currentImage.height
						: 1;
				const nextHeFocusBase = normalizeHeFocusSlice(
					updater(current.heFocus),
					imageAspectRatio,
					{ clampChipBounds: false },
				);
				const nextHasImage = Boolean(currentImage?.dataUrl);
				const nextHeFocus: HeFocusSlice = {
					...nextHeFocusBase,
					focusedImageDataUrl: options?.preserveFocusedImage
						? (nextHeFocusBase.focusedImageDataUrl ??
							current.heFocus.focusedImageDataUrl ??
							null)
						: null,
					status: computeLocalizationStatus(
						nextHasImage,
						nextHeFocusBase.chipBounds,
					),
					isStale: false,
					error: null,
					updatedAt: new Date().toISOString(),
				};

				const nextProject = {
					...current,
					heFocus: nextHeFocus,
				};

				return options?.invalidateDownstream === false
					? nextProject
					: options?.invalidationScope === "commit"
						? invalidateOnHeFocusCommit(nextProject)
						: invalidateOnHeFocusChange(nextProject);
			}, options?.persistOptions);
		},
		[onProjectMutate],
	);

	const applyAlignmentUpdate = useCallback(
		(
			updater: (current: AlignmentSlice) => AlignmentSlice,
			options?: { invalidateDownstream?: boolean },
		) => {
			onProjectMutate((current) => {
				const nextAlignmentBase = normalizeAlignmentSlice(
					updater(current.alignment),
				);
				const nextAlignment: AlignmentSlice = {
					...nextAlignmentBase,
					isStale: false,
					updatedAt: new Date().toISOString(),
					error: nextAlignmentBase.error ?? null,
				};

				const nextProject = {
					...current,
					alignment: nextAlignment,
				};

				return options?.invalidateDownstream === false
					? nextProject
					: invalidateOnAlignmentChange(nextProject);
			});
		},
		[onProjectMutate],
	);

	const applyCropQcUpdate = useCallback(
		(
			updater: (current: CropQcSlice) => CropQcSlice,
			options?: { invalidateDownstream?: boolean },
		) => {
			onProjectMutate((current) => {
				const nextCropQc: CropQcSlice = {
					...updater(current.cropQc),
					isStale: false,
					updatedAt: new Date().toISOString(),
				};

				const nextProject = {
					...current,
					cropQc: nextCropQc,
				};

				return options?.invalidateDownstream
					? invalidateOnCropQcChange(nextProject)
					: nextProject;
			});
		},
		[onProjectMutate],
	);

	const handleUploadEosin = useCallback(
		async (fileList: FileList | null) => {
			const file = fileList?.[0];
			if (!file) return;

			try {
				const eosin = await buildSourceImage(file, "eosin");
				const localizationAspectRatio =
					eosin.width && eosin.height ? eosin.width / eosin.height : 1;

				onProjectMutate((current) => {
					const timestamp = new Date().toISOString();
					const nextLocalizationBase = normalizeLocalizationSlice({
						...current.localization,
						targetImage: "eosin",
						method: "manual",
						chipBounds: createDefaultChipBounds(localizationAspectRatio),
						imageTransform: DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
					});
					const nextLocalization: LocalizationSlice = {
						...nextLocalizationBase,
						status: computeLocalizationStatus(
							true,
							nextLocalizationBase.chipBounds,
						),
						isStale: false,
						error: null,
						updatedAt: timestamp,
					};

					const nextSourceAssets = {
						...current.sourceAssets,
						activeImage: "eosin" as const,
						images: {
							...current.sourceAssets.images,
							eosin,
						},
						oversizedImageWarning: null,
						status: "ready" as const,
						isStale: false,
						error: null,
						updatedAt: timestamp,
					};

					const invalidatedProject = invalidateOnSourceAssetsChange({
						...current,
						sourceAssets: nextSourceAssets,
						localization: nextLocalization,
					});

					return {
						...invalidatedProject,
						localization: nextLocalization,
					};
				});

				toast({
					title: "Eosin reference image loaded",
					description:
						"The image is ready for chip localization. Downstream preprocessing outputs were marked stale.",
					status: "success",
				});
			} catch (error) {
				console.error(error);
				toast({
					title: "Unable to load eosin image",
					description:
						error instanceof Error
							? error.message
							: "Choose a browser-supported image file.",
					status: "error",
				});
			}
		},
		[onProjectMutate, toast],
	);

	const handleUploadHe = useCallback(
		async (fileList: FileList | null) => {
			const file = fileList?.[0];
			if (!file) return;

			try {
				const he = await buildSourceImage(file, "he");

				onProjectMutate((current) => {
					const timestamp = new Date().toISOString();

					const invalidatedProject = invalidateOnSourceAssetsChange({
						...current,
						sourceAssets: {
							...current.sourceAssets,
							images: {
								...current.sourceAssets.images,
								he,
							},
							status: "ready",
							isStale: false,
							error: null,
							updatedAt: timestamp,
						},
					});

					return invalidatedProject;
				});

				toast({
					title: "HE image loaded",
					description:
						"Landmark registration can now use this image. Downstream preprocessing outputs were marked stale.",
					status: "success",
				});
			} catch (error) {
				console.error(error);
				toast({
					title: "Unable to load HE image",
					description:
						error instanceof Error
							? error.message
							: "Choose a browser-supported image file.",
					status: "error",
				});
			}
		},
		[onProjectMutate, toast],
	);

	useEffect(() => {
		if (currentStepId !== "alignment") return;
		if (heFocusDraftChipBounds) return;
		if (heFocusStatus !== "complete") return;
		if (focusedHeImageDataUrl) return;

		if (
			!heFocusChipBounds ||
			!currentHeImageSource?.dataUrl ||
			!heFocusImageTransform
		) {
			return;
		}

		const sourceDataUrl = currentHeImageSource.dataUrl;
		let cancelled = false;

		void (async () => {
			try {
				const focusedImageDataUrl = await generateFocusedHeDataUrl({
					sourceDataUrl,
					chipBounds: heFocusChipBounds,
					imageTransform: heFocusImageTransform,
				});
				if (cancelled) return;

				onProjectMutate((current) => {
					if (
						current.heFocus.status !== "complete" ||
						current.heFocus.focusedImageDataUrl ||
						!current.heFocus.chipBounds ||
						!current.sourceAssets.images[current.heFocus.targetImage]?.dataUrl
					) {
						return current;
					}

					return {
						...current,
						heFocus: {
							...current.heFocus,
							focusedImageDataUrl,
							updatedAt: new Date().toISOString(),
						},
					};
				});
			} catch (error) {
				if (!cancelled) {
					console.error("Failed to regenerate focused HE preview", error);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [
		currentHeImageSource?.dataUrl,
		currentStepId,
		heFocusChipBounds,
		heFocusDraftChipBounds,
		heFocusImageTransform,
		heFocusStatus,
		focusedHeImageDataUrl,
		onProjectMutate,
	]);

	useEffect(() => {
		if (currentStepId !== "heFocus") {
			setHeFocusComparisonImageDataUrl(null);
			return;
		}

		if (!heFocusComparisonSource) {
			setHeFocusComparisonImageDataUrl(null);
			return;
		}

		let cancelled = false;

		void (async () => {
			try {
				const comparisonImageDataUrl = await generateFocusedHeDataUrl(
					heFocusComparisonSource,
				);
				if (!cancelled) {
					setHeFocusComparisonImageDataUrl(comparisonImageDataUrl);
				}
			} catch (error) {
				if (!cancelled) {
					console.error(
						"Failed to regenerate HE focus comparison preview",
						error,
					);
					setHeFocusComparisonImageDataUrl(null);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [currentStepId, heFocusComparisonSource]);

	useEffect(() => {
		if (alignmentMovingImageKind !== "he") {
			setFocusedHeMovingImage(null);
			return;
		}

		if (!focusedHeImageDataUrl) {
			setFocusedHeMovingImage(null);
			return;
		}

		let cancelled = false;

		void (async () => {
			try {
				const focusedImage = await createFocusedHeImageRecord(
					focusedHeImageDataUrl,
					currentHeImageSource
						? {
								...currentHeImageSource,
								id: `${currentHeImageSource.id}-focused`,
							}
						: null,
				);
				if (cancelled) {
					if (focusedImage.thumbnailObjectUrl) {
						URL.revokeObjectURL(focusedImage.thumbnailObjectUrl);
					}
					return;
				}

				setFocusedHeMovingImage(focusedImage);
			} catch (error) {
				if (!cancelled) {
					console.error("Failed to hydrate focused HE moving image", error);
					setFocusedHeMovingImage(null);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [
		alignmentMovingImageKind,
		currentHeImageSource,
		focusedHeImageDataUrl,
	]);

	useEffect(() => {
		if (!project) return;
		if (currentStepId !== "localization") return;
		if (!localizationImageDataUrl || hasLocalizationChipBounds) return;

		onProjectMutate((current) => {
			const currentImage =
				current.sourceAssets.images[current.localization.targetImage];
			if (
				current.currentStep !== "localization" ||
				!currentImage?.dataUrl ||
				current.localization.chipBounds
			) {
				return current;
			}

			const localizationAspectRatio =
				currentImage.width && currentImage.height
					? currentImage.width / currentImage.height
					: 1;

			const nextLocalizationBase = normalizeLocalizationSlice({
				...current.localization,
				chipBounds: createDefaultChipBounds(localizationAspectRatio),
				method: "manual",
			});
			const nextLocalization: LocalizationSlice = {
				...nextLocalizationBase,
				status: computeLocalizationStatus(
					true,
					nextLocalizationBase.chipBounds,
				),
				isStale: false,
				error: null,
				updatedAt: new Date().toISOString(),
			};

			return invalidateOnLocalizationChange({
				...current,
				localization: nextLocalization,
			});
		});
	}, [
		currentStepId,
		hasLocalizationChipBounds,
		localizationImageDataUrl,
		onProjectMutate,
		project,
	]);

	useEffect(() => {
		if (!project) return;
		if (currentStepId !== "heFocus") return;
		if (!currentHeImageDataUrl || hasHeFocusChipBounds) return;

		onProjectMutate((current) => {
			const currentImage =
				current.sourceAssets.images[current.heFocus.targetImage];
			if (
				current.currentStep !== "heFocus" ||
				!currentImage?.dataUrl ||
				current.heFocus.chipBounds
			) {
				return current;
			}

			const heAspectRatio =
				currentImage.width && currentImage.height
					? currentImage.width / currentImage.height
					: 1;
			const nextHeFocusBase = normalizeHeFocusSlice(
				{
					...current.heFocus,
					chipBounds: createDefaultChipBounds(heAspectRatio),
					focusedImageDataUrl: null,
				},
				heAspectRatio,
			);
			const nextHeFocus: HeFocusSlice = {
				...nextHeFocusBase,
				focusedImageDataUrl: null,
				status: computeLocalizationStatus(true, nextHeFocusBase.chipBounds),
				isStale: false,
				error: null,
				updatedAt: new Date().toISOString(),
			};

			return invalidateOnHeFocusChipBoundsChange({
				...current,
				heFocus: nextHeFocus,
			});
		});
	}, [
		currentHeImageDataUrl,
		currentStepId,
		hasHeFocusChipBounds,
		onProjectMutate,
		project,
	]);

	const runCropQcStep = useCallback(async () => {
		if (!project) return;
		const acceptedHeChipBounds = project.heFocus.chipBounds ?? undefined;
		if (
			!alignmentReferenceImage?.dataUrl ||
			!alignmentMovingImage?.dataUrl ||
			!project.localization.chipBounds ||
			!project.alignment.affineMatrix
		) {
			toast({
				title: "Crop prerequisites missing",
				description:
					"Image registration and chip localization must be complete before crop QC.",
				status: "warning",
			});
			return;
		}

		applyCropQcUpdate(
			(current) => ({
				...current,
				status: "processing",
				error: null,
			}),
			{ invalidateDownstream: false },
		);

		try {
			const { cv } = await loadOpenCv();

			const result = await runCropQc({
				cv,
				eosinDataUrl: alignmentReferenceImage.dataUrl,
				heDataUrl: alignmentMovingImage.dataUrl,
				chipBounds: project.localization.chipBounds,
				acceptedChipBounds: acceptedHeChipBounds,
				imageTransform: project.localization.imageTransform,
				affineMatrix: project.alignment.affineMatrix,
				controlPoints: project.alignment.controlPoints,
				solveAccepted: project.alignment.solveAccepted,
				inlierMask: project.alignment.inlierMask,
			});

			applyCropQcUpdate(
				(current) => ({
					...current,
					eosinReferenceGeometry: result.eosinReferenceGeometry,
					heQcGeometry: result.heQcGeometry,
					cropRect: result.eosinReferenceGeometry.rect,
					cropWidth: result.cropWidth,
					cropHeight: result.cropHeight,
					cropAssets: result.cropAssets,
					tissue_hires_scalef: result.tissue_hires_scalef,
					tissue_lowres_scalef: result.tissue_lowres_scalef,
					spot_diameter_fullres: result.spot_diameter_fullres,
					fiducial_diameter_fullres: result.fiducial_diameter_fullres,
					checkerboardTileSize: 64,
					checkerboardPreview: result.checkerboardPreview,
					featureMatchesPreview: result.featureMatchesPreview,
					featureMatchesPreviewDataUrl: result.featureMatchesDataUrl,
					qcAccepted: false,
					status: "ready",
					issues: [],
					eosinPreviewDataUrl: result.cropAssets.eosin.fullres.dataUrl,
					previewDataUrl:
						result.cropAssets.he.hires.dataUrl ??
						result.cropAssets.he.fullres.dataUrl,
					checkerboardPreviewDataUrl: result.checkerboardPreview.dataUrl,
					error: null,
				}),
				{ invalidateDownstream: false },
			);
		} catch (error) {
			applyCropQcUpdate(
				(current) => ({
					...current,
					status: "error",
					error: error instanceof Error ? error.message : "Crop QC failed",
				}),
				{ invalidateDownstream: false },
			);
			toast({
				title: "Crop QC failed",
				description:
					error instanceof Error
						? error.message
						: "Unable to generate registered crop previews.",
				status: "error",
			});
		}
	}, [
		alignmentMovingImage,
		alignmentReferenceImage,
		applyCropQcUpdate,
		project,
		toast,
	]);

	useEffect(() => {
		if (!project) return;
		if (
			project.currentStep !== "chipConfig" &&
			project.currentStep !== "tissueSelection"
		)
			return;
		if (chipManifests.length > 0) return;
		if (project.chipConfig.status === "error" || project.chipConfig.error)
			return;

		let cancelled = false;
		loadAllChipConfigManifests()
			.then((entries) => {
				if (!cancelled) setChipManifests(entries);
			})
			.catch((error) => {
				if (!cancelled) {
					const message =
						error instanceof Error
							? error.message
							: "Failed to load chip manifests";
					setChipConfigError(message);
					onProjectMutate((current) => ({
						...current,
						chipConfig: {
							...current.chipConfig,
							status: "error",
							error: message,
							isStale: false,
							updatedAt: new Date().toISOString(),
						},
					}));
				}
			});

		return () => {
			cancelled = true;
		};
	}, [chipManifests.length, onProjectMutate, project]);

	useEffect(() => {
		if (chipProjectionCropStatus !== "complete" || !chipProjectionQcAccepted) {
			return;
		}
		if (chipProjectionProjectedSpots !== null) {
			return;
		}

		const chipId = chipProjectionChipId;
		const cropWidth = chipProjectionCropWidth;
		const cropHeight = chipProjectionCropHeight;
		if (
			(chipId !== "15um" && chipId !== "50um") ||
			typeof cropWidth !== "number" ||
			cropWidth <= 0 ||
			typeof cropHeight !== "number" ||
			cropHeight <= 0 ||
			!hasAcceptedCropAssets
		) {
			return;
		}

		const chipRequestToken = ++chipConfigRequestTokenRef.current;

		void (async () => {
			try {
				setChipConfigError(null);
				const config = await loadChipConfigData(chipId);
				if (chipConfigRequestTokenRef.current !== chipRequestToken) {
					return;
				}

				const {
					projectedSpots,
					spotDiameterFullres,
					tissueSupport: nextSupport,
				} = deriveChipProjectionForCrop({
					config,
					cropWidth,
					cropHeight,
				});
				const timestamp = new Date().toISOString();

				onProjectMutate(
					(current) => {
						const currentCropGeometry = current.cropQc.eosinReferenceGeometry;
						if (
							chipConfigRequestTokenRef.current !== chipRequestToken ||
							current.cropQc.status !== "complete" ||
							!current.cropQc.qcAccepted ||
							current.chipConfig.projectedSpots !== null ||
							current.chipConfig.chipType !== chipId ||
							!currentCropGeometry ||
							current.cropQc.cropWidth !== cropWidth ||
							current.cropQc.cropHeight !== cropHeight
						) {
							return current;
						}

						const nextTissueSelection =
							current.tissueSelection.supportState ===
								nextSupport.supportState &&
							current.tissueSelection.unsupportedReason ===
								nextSupport.unsupportedReason
								? current.tissueSelection
								: {
										...current.tissueSelection,
										supportState: nextSupport.supportState,
										unsupportedReason: nextSupport.unsupportedReason,
										updatedAt: timestamp,
									};

						return {
							...current,
							cropQc: {
								...current.cropQc,
								cropRect: currentCropGeometry.rect,
								cropWidth,
								cropHeight,
								spot_diameter_fullres: spotDiameterFullres,
								updatedAt: timestamp,
							},
							chipConfig: {
								...current.chipConfig,
								chipType: config.manifest.id,
								rows: config.manifest.gridRows,
								columns: config.manifest.gridCols,
								pitchX: config.manifest.spotGap,
								pitchY: config.manifest.spotGap,
								origin: { x: 0, y: 0 },
								rotationDegrees: 0,
								projectedSpots,
								status: "complete",
								isStale: false,
								updatedAt: timestamp,
								error: null,
							},
							tissueSelection: nextTissueSelection,
						};
					},
					{ mode: "metadata", strategy: "debounced" },
				);
			} catch (error) {
				if (chipConfigRequestTokenRef.current !== chipRequestToken) {
					return;
				}

				const message =
					error instanceof Error ? error.message : "Failed to load chip config";
				setChipConfigError(message);
				onProjectMutate(
					(current) => {
						const currentCropGeometry = current.cropQc.eosinReferenceGeometry;
						if (
							chipConfigRequestTokenRef.current !== chipRequestToken ||
							current.cropQc.status !== "complete" ||
							!current.cropQc.qcAccepted ||
							current.chipConfig.projectedSpots !== null ||
							current.chipConfig.chipType !== chipId ||
							!currentCropGeometry ||
							current.cropQc.cropWidth !== cropWidth ||
							current.cropQc.cropHeight !== cropHeight
						) {
							return current;
						}

						return {
							...current,
							chipConfig: {
								...current.chipConfig,
								status: "error",
								isStale: false,
								updatedAt: new Date().toISOString(),
								error: message,
							},
						};
					},
					{ mode: "metadata", strategy: "debounced" },
				);
			}
		})();
	}, [
		hasAcceptedCropAssets,
		chipProjectionChipId,
		chipProjectionCropHeight,
		chipProjectionCropStatus,
		chipProjectionCropWidth,
		chipProjectionProjectedSpots,
		chipProjectionQcAccepted,
		onProjectMutate,
	]);

	const handleLocalizationRotationChange = useCallback(
		(value: number) => {
			applyLocalizationUpdate(
				(current) => ({
					...current,
					imageTransform: {
						...current.imageTransform,
						rotationDegrees: normalizeLocalizationRotationDegrees(value),
					},
				}),
				{ persistOptions: localizationMetadataPersistOptions },
			);
		},
		[applyLocalizationUpdate, localizationMetadataPersistOptions],
	);

	const tissueSupport = project
		? resolveTissueSelectionSupport({
				chipType: project.chipConfig.chipType,
				rows: project.chipConfig.rows,
				columns: project.chipConfig.columns,
			})
		: { supportState: "unsupported" as const, unsupportedReason: null };

	const runTissueAutoDetection = useCallback(async () => {
		if (!project) {
			return;
		}
		if (
			tissueSupport.supportState === "unsupported" ||
			!tissueAutoDetectionReadiness.ready
		) {
			if (
				tissueSupport.supportState !== "unsupported" &&
				tissueAutoDetectionReadiness.reason
			) {
				toast({
					title: "Tissue auto detection blocked",
					description: tissueAutoDetectionReadiness.reason,
					status: "warning",
				});
			}
			return;
		}
		const { matrixColumns, matrixRows, projectedSpots, tissueImageArgs } =
			tissueAutoDetectionReadiness;

		const requestToken = tissueDetectionRequestTokenRef.current + 1;
		tissueDetectionRequestTokenRef.current = requestToken;
		const snapshot = buildTissueDetectionSnapshot({
			project,
			tissueImageArgs,
			projectedSpots,
		});
		setIsDetectingTissue(true);
		onProjectMutate(
			(current) => ({
				...current,
				tissueSelection: {
					...current.tissueSelection,
					supportState: tissueSupport.supportState,
					unsupportedReason: tissueSupport.unsupportedReason,
					warning: null,
					error: null,
					status: "processing",
					isStale: false,
					updatedAt: new Date().toISOString(),
				},
			}),
					{ mode: "tissue" },
				);

		try {
			const result = await runTissueAutoSelection({
				...tissueImageArgs,
				matrixRows,
				matrixColumns,
				projectedSpots,
				params: {
					thresholdMode: project.tissueSelection.thresholdMode,
					activationThreshold: clampActivationThreshold(
						project.tissueSelection.activationThreshold,
					),
					blockThreshold: project.tissueSelection.blockThreshold,
					dbscanEps: project.tissueSelection.dbscanEps,
					dbscanMinSamples: project.tissueSelection.dbscanMinSamples,
					minConnectedSpotCount: project.tissueSelection.minConnectedSpotCount,
				},
			});

			if (tissueDetectionRequestTokenRef.current !== requestToken) {
				return;
			}

			onProjectMutate(
				(current) => {
					if (!matchesTissueDetectionSnapshot(current, snapshot)) {
						return current;
					}

					return {
						...current,
						tissueSelection: {
							...current.tissueSelection,
							mode: "matrix",
							supportState: tissueSupport.supportState,
							unsupportedReason: tissueSupport.unsupportedReason,
							thresholdMode: result.params.thresholdMode,
							activationThreshold: result.params.activationThreshold,
							blockThreshold: result.params.blockThreshold,
							dbscanEps: result.params.dbscanEps,
							dbscanMinSamples: result.params.dbscanMinSamples,
							minConnectedSpotCount: result.params.minConnectedSpotCount,
							matrix: result.matrix,
							autoSelectedSpotIds: result.selectedIds,
							selectedSpotIds: result.selectedIds,
							paritySummary: result.summary,
							warning: result.warning,
							status: result.warning ? "error" : "complete",
							isStale: false,
							updatedAt: new Date().toISOString(),
							error: result.warning,
						},
						exportState: {
							...current.exportState,
							status: result.warning ? "stale" : "ready",
							isStale: Boolean(result.warning),
							updatedAt: new Date().toISOString(),
							lastExportedAt: null,
							artifacts: [],
							error: null,
						},
					};
				},
				{ mode: "tissue" },
			);
		} catch (error) {
			if (tissueDetectionRequestTokenRef.current !== requestToken) {
				return;
			}
			const message =
				error instanceof Error ? error.message : "Failed to run auto detection";
			onProjectMutate(
				(current) => {
					if (!matchesTissueDetectionSnapshot(current, snapshot)) {
						return current;
					}

					return {
						...current,
						tissueSelection: {
							...current.tissueSelection,
							supportState: tissueSupport.supportState,
							unsupportedReason: tissueSupport.unsupportedReason,
							warning: message,
							status: "error",
							isStale: false,
							updatedAt: new Date().toISOString(),
							error: message,
						},
						exportState: {
							...current.exportState,
							status: "stale",
							isStale: true,
							updatedAt: new Date().toISOString(),
							lastExportedAt: null,
							artifacts: [],
							error: null,
						},
					};
				},
					{ mode: "tissue" },
				);
		} finally {
			if (tissueDetectionRequestTokenRef.current === requestToken) {
				setIsDetectingTissue(false);
			}
		}
	}, [
		onProjectMutate,
		project,
		tissueAutoDetectionReadiness,
		tissueSupport,
		toast,
	]);

	const currentCopy = project
		? placeholderCopyByStep[project.currentStep]
		: placeholderCopyByStep.sourceAssets;
	const tissueDetectionStatusMessage = isDetectingTissue
		? "Tissue auto-selection is running. Manual edits are temporarily locked."
		: tissueSupport.supportState !== "unsupported" &&
				!tissueAutoDetectionReadiness.ready
			? tissueAutoDetectionReadiness.reason
			: project?.tissueSelection.status === "complete"
				? "Tissue spot selection is complete. Refine the selection by marking spots as tissue or background if necessary."
				: "Choose a signal mode and auto-select tissue spots to refresh the tissue matrix.";
	const tissueProjectedSpots = useMemo(
		() => project?.chipConfig.projectedSpots ?? [],
		[project?.chipConfig.projectedSpots],
	);
	const tissueSelectedSpotIds = useMemo(() => {
		if (!project) {
			return [];
		}

		if (project.tissueSelection.matrix && tissueProjectedSpots.length > 0) {
			return selectedSpotIdsFromMatrix(
				project.tissueSelection.matrix,
				tissueProjectedSpots,
			);
		}

		return project.tissueSelection.selectedSpotIds ?? [];
	}, [project, tissueProjectedSpots]);
	const isTissueInteractionDisabled =
		isDetectingTissue || tissueSupport.supportState === "unsupported";
	const isChipSelectorDisabled = isDetectingTissue;
	const [showTissueSpots, setShowTissueSpots] = useState(true);
	const commitManualTissueSelection = useCallback(
		(edit: { readonly editArea: PreprocessPoint[] } | { readonly spotId: string }) => {
			onProjectMutate(
				(current) => {
					const projectedSpots = current.chipConfig.projectedSpots ?? [];
					const updatedAt = new Date().toISOString();
					const nextValue: TissueActivationValue = tissueTool === "activate" ? 1 : 0;
					const editArgs = "editArea" in edit
						? {
								editArea: edit.editArea,
								nextValue,
							}
						: { spotId: edit.spotId };
					const nextTissueSelection = buildManualTissueSelectionState({
						current: current.tissueSelection,
						projectedSpots,
						...editArgs,
						rows: current.chipConfig.rows,
						columns: current.chipConfig.columns,
						updatedAt,
					});
					if (nextTissueSelection === current.tissueSelection) {
						return current;
					}

					return {
						...current,
						tissueSelection: nextTissueSelection,
						exportState: {
							...current.exportState,
							status: "stale",
							isStale: true,
							updatedAt,
							lastExportedAt: null,
							artifacts: [],
							error: null,
						},
					};
				},
				{ mode: "tissue", strategy: "debounced" },
			);
		},
		[onProjectMutate, tissueTool],
	);

	useEffect(() => {
		if (!project || isEditingProjectName) return;
		setProjectNameDraft(project.name);
	}, [isEditingProjectName, project]);

	const commitProjectNameDraft = useCallback(() => {
		const nextName = projectNameDraft.trim();
		onProjectNameChange(
			nextName || project?.name || "Untitled preprocessing project",
		);
		setIsEditingProjectName(false);
	}, [onProjectNameChange, project?.name, projectNameDraft]);

	const cancelProjectNameEditing = useCallback(() => {
		setProjectNameDraft(project?.name ?? "");
		setIsEditingProjectName(false);
	}, [project]);

	if (isLoading) {
		return (
			<Flex
				minH="100vh"
				bg="gray.50"
				align="center"
				justify="center"
				direction="column"
				gap={4}
			>
				<Spinner size="xl" color="brand.500" thickness="4px" />
				<Heading size="md">Loading preprocessing project…</Heading>
			</Flex>
		);
	}

	if (loadError || !project) {
		return (
			<Flex minH="100vh" bg="gray.50" align="center" justify="center" px={4}>
				<Box
					bg="white"
					border="1px solid"
					borderColor="red.100"
					boxShadow="md"
					borderRadius="lg"
					p={8}
					maxW="560px"
					w="100%"
				>
					<Stack spacing={4}>
						<Badge colorScheme="red" alignSelf="flex-start">
							Unavailable
						</Badge>
						<Heading size="md">Unable to open preprocessing workspace</Heading>
						<Text color="gray.600">
							{loadError ?? "Project not found in this browser."}
						</Text>
						<Button
							onClick={onBackToLanding}
							colorScheme="brand"
							alignSelf="flex-start"
						>
							Back to preprocessing projects
						</Button>
					</Stack>
				</Box>
			</Flex>
		);
	}

	return (
		<Flex
			direction="column"
			minH="100vh"
			bg="gray.50"
			data-testid="preprocess-workspace-shell"
		>
			<Flex
				flex="1"
				direction="column"
				px={{ base: 4, md: 10 }}
				py={{ base: 6, md: 8 }}
				gap={6}
			>
				<Flex justify="space-between" align="flex-start" gap={4} wrap="wrap">
					<Stack spacing={2} flex="1" minW="0">
						<Flex
							direction={{ base: "column", sm: "row" }}
							align={{ base: "flex-start", sm: "center" }}
							gap={3}
						>
							<Button
								variant="ghost"
								size="sm"
								px={0}
								onClick={onBackToLanding}
							>
								← Back to preprocessing projects
							</Button>
							{isEditingProjectName ? (
								<Input
									value={projectNameDraft}
									onChange={(event) => setProjectNameDraft(event.target.value)}
									onBlur={commitProjectNameDraft}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											commitProjectNameDraft();
										}

										if (event.key === "Escape") {
											event.preventDefault();
											cancelProjectNameEditing();
										}
									}}
									size="lg"
									maxW="720px"
									fontSize={{ base: "2xl", md: "3xl" }}
									fontWeight="bold"
									data-testid="project-name-input"
									autoFocus
								/>
							) : (
								<Heading
									size="lg"
									cursor="text"
									onClick={() => setIsEditingProjectName(true)}
									width="fit-content"
								>
									{project.name}
								</Heading>
							)}
						</Flex>
						<HStack spacing={3} wrap="wrap" align="center">
							<Badge
								colorScheme={autosaveTone[autosaveStatus] ?? "gray"}
								variant="solid"
								px={3}
								py={1}
								borderRadius="md"
								data-testid="autosave-status"
							>
								{autosaveStatus}
							</Badge>
							{autosaveDetail ? (
								<Text fontSize="sm" color="gray.500">
									{autosaveDetail}
								</Text>
							) : null}
						</HStack>
					</Stack>
				</Flex>

				<Flex direction={{ base: "column", md: "row" }} gap={6} align="stretch">
					<StepSidebar
						currentStep={project.currentStep}
						onStepSelect={onStepChange}
						project={project}
					/>

					<Box flex="1" minW={0}>
						<Stack spacing={6}>
							{project.currentStep === "sourceAssets" ? (
								<Stack spacing={5}>
									<Text color="gray.600" maxW="3xl">
										{currentCopy.body}
									</Text>
								<Flex direction={{ base: "column", xl: "row" }} gap={5}>
									<Box flex={1} minW={0}>
										<SourceAssetUploader
											label="NATA Align image"
											description="The NATA Align image uploaded here should be exported from the NATA Align Spatial Instrument and will be used for downstream chip capture area localization and image analysis."
											buttonLabel={
												project.sourceAssets.images.eosin
													? "Replace reference"
													: "Replace reference"
											}
											emptyText="No eosin reference image uploaded yet."
											image={project.sourceAssets.images.eosin}
											onUpload={(fileList) => {
												void handleUploadEosin(fileList);
											}}
										/>
									</Box>
									<Box flex={1} minW={0}>
										<SourceAssetUploader
											label="H&E stained tissue image"
											description="Moving image for HE focus, landmark registration, and registered crop generation."
											buttonLabel={
												project.sourceAssets.images.he
													? "Replace image"
													: "Upload HE image"
											}
											emptyText="No HE source image uploaded yet."
											image={project.sourceAssets.images.he}
											onUpload={(fileList) => {
												void handleUploadHe(fileList);
											}}
										/>
									</Box>
								</Flex>
								</Stack>
							) : project.currentStep === "localization" ? (
								<Flex
									direction={{ base: "column", xl: "row" }}
									gap={5}
									align="stretch"
								>
									<CanvasStage
										boxColor={
											project.localization.boxColor as LocalizationBoxColor
										}
										chipBounds={localizationStageChipBounds}
										image={localizationImage}
										imageTransform={project.localization.imageTransform}
										onScaleChange={(value) => {
										applyLocalizationUpdate(
											(current) => ({
												...current,
												imageTransform: {
													...current.imageTransform,
													scale: value,
												},
											}),
											{
												invalidateDownstream: false,
												persistOptions: METADATA_DEBOUNCED_PERSIST_OPTIONS,
											},
										);
									}}
										onScaleDelta={(delta) => {
										applyLocalizationUpdate(
											(current) => ({
												...current,
												imageTransform: {
														...current.imageTransform,
														scale: clampLocalizationScale(
															current.imageTransform.scale + delta,
														),
												},
											}),
											{
												invalidateDownstream: false,
												persistOptions: METADATA_DEBOUNCED_PERSIST_OPTIONS,
											},
										);
									}}
										onRotationChange={handleLocalizationRotationChange}
										onRotationDelta={(delta) => {
											applyLocalizationUpdate(
												(current) => ({
													...current,
													imageTransform: {
														...current.imageTransform,
											rotationDegrees: normalizeLocalizationRotationDegrees(
												current.imageTransform.rotationDegrees + delta,
											),
										},
									}),
									{ persistOptions: localizationMetadataPersistOptions },
								);
							}}
										onFlipHorizontal={() => {
											applyLocalizationUpdate(
												(current) => ({
													...current,
													imageTransform: {
														...current.imageTransform,
										flipHorizontal:
											!current.imageTransform.flipHorizontal,
									},
								}),
								{ persistOptions: localizationMetadataPersistOptions },
							);
						}}
										onFlipVertical={() => {
											applyLocalizationUpdate(
												(current) => ({
													...current,
													imageTransform: {
														...current.imageTransform,
										flipVertical: !current.imageTransform.flipVertical,
									},
								}),
								{ persistOptions: localizationMetadataPersistOptions },
							);
						}}
										onResetTransform={() => {
											applyLocalizationUpdate(
												(current) => ({
													...current,
									imageTransform: DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
								}),
								{ persistOptions: localizationMetadataPersistOptions },
							);
						}}
										onChipBoundsChange={(chipBounds) => {
											setLocalizationDraftChipBounds(chipBounds);
										}}
										onChipBoundsCancel={() => {
											setLocalizationDraftChipBounds(null);
										}}
										onChipBoundsCommit={(chipBounds) => {
											setLocalizationDraftChipBounds(null);
											applyLocalizationUpdate(
												(current) => ({
													...current,
									chipBounds,
									method: "manual",
								}),
								{ persistOptions: localizationMetadataPersistOptions },
							);
						}}
									/>
								</Flex>
							) : project.currentStep === "heFocus" ? (
								<Stack spacing={5}>
									<Text color="gray.600" maxW="3xl">
										{currentCopy.body}
									</Text>
									<Flex
										direction={{ base: "column", xl: "row" }}
										gap={5}
										align="stretch"
									>
										<CanvasStage
											allowOutOfBoundsChipBounds
											boxColor="green"
											chipBounds={heFocusStageChipBounds}
											containerTestId="preprocess-he-focus-canvas-column"
											controlTestIdPrefix="he-focus"
											image={currentHeImageSource}
											imageTransform={project.heFocus.imageTransform}
											labels={{
												badgeReady: "HE preview ready",
												badgeWaiting: "Awaiting HE image",
												description:
													"Using the adjusted NATA Align image as a reference, position and orient the H&E ROI to match the corresponding tissue region before landmark pairing.",
												emptyDescription:
													"Upload the HE source image in Source images before defining the registration region.",
												emptyTitle: "No HE image loaded",
												heading: "H&E ROI Alignment",
												overlayAriaLabel: "HE registration region overlay",
												resetAriaLabel: "Reset HE focus transform",
												savedHint:
													"Saved HE focus bounds stay square and normalized in original HE image coordinates.",
											}}
											onChipBoundsCancel={() => {
												setHeFocusDraftChipBounds(null);
											}}
											onScaleChange={(value) => {
												applyHeFocusUpdate(
													(current) => ({
														...current,
														imageTransform: {
															...current.imageTransform,
															scale: value,
														},
													}),
												{
													invalidateDownstream: false,
													persistOptions: METADATA_DEBOUNCED_PERSIST_OPTIONS,
													preserveFocusedImage: true,
												},
											);
											}}
											onScaleDelta={(delta) => {
												applyHeFocusUpdate(
													(current) => ({
														...current,
														imageTransform: {
															...current.imageTransform,
															scale: clampLocalizationScale(
																current.imageTransform.scale + delta,
															),
														},
													}),
												{
													invalidateDownstream: false,
													persistOptions: METADATA_DEBOUNCED_PERSIST_OPTIONS,
													preserveFocusedImage: true,
												},
											);
											}}
											onRotationChange={(value) => {
											applyHeFocusUpdate(
												(current) => ({
													...current,
													imageTransform: {
														...current.imageTransform,
														rotationDegrees:
															normalizeLocalizationRotationDegrees(value),
													},
												}),
												{ persistOptions: heFocusMetadataPersistOptions },
											);
										}}
										onRotationDelta={(delta) => {
											applyHeFocusUpdate(
												(current) => ({
													...current,
													imageTransform: {
														...current.imageTransform,
														rotationDegrees:
															normalizeLocalizationRotationDegrees(
																current.imageTransform.rotationDegrees + delta,
															),
													},
												}),
												{ persistOptions: heFocusMetadataPersistOptions },
											);
										}}
										onFlipHorizontal={() => {
											applyHeFocusUpdate(
												(current) => ({
													...current,
													imageTransform: {
														...current.imageTransform,
														flipHorizontal:
															!current.imageTransform.flipHorizontal,
													},
												}),
												{ persistOptions: heFocusMetadataPersistOptions },
											);
										}}
										onFlipVertical={() => {
											applyHeFocusUpdate(
												(current) => ({
													...current,
													imageTransform: {
														...current.imageTransform,
														flipVertical: !current.imageTransform.flipVertical,
													},
												}),
												{ persistOptions: heFocusMetadataPersistOptions },
											);
										}}
										onResetTransform={() => {
											applyHeFocusUpdate(
												(current) => ({
													...current,
													imageTransform: DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
												}),
												{ persistOptions: heFocusMetadataPersistOptions },
											);
										}}
											onChipBoundsChange={(chipBounds) => {
												setHeFocusDraftChipBounds(chipBounds);
											}}
											onChipBoundsCommit={(chipBounds) => {
												setHeFocusDraftChipBounds(null);
												applyHeFocusUpdate(
													(current) => ({
														...current,
														chipBounds,
													}),
													{
														invalidationScope: "commit",
														persistOptions: heFocusMetadataPersistOptions,
													},
												);
											}}
										/>

										<Box
											w={{ base: "100%", xl: "320px" }}
											minW={{ base: "100%", xl: "320px" }}
											border="1px dashed"
											borderColor="gray.200"
											borderRadius="2xl"
											bg="gray.50"
											px={4}
											py={4}
											data-testid="he-focus-localize-reference-card"
										>
											<Stack spacing={3}>
												<Stack spacing={1}>
													<HStack spacing={2} align="center">
														<Heading size="sm">
													NATA Align Reference Image
														</Heading>
														<Badge colorScheme="blue" variant="subtle">
															Reference crop
														</Badge>
													</HStack>
													<Text fontSize="sm" color="gray.600">
												Use the reference NATA Align image to identify and align the
												corresponding ROI in the H&E image.
													</Text>
												</Stack>
												{heFocusComparisonImageDataUrl ? (
													<Image
														src={heFocusComparisonImageDataUrl}
														alt="Eosin chip-localized reference preview"
														data-testid="he-focus-localize-reference-preview"
														borderRadius="lg"
														border="1px solid"
														borderColor="gray.200"
														objectFit="contain"
														bg="white"
														maxH="280px"
														w="100%"
													/>
												) : heFocusComparisonSource ? (
													<Flex
														minH="180px"
														align="center"
														justify="center"
														borderRadius="lg"
														border="1px solid"
														borderColor="gray.200"
														bg="white"
														px={4}
													>
														<Text
															fontSize="sm"
															color="gray.600"
															textAlign="center"
														>
															Preparing the eosin chip-localized reference
															preview.
														</Text>
													</Flex>
												) : (
													<Flex
														minH="180px"
														align="center"
														justify="center"
														borderRadius="lg"
														border="1px solid"
														borderColor="gray.200"
														bg="white"
														px={4}
													>
														<Text
															fontSize="sm"
															color="gray.600"
															textAlign="center"
														>
															Complete chip localization with a committed capture
															area to enable this comparison reference.
														</Text>
													</Flex>
												)}
											</Stack>
										</Box>
									</Flex>
								</Stack>
							) : project.currentStep === "alignment" ? (
								<AlignmentPanelWithPaddingBoundary
									alignment={project.alignment}
									chipBounds={project.localization.chipBounds}
									movingImage={alignmentMovingImage}
									onSolveAccepted={() => {
										onStepChange("cropQc");
									}}
									referenceImage={alignmentReferenceImage}
									referenceImageTransform={{
										rotationDegrees:
											project.localization.imageTransform.rotationDegrees,
										flipHorizontal:
											project.localization.imageTransform.flipHorizontal,
										flipVertical:
											project.localization.imageTransform.flipVertical,
										scale: DEFAULT_LOCALIZATION_IMAGE_TRANSFORM.scale,
									}}
									showMovingImagePaddingBoundary={
										showMovingImagePaddingBoundary
									}
									onAlignmentChange={applyAlignmentUpdate}
								/>
							) : project.currentStep === "cropQc" ? (
								<CropQcPanel
									cropHeight={project.cropQc.cropHeight}
									cropWidth={project.cropQc.cropWidth}
									eosinCropDataUrl={project.cropQc.eosinPreviewDataUrl}
									heCropDataUrl={project.cropQc.previewDataUrl}
									checkerboardDataUrl={
										project.cropQc.checkerboardPreviewDataUrl
									}
									featureMatchesDataUrl={
										project.cropQc.featureMatchesPreviewDataUrl ??
										project.cropQc.featureMatchesPreview?.dataUrl ??
										null
									}
									overlayOpacity={project.cropQc.overlayOpacity}
									onOverlayOpacityCommit={(value: number) => {
										applyCropQcUpdate(
											(current) => ({
												...current,
												overlayOpacity: value,
											}),
											{ invalidateDownstream: false },
										);
									}}
									onRunCrop={() => {
										void runCropQcStep();
									}}
									onAccept={() => {
										applyCropQcUpdate(
											(current) => ({
												...current,
												qcAccepted: true,
												status: "complete",
												error: null,
											}),
											{ invalidateDownstream: true },
										);
									}}
									onRejectToAlign={() => {
										onStepChange("alignment");
										applyCropQcUpdate(
											(current) => ({
												...current,
												qcAccepted: false,
												status: "stale",
											}),
											{ invalidateDownstream: true },
										);
									}}
								canRun={Boolean(
									project.alignment.status === "complete" &&
										(project.alignment.qualityFlags.accepted ||
											project.alignment.forceAccepted) &&
										alignmentReferenceImage?.dataUrl &&
										alignmentMovingImage?.dataUrl,
								)}
									canAccept={Boolean(
										project.cropQc.cropWidth && project.cropQc.cropHeight,
									)}
								/>
							) : project.currentStep === "chipConfig" ||
								project.currentStep === "tissueSelection" ? (
								<Box position="relative">
									<Flex
										direction={{ base: "column", xl: "row" }}
										gap={5}
										align="stretch"
									>
										<Box flex="1" minW={0}>
											<TissueSelectionPanel
												eosinCropDataUrl={
													project.cropQc.cropAssets?.eosin?.lowres.dataUrl ??
													null
												}
												projectedSpots={tissueProjectedSpots}
												selectedSpotIds={tissueSelectedSpotIds}
												showSpots={showTissueSpots}
												showControls={false}
												tool={tissueTool}
												disabled={isTissueInteractionDisabled}
												onToolChange={setTissueTool}
												onEditCommit={(editArea) => {
													commitManualTissueSelection({ editArea });
												}}
												onSpotToggle={(spotId) => {
													commitManualTissueSelection({ spotId });
												}}
											/>
										</Box>
										<Stack
											w={{ base: "100%", xl: "320px" }}
											spacing={4}
											flexShrink={0}
										>
											<Card
												border="1px solid"
												borderColor="gray.200"
												borderRadius="2xl"
												boxShadow="sm"
												bg="white"
											>
												<CardBody p={4}>
													<Stack spacing={3}>
														<Text fontSize="sm" fontWeight="semibold">
															Chip Information
														</Text>
														<FormControl isDisabled={isChipSelectorDisabled}>
															<FormLabel
																fontSize="xs"
																color="gray.500"
																mb={1.5}
															>
																Spot Size
															</FormLabel>
															<Select
																value={project.chipConfig.chipType ?? ""}
																placeholder="Select capture pitch"
																data-testid="tissue-chip-size-select"
																onChange={(event) => {
																	const chipId = event.target.value;
																	if (chipId !== "15um" && chipId !== "50um")
																		return;
																	if (
																		!project.cropQc.cropWidth ||
																		!project.cropQc.cropHeight
																	)
																		return;
																	const cropWidth = project.cropQc.cropWidth;
																	const cropHeight = project.cropQc.cropHeight;
																	const chipRequestToken =
																		++chipConfigRequestTokenRef.current;
																	void (async () => {
																		try {
																			setChipConfigError(null);
																			const config =
																				await loadChipConfigData(chipId);
																			if (
																				chipConfigRequestTokenRef.current !==
																				chipRequestToken
																			) {
																				return;
																			}
																			const {
																				projectedSpots,
																				spotDiameterFullres,
																				tissueSupport: nextSupport,
																			} = deriveChipProjectionForCrop({
																				config,
																				cropWidth,
																				cropHeight,
																			});
																			const timestamp =
																				new Date().toISOString();

																			onProjectMutate((current) => {
																				if (
																					chipConfigRequestTokenRef.current !==
																						chipRequestToken ||
																					current.cropQc.cropWidth !==
																						cropWidth ||
																					current.cropQc.cropHeight !==
																						cropHeight
																				) {
																					return current;
																				}
																				return {
																					...current,
																					cropQc: {
																						...current.cropQc,
																						spot_diameter_fullres:
																							spotDiameterFullres,
																						updatedAt: timestamp,
																					},
																					chipConfig: {
																						...current.chipConfig,
																						chipType: config.manifest.id,
																						rows: config.manifest.gridRows,
																						columns: config.manifest.gridCols,
																						pitchX: config.manifest.spotGap,
																						pitchY: config.manifest.spotGap,
																						origin: { x: 0, y: 0 },
																						rotationDegrees: 0,
																						projectedSpots,
																						status: "complete",
																						isStale: false,
																						updatedAt: timestamp,
																						error: null,
																					},
																					tissueSelection: {
																						...current.tissueSelection,
																						supportState:
																							nextSupport.supportState,
																						unsupportedReason:
																							nextSupport.unsupportedReason,
																						matrix: null,
																						autoSelectedSpotIds: [],
																						selectedSpotIds: null,
																						paritySummary: null,
																						warning: null,
																						status: "stale",
																						isStale: true,
																						updatedAt: timestamp,
																						error: null,
																					},
																					exportState: {
																						...current.exportState,
																						status: "stale",
																						isStale: true,
																						updatedAt: timestamp,
																						lastExportedAt: null,
																						artifacts: [],
																						error: null,
																					},
																				};
																			});
																		} catch (error) {
																			if (
																				chipConfigRequestTokenRef.current !==
																				chipRequestToken
																			) {
																				return;
																			}
																			const message =
																				error instanceof Error
																					? error.message
																					: "Failed to load chip config";
																			const nextSupport =
																				resolveTissueSelectionSupport({
																					chipType: chipId,
																					rows: null,
																					columns: null,
																				});
																			setChipConfigError(message);
																			onProjectMutate((current) => {
																				if (
																					chipConfigRequestTokenRef.current !==
																						chipRequestToken ||
																					current.cropQc.cropWidth !==
																						cropWidth ||
																					current.cropQc.cropHeight !==
																						cropHeight
																				) {
																					return current;
																				}
																				return {
																					...current,
																					chipConfig: {
																						...current.chipConfig,
																						chipType: chipId,
																						projectedSpots: null,
																						status: "error",
																						isStale: false,
																						updatedAt: new Date().toISOString(),
																						error: message,
																					},
																					tissueSelection: {
																						...current.tissueSelection,
																						supportState:
																							nextSupport.supportState,
																						unsupportedReason:
																							nextSupport.unsupportedReason,
																						matrix: null,
																						autoSelectedSpotIds: [],
																						selectedSpotIds: null,
																						paritySummary: null,
																						warning: null,
																						status: "error",
																						isStale: false,
																						updatedAt: new Date().toISOString(),
																						error: message,
																					},
																					exportState: {
																						...current.exportState,
																						status: "stale",
																						isStale: true,
																						updatedAt: new Date().toISOString(),
																						lastExportedAt: null,
																						artifacts: [],
																						error: null,
																					},
																				};
																			});
																		}
																	})();
																}}
															>
																<option value="15um">15um</option>
																<option value="50um">50um</option>
															</Select>
														</FormControl>
														<Text fontSize="xs" color="gray.500">
															Changing the capture resolution will clear previous tissue edits,
															regenerate the projected spot grid, and require tissue auto-selection
															to be performed again.
														</Text>
														{(chipConfigError ?? project.chipConfig.error) ? (
															<Text fontSize="sm" color="red.600">
																{chipConfigError ?? project.chipConfig.error}
															</Text>
														) : null}
													</Stack>
												</CardBody>
											</Card>

											<TissueSelectionControls
												thresholdMode={project.tissueSelection.thresholdMode}
												activationThreshold={
													project.tissueSelection.activationThreshold
												}
												blockThreshold={project.tissueSelection.blockThreshold}
												supportState={tissueSupport.supportState}
												unsupportedReason={tissueSupport.unsupportedReason}
												isDetecting={isDetectingTissue}
												tissueTool={tissueTool}
												showSpots={showTissueSpots}
												onThresholdModeChange={(thresholdMode) => {
													onProjectMutate(
														(current) => {
															const nextSupport = resolveTissueSelectionSupport(
																{
																	chipType: current.chipConfig.chipType,
																	rows: current.chipConfig.rows,
																	columns: current.chipConfig.columns,
																},
															);
															const updatedAt = new Date().toISOString();

															return {
																...current,
																tissueSelection: {
																	...current.tissueSelection,
																	thresholdMode,
																	supportState: nextSupport.supportState,
																	unsupportedReason:
																		nextSupport.unsupportedReason,
																	status: "stale",
																	warning: null,
																	error: null,
																	isStale: true,
																	updatedAt,
																},

																exportState: {
																	...current.exportState,
																	status: "stale",
																	isStale: true,
																	updatedAt,
																	lastExportedAt: null,
																	artifacts: [],
																	error: null,
																},
															};
														},
														{ mode: "metadata", strategy: "debounced" },
													);
												}}
												onActivationThresholdChange={(activationThreshold) => {
													onProjectMutate(
														(current) => {
															const nextSupport = resolveTissueSelectionSupport(
																{
																	chipType: current.chipConfig.chipType,
																	rows: current.chipConfig.rows,
																	columns: current.chipConfig.columns,
																},
															);
															const updatedAt = new Date().toISOString();

															return {
																...current,
																tissueSelection: {
																	...current.tissueSelection,
																	activationThreshold,
																	supportState: nextSupport.supportState,
																	unsupportedReason:
																		nextSupport.unsupportedReason,
																	status: "stale",
																	warning: null,
																	error: null,
																	isStale: true,
																	updatedAt,
																},

																exportState: {
																	...current.exportState,
																	status: "stale",
																	isStale: true,
																	updatedAt,
																	lastExportedAt: null,
																	artifacts: [],
																	error: null,
																},
															};
														},
														{ mode: "metadata", strategy: "debounced" },
													);
												}}
												onBlockThresholdChange={(blockThreshold) => {
													onProjectMutate(
														(current) => {
															const nextSupport = resolveTissueSelectionSupport(
																{
																	chipType: current.chipConfig.chipType,
																	rows: current.chipConfig.rows,
																	columns: current.chipConfig.columns,
																},
															);
															const updatedAt = new Date().toISOString();

															return {
																...current,
																tissueSelection: {
																	...current.tissueSelection,
																	blockThreshold,
																	supportState: nextSupport.supportState,
																	unsupportedReason:
																		nextSupport.unsupportedReason,
																	status: "stale",
																	warning: null,
																	error: null,
																	isStale: true,
																	updatedAt,
																},

																exportState: {
																	...current.exportState,
																	status: "stale",
																	isStale: true,
																	updatedAt,
																	lastExportedAt: null,
																	artifacts: [],
																	error: null,
																},
															};
														},
														{ mode: "metadata", strategy: "debounced" },
													);
												}}
												onTissueToolChange={setTissueTool}
												onRunAutoDetection={() => {
													void runTissueAutoDetection();
												}}
												onInvertSelection={() => {
													onProjectMutate(
														(current) => {
															const projectedSpots =
																current.chipConfig.projectedSpots ?? [];
															const updatedAt = new Date().toISOString();
															return {
																...current,
																tissueSelection:
																	buildInvertedTissueSelectionState({
																		current: current.tissueSelection,
																		projectedSpots,
																		rows: current.chipConfig.rows,
																		columns: current.chipConfig.columns,
																		updatedAt,
																	}),
																exportState: {
																	...current.exportState,
																	status: "stale",
																	isStale: true,
																	updatedAt,
																	lastExportedAt: null,
																	artifacts: [],
																	error: null,
																},
															};
														},
														{ mode: "tissue", strategy: "debounced" },
													);
												}}
												onShowSpotsChange={setShowTissueSpots}
											/>

											<Card
												border="1px solid"
												borderColor="gray.200"
												borderRadius="2xl"
												boxShadow="sm"
												bg="white"
											>
												<CardBody p={4}>
													<Stack spacing={1}>
														<Text
															fontSize="sm"
															color="gray.600"
															data-testid="tissue-selected-count"
														>
															Number of Tissue Spots: {tissueSelectedSpotIds.length}
														</Text>
														{project.tissueSelection.warning ? (
															<Text
																fontSize="sm"
																color="orange.700"
																data-testid="tissue-detection-warning"
															>
																{project.tissueSelection.warning}
															</Text>
														) : (
															<Text
																fontSize="sm"
																color="gray.500"
																data-testid="tissue-detection-status"
															>
																{tissueDetectionStatusMessage}
															</Text>
														)}
													</Stack>
												</CardBody>
											</Card>
										</Stack>
									</Flex>
									{isDetectingTissue ? (
										<Flex
											position="absolute"
											inset={0}
											zIndex={2}
											bg="whiteAlpha.700"
											backdropFilter="blur(2px)"
											align="center"
											justify="center"
											borderRadius="2xl"
											pointerEvents="all"
										>
											<Stack spacing={3} align="center" textAlign="center">
												<Spinner size="lg" color="brand.500" thickness="4px" />
												<Text
													fontSize="sm"
													fontWeight="semibold"
													color="gray.700"
												>
													Selecting tissue spots…
												</Text>
												<Text fontSize="xs" color="gray.500">
													Manual editing is paused until this run finishes.
												</Text>
											</Stack>
										</Flex>
									) : null}
								</Box>
							) : project.currentStep === "exportState" ? (
								<ExportPanel
									includeProject={includeProjectJson}
									onToggleIncludeProject={setIncludeProjectJson}
									isExporting={isExporting}
									canExport={exportReadiness.canExport}
									onDownload={() => {
										const currentExportReadiness =
											getPreprocessZipExportReadiness(project, {
												includeAlignedImage,
											});
										if (!currentExportReadiness.canExport) {
											toast({
												title: "Export blocked",
												description: currentExportReadiness.reason,
												status: "warning",
											});
											return;
										}
										void (async () => {
											setIsExporting(true);
											try {
												const output = await exportPreprocessZip({
													project,
													includeProjectJson,
													includeAlignedImage,
												});

												const url = URL.createObjectURL(output.blob);
												const anchor = document.createElement("a");
												anchor.href = url;
												anchor.download = output.fileName;
												document.body.appendChild(anchor);
												anchor.click();
												document.body.removeChild(anchor);
												URL.revokeObjectURL(url);

												onProjectMutate((current) => ({
													...current,
													exportState: {
														...current.exportState,
														status: "complete",
														isStale: false,
														updatedAt: new Date().toISOString(),
														lastExportedAt: new Date().toISOString(),
														error: null,
													},
												}));
											} catch (error) {
												toast({
													title: "Export failed",
													description:
														error instanceof Error
															? error.message
															: "ZIP export failed",
													status: "error",
												});
												onProjectMutate((current) => ({
													...current,
													exportState: {
														...current.exportState,
														status: "error",
														isStale: false,
														updatedAt: new Date().toISOString(),
														error:
															error instanceof Error
																? error.message
																: "Export failed",
													},
												}));
											} finally {
												setIsExporting(false);
											}
										})();
									}}
								/>
							) : (
								<Box
									border="1px solid"
									borderColor="gray.100"
									borderRadius="lg"
									p={5}
									bg="gray.50"
								>
									<Heading size="sm">{currentCopy.title}</Heading>
								</Box>
							)}
						</Stack>
					</Box>
				</Flex>
			</Flex>

			<Text textAlign="center" fontSize="sm" color="gray.600" py={1} mt="auto">
				@M20 Genomics
			</Text>
		</Flex>
	);
}
