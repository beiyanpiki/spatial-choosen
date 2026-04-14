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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeAlignmentSlice } from "../../../lib/preprocess/alignment";
import {
	type ChipConfigManifest,
	loadAllChipConfigManifests,
	loadChipConfigData,
} from "../../../lib/preprocess/chipConfigs";
import { runCropQc } from "../../../lib/preprocess/cropQc";
import {
	exportPreprocessZip,
	getPreprocessZipExportReadiness,
} from "../../../lib/preprocess/exportBundle";
import {
	invalidateOnAlignmentChange,
	invalidateOnCropQcChange,
	invalidateOnHeFocusChange,
	invalidateOnLocalizationChange,
	invalidateOnSourceAssetsChange,
} from "../../../lib/preprocess/invalidation";
import { loadOpenCv } from "../../../lib/preprocess/loadOpenCv";
import {
	buildLocalizationHandles,
	clampNormalizedSquareRect,
	computeLocalizationStatus,
	createDefaultChipBounds,
	DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
	normalizeLocalizationImageTransform,
	normalizeLocalizationSlice,
} from "../../../lib/preprocess/localization";
import { buildSourceImage, createThumbnailBlob } from "../../../lib/preprocess/sourceImage";
import {
	projectSpotsForCrop,
	resolveAuthoritativeSpotDiameterFullres,
} from "../../../lib/preprocess/spotProjection";
import { buildManualTissueSelectionState } from "../../../lib/preprocess/projectUpdates";
import { runTissueAutoSelection } from "../../../lib/preprocess/tissuePipeline";
import { selectedSpotIdsFromMatrix } from "../../../lib/preprocess/tissueMatrix";
import { resolveTissueSelectionSupport } from "../../../lib/preprocess/tissueSupport";
import type {
	AlignmentSlice,
	CropQcSlice,
	HeFocusSlice,
	LocalizationBoxColor,
	LocalizationImageTransform,
	LocalizationSlice,
	PreprocessProject,
	PreprocessRect,
	PreprocessSourceImage,
	PreprocessStepId,
	TissueSelectionSlice,
} from "@/types/preprocess";
import { AlignmentPanel } from "./AlignmentPanel";
import { CanvasStage } from "./CanvasStage";
import { CropQcPanel } from "./CropQcPanel";
import { ExportPanel } from "./ExportPanel";
import { StepSidebar } from "./StepSidebar";
import { TissueSelectionControls, type TissueTool } from "./TissueSelectionControls";
import { TissueSelectionPanel } from "./TissueSelectionPanel";

type AutosaveStatus = "saving" | "saved" | "retrying" | "error";

type PreprocessWorkspaceProps = {
	autosaveStatus: AutosaveStatus;
	autosaveDetail: string | null;
	isLoading: boolean;
	loadError: string | null;
	onBackToLanding: () => void;
	onProjectMutate: (
		updater: (current: PreprocessProject) => PreprocessProject,
		persistOptions?: { mode?: "full" | "metadata"; strategy?: "immediate" | "debounced" },
	) => void;
	onProjectNameChange: (value: string) => void;
	onStepChange: (stepId: PreprocessStepId) => void;
	project: PreprocessProject | null;
};

const autosaveTone: Record<AutosaveStatus, string> = {
	saving: "orange",
	saved: "green",
	retrying: "orange",
	error: "red",
};

const clampLocalizationScale = (value: number) => Math.min(4, Math.max(0.5, value));

const MAX_ACTIVATION_THRESHOLD = 0.3;

const clampActivationThreshold = (value: number, fallback = 0) => {
	if (!Number.isFinite(value)) {
		return fallback;
	}

	const normalized = Math.round(value * 100) / 100;
	return Math.min(MAX_ACTIVATION_THRESHOLD, Math.max(0, normalized));
};

const normalizeLocalizationRotationDegrees = (value: number) => {
	const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
	return Object.is(wrapped, -0) ? 0 : wrapped;
};


const normalizeHeFocusSlice = (
	slice: HeFocusSlice,
	imageAspectRatio = 1,
): HeFocusSlice => {
	const nextRect = slice.chipBounds
		? clampNormalizedSquareRect(slice.chipBounds, imageAspectRatio)
		: null;

																							return {
		...slice,
		chipBounds: nextRect,
		handles: nextRect ? buildLocalizationHandles(nextRect) : [],
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

const generateFocusedHeDataUrl = async (args: {
	sourceDataUrl: string;
	chipBounds: PreprocessRect;
	imageTransform: LocalizationImageTransform;
}) => {
	const sourceImage = await loadDataUrlImage(args.sourceDataUrl);
	const sourceWidth = sourceImage.naturalWidth;
	const sourceHeight = sourceImage.naturalHeight;
	const cropX = Math.max(
		0,
		Math.min(sourceWidth - 1, Math.round(args.chipBounds.x * sourceWidth)),
	);
	const cropY = Math.max(
		0,
		Math.min(sourceHeight - 1, Math.round(args.chipBounds.y * sourceHeight)),
	);
	const cropWidth = Math.max(
		1,
		Math.min(sourceWidth - cropX, Math.round(args.chipBounds.width * sourceWidth)),
	);
	const cropHeight = Math.max(
		1,
		Math.min(
			sourceHeight - cropY,
			Math.round(args.chipBounds.height * sourceHeight),
		),
	);
	const outputSize = Math.max(1, Math.min(cropWidth, cropHeight));
	const cropCanvas = document.createElement("canvas");
	cropCanvas.width = outputSize;
	cropCanvas.height = outputSize;
	const cropContext = cropCanvas.getContext("2d");
	if (!cropContext) {
		throw new Error("Focused HE crop context unavailable");
	}
	cropContext.imageSmoothingEnabled = true;
	cropContext.imageSmoothingQuality = "high";
	cropContext.drawImage(
		sourceImage,
		cropX,
		cropY,
		cropWidth,
		cropHeight,
		0,
		0,
		outputSize,
		outputSize,
	);

	const focusedCanvas = document.createElement("canvas");
	focusedCanvas.width = outputSize;
	focusedCanvas.height = outputSize;
	const focusedContext = focusedCanvas.getContext("2d");
	if (!focusedContext) {
		throw new Error("Focused HE render context unavailable");
	}
	focusedContext.imageSmoothingEnabled = true;
	focusedContext.imageSmoothingQuality = "high";
	focusedContext.translate(outputSize / 2, outputSize / 2);
	focusedContext.scale(
		args.imageTransform.flipHorizontal ? -1 : 1,
		args.imageTransform.flipVertical ? -1 : 1,
	);
	focusedContext.rotate(
		(args.imageTransform.rotationDegrees * Math.PI) / 180,
	);
	focusedContext.drawImage(
		cropCanvas,
		-outputSize / 2,
		-outputSize / 2,
		outputSize,
		outputSize,
	);

	return focusedCanvas.toDataURL("image/png");
};
const placeholderCopyByStep: Record<
	PreprocessStepId,
	{ title: string; body: string }
> = {
	sourceAssets: {
		title: "Source asset intake",
		body: "Load and replace the local-only Eosin and H&E source images here before localization and alignment. Replacing either intake image keeps browser storage intact while invalidating downstream derived steps.",
	},
	localization: {
		title: "Chip localization",
		body: "Rotate or flip the displayed eosin image, drag the chip box, and keep the saved rectangle normalized and axis-aligned in image coordinates.",
	},
	heFocus: {
		title: "H&E focus",
		body: "Adjust a square H&E working region between localization and alignment. Saved focus bounds stay in original H&E image coordinates, and any stored focused-image preview reappears here when available.",
	},
	alignment: {
		title: "Image alignment",
		body: "Create paired eosin/H&E landmarks, verify coverage, and solve deterministic affine alignment with OpenCV quality gates.",
	},
	cropQc: {
		title: "Crop + QC shell",
		body: "Crop review and QC warnings will appear here once those interactions are implemented.",
	},
	chipConfig: {
		title: "Chip configuration shell",
		body: "Projected spot previews and chip settings are reserved for a later task. This placeholder keeps navigation and autosave working now.",
	},
	tissueSelection: {
		title: "Tissue selection shell",
		body: "Manual tissue-region tools are intentionally deferred. The workspace still tracks step changes and saved state.",
	},
	exportState: {
		title: "Export shell",
		body: "Export packaging will be added later. For now this step confirms route wiring, navigation, and autosave status feedback.",
	},
};

const resolveTissueAutoDetectionImageArgs = (project: PreprocessProject | null) => {
	const eosinLowresCropDataUrl = project?.cropQc.cropAssets?.eosin?.lowres.dataUrl ?? null;
	const cropWidth = project?.cropQc.cropWidth ?? null;
	const cropHeight = project?.cropQc.cropHeight ?? null;
	const tissueLowresScaleFactor = project?.cropQc.tissue_lowres_scalef;

	if (
		!eosinLowresCropDataUrl
		|| typeof cropWidth !== "number"
		|| typeof cropHeight !== "number"
		|| typeof tissueLowresScaleFactor !== "number"
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

const buildProjectedSpotSignature = (
	projectedSpots: NonNullable<PreprocessProject["chipConfig"]["projectedSpots"]>,
) => projectedSpots.map((spot) => `${spot.id}:${spot.x}:${spot.y}:${spot.width}:${spot.height}`).join("|");

const buildTissueDetectionSnapshot = (args: {
	project: PreprocessProject;
	tissueImageArgs: NonNullable<ReturnType<typeof resolveTissueAutoDetectionImageArgs>>;
	projectedSpots: NonNullable<PreprocessProject["chipConfig"]["projectedSpots"]>;
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
	const tissueImageArgs = resolveTissueAutoDetectionImageArgs(project);
	const projectedSpots = project.chipConfig.projectedSpots;
	if (!tissueImageArgs || !projectedSpots) {
		return false;
	}

	return (
		project.chipConfig.chipType === snapshot.chipType
		&& project.chipConfig.rows === snapshot.rows
		&& project.chipConfig.columns === snapshot.columns
		&& tissueImageArgs.eosinLowresCropDataUrl === snapshot.eosinLowresCropDataUrl
		&& tissueImageArgs.cropWidth === snapshot.cropWidth
		&& tissueImageArgs.cropHeight === snapshot.cropHeight
		&& tissueImageArgs.tissueLowresScaleFactor === snapshot.tissueLowresScaleFactor
		&& clampActivationThreshold(project.tissueSelection.activationThreshold)
			=== snapshot.activationThreshold
		&& project.tissueSelection.blockThreshold === snapshot.blockThreshold
		&& project.tissueSelection.thresholdMode === snapshot.thresholdMode
		&& buildProjectedSpotSignature(projectedSpots) === snapshot.projectedSpotSignature
	);
};

function SourceAssetUploader({
	label,
	description,
	buttonLabel,
	image,
	onUpload,
}: {
	label: string;
	description: string;
	buttonLabel: string;
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
						: `No ${label} uploaded yet.`}
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
	const [includeAlignedImage, setIncludeAlignedImage] = useState(false);
	const [isExporting, setIsExporting] = useState(false);
	const [isEditingProjectName, setIsEditingProjectName] = useState(false);
	const [projectNameDraft, setProjectNameDraft] = useState("");
	const [focusedHeMovingImage, setFocusedHeMovingImage] =
		useState<PreprocessSourceImage | null>(null);
	const [tissueTool, setTissueTool] = useState<TissueTool>("activate");
	const [isDetectingTissue, setIsDetectingTissue] = useState(false);
	const tissueDetectionRequestTokenRef = useRef(0);

	useEffect(() => () => {
		if (focusedHeMovingImage?.thumbnailObjectUrl) {
			URL.revokeObjectURL(focusedHeMovingImage.thumbnailObjectUrl);
		}
	}, [focusedHeMovingImage]);

	const localizationImage = project
		? (project.sourceAssets.images[project.localization.targetImage] ?? null)
		: null;
	const currentHeImageSource = project
		? (project.sourceAssets.images[project.heFocus.targetImage] ?? null)
		: null;
	const heFocusImageSource = project?.heFocus.focusedImageDataUrl ?? null;
	const alignmentReferenceImage = project
		? (project.sourceAssets.images[project.alignment.referenceImage] ?? null)
		: null;
	const alignmentMovingImage = project
		? project.alignment.movingImage === "he" &&
			  project.heFocus.status === "complete"
				? focusedHeMovingImage
				: (project.sourceAssets.images[project.alignment.movingImage] ?? null)
		: null;
	const localizationImageDataUrl = localizationImage?.dataUrl ?? null;
	const currentHeImageDataUrl = currentHeImageSource?.dataUrl ?? null;
	const focusedHeImageDataUrl = project?.heFocus.focusedImageDataUrl ?? null;
	const alignmentMovingImageKind = project?.alignment.movingImage ?? null;
	const currentStepId = project?.currentStep ?? null;
	const hasLocalizationChipBounds = Boolean(project?.localization.chipBounds);
	const hasHeFocusChipBounds = Boolean(project?.heFocus.chipBounds);
	const tissueAutoDetectionImageArgs = resolveTissueAutoDetectionImageArgs(project);
	const exportReadiness = project
		? getPreprocessZipExportReadiness(project)
		: { canExport: false as const, reason: "Project unavailable." };

	const applyLocalizationUpdate = useCallback(
		(
			updater: (current: LocalizationSlice) => LocalizationSlice,
			options?: { invalidateDownstream?: boolean },
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
			});
		},
		[onProjectMutate],
	);

	const applyHeFocusUpdate = useCallback(
		(
			updater: (current: HeFocusSlice) => HeFocusSlice,
			options?: {
				invalidateDownstream?: boolean;
				preserveFocusedImage?: boolean;
			},
		) => {
			onProjectMutate((current) => {
				const currentImage = current.sourceAssets.images[current.heFocus.targetImage];
				const imageAspectRatio =
					currentImage?.width && currentImage.height
						? currentImage.width / currentImage.height
						: 1;
				const nextHeFocusBase = normalizeHeFocusSlice(
					updater(current.heFocus),
					imageAspectRatio,
				);
				const nextHasImage = Boolean(currentImage?.dataUrl);
				const nextHeFocus: HeFocusSlice = {
					...nextHeFocusBase,
					focusedImageDataUrl: options?.preserveFocusedImage
						? (nextHeFocusBase.focusedImageDataUrl ?? current.heFocus.focusedImageDataUrl ?? null)
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
					: invalidateOnHeFocusChange(nextProject);
			});
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
					title: "Eosin image loaded",
					description:
						"The image is ready for localization and downstream preprocess steps were invalidated.",
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
					title: "H&E image loaded",
					description:
						"Landmark alignment can now target this image and downstream preprocess steps were invalidated.",
					status: "success",
				});
			} catch (error) {
				console.error(error);
				toast({
					title: "Unable to load H&E image",
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
		if (!project) return;
		if (project.heFocus.status !== "complete") return;
		if (project.heFocus.focusedImageDataUrl) return;

		const sourceHeDataUrl = currentHeImageSource?.dataUrl;
		const focusedChipBounds = project.heFocus.chipBounds;
		if (!focusedChipBounds || !sourceHeDataUrl) {
			return;
		}

		let cancelled = false;

		void (async () => {
			try {
				const focusedImageDataUrl = await generateFocusedHeDataUrl({
					sourceDataUrl: sourceHeDataUrl,
					chipBounds: focusedChipBounds,
					imageTransform: project.heFocus.imageTransform,
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
		currentHeImageSource,
		currentHeImageSource?.dataUrl,
		project?.heFocus.chipBounds,
		project?.heFocus.focusedImageDataUrl,
		project?.heFocus.imageTransform,
		project?.heFocus.status,
		onProjectMutate,
		project,
	]);

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
	}, [alignmentMovingImageKind, currentHeImageSource, focusedHeImageDataUrl]);


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
			const currentImage = current.sourceAssets.images[current.heFocus.targetImage];
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

			return invalidateOnHeFocusChange({
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
		if (
			!alignmentReferenceImage?.dataUrl ||
			!alignmentMovingImage?.dataUrl ||
			!project.localization.chipBounds ||
			!project.alignment.affineMatrix
		) {
			toast({
				title: "Crop prerequisites missing",
				description:
					"Alignment and localization must be completed before crop/QC.",
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
				imageTransform: project.localization.imageTransform,
				affineMatrix: project.alignment.affineMatrix,
				controlPoints: project.alignment.controlPoints,
				solveAccepted: project.alignment.solveAccepted,
				inlierMask: project.alignment.inlierMask,
			});

			applyCropQcUpdate(
				(current) => ({
					...current,
					cropRect: result.cropRect,
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
					previewDataUrl: result.cropAssets.he.fullres.dataUrl,
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
					error: error instanceof Error ? error.message : "Crop/QC failed",
				}),
				{ invalidateDownstream: false },
			);
			toast({
				title: "Crop/QC failed",
				description:
					error instanceof Error
						? error.message
						: "Unable to generate crop previews.",
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

	const handleLocalizationRotationChange = useCallback(
		(value: number) => {
			applyLocalizationUpdate((current) => ({
				...current,
				imageTransform: {
					...current.imageTransform,
					rotationDegrees: normalizeLocalizationRotationDegrees(value),
				},
			}));
		},
		[applyLocalizationUpdate],
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
		const projectedSpots = project.chipConfig.projectedSpots;
		if (
			tissueSupport.supportState === "unsupported"
			|| !tissueAutoDetectionImageArgs
			|| !projectedSpots
			|| !project.chipConfig.rows
			|| !project.chipConfig.columns
		) {
			return;
		}

		const requestToken = tissueDetectionRequestTokenRef.current + 1;
		tissueDetectionRequestTokenRef.current = requestToken;
		const snapshot = buildTissueDetectionSnapshot({
			project,
			tissueImageArgs: tissueAutoDetectionImageArgs,
			projectedSpots,
		});
		setIsDetectingTissue(true);
		onProjectMutate((current) => ({
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
		}), { mode: "metadata" });

		try {
			const result = await runTissueAutoSelection({
				...tissueAutoDetectionImageArgs,
				matrixRows: project.chipConfig.rows,
				matrixColumns: project.chipConfig.columns,
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

			onProjectMutate((current) => {
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
			}, { mode: "metadata" });
		} catch (error) {
			if (tissueDetectionRequestTokenRef.current !== requestToken) {
				return;
			}
			const message =
				error instanceof Error
					? error.message
					: "Failed to run auto detection";
			onProjectMutate((current) => {
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
			}, { mode: "metadata" });
		} finally {
			if (tissueDetectionRequestTokenRef.current === requestToken) {
				setIsDetectingTissue(false);
			}
		}
	}, [onProjectMutate, project, tissueAutoDetectionImageArgs, tissueSupport]);

	const currentCopy = project
		? placeholderCopyByStep[project.currentStep]
		: placeholderCopyByStep.sourceAssets;
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
	}, [
		project,
		tissueProjectedSpots,
	]);
	const isTissueInteractionDisabled =
		isDetectingTissue || tissueSupport.supportState === "unsupported";

	useEffect(() => {
		if (!project || isEditingProjectName) return;
		setProjectNameDraft(project.name);
	}, [isEditingProjectName, project]);

	const commitProjectNameDraft = useCallback(() => {
		const nextName = projectNameDraft.trim();
		onProjectNameChange(
			nextName || project?.name || "Untitled preprocess project",
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
				<Heading size="md">Loading preprocess project…</Heading>
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
						<Heading size="md">Unable to open preprocess workspace</Heading>
						<Text color="gray.600">
							{loadError ?? "Project not found in this browser."}
						</Text>
						<Button
							onClick={onBackToLanding}
							colorScheme="brand"
							alignSelf="flex-start"
						>
							Back to preprocess projects
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
								← Back to preprocess projects
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

				<Flex direction={{ base: "column", lg: "row" }} gap={6} align="stretch">
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
										<SourceAssetUploader
											label="Eosin source image"
											description="This intake image drives chip localization and remains the localization target by default when replaced."
											buttonLabel={
												project.sourceAssets.images.eosin
													? "Replace eosin image"
													: "Upload eosin image"
											}
											image={project.sourceAssets.images.eosin}
											onUpload={(fileList) => {
												void handleUploadEosin(fileList);
											}}
										/>
										<SourceAssetUploader
											label="H&E source image"
											description="This intake image feeds landmark alignment while preserving the existing browser-only source asset storage."
											buttonLabel={
												project.sourceAssets.images.he
													? "Replace H&E image"
													: "Upload H&E image"
											}
											image={project.sourceAssets.images.he}
											onUpload={(fileList) => {
												void handleUploadHe(fileList);
											}}
										/>
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
									chipBounds={project.localization.chipBounds}
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
											{ invalidateDownstream: false },
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
											{ invalidateDownstream: false },
										);
									}}
									onRotationChange={handleLocalizationRotationChange}
									onRotationDelta={(delta) => {
										applyLocalizationUpdate((current) => ({
											...current,
											imageTransform: {
												...current.imageTransform,
												rotationDegrees: normalizeLocalizationRotationDegrees(
													current.imageTransform.rotationDegrees + delta,
												),
											},
										}));
									}}
									onFlipHorizontal={() => {
										applyLocalizationUpdate((current) => ({
											...current,
											imageTransform: {
												...current.imageTransform,
												flipHorizontal: !current.imageTransform.flipHorizontal,
											},
										}));
									}}
									onFlipVertical={() => {
										applyLocalizationUpdate((current) => ({
											...current,
											imageTransform: {
												...current.imageTransform,
												flipVertical: !current.imageTransform.flipVertical,
											},
										}));
									}}
									onResetTransform={() => {
										applyLocalizationUpdate((current) => ({
											...current,
											imageTransform: DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
										}));
									}}
																					onChipBoundsChange={(chipBounds) => {
																						applyLocalizationUpdate((current) => ({
																							...current,
																							chipBounds,
																							method: "manual",
																						}));
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
																	boxColor="green"
																	chipBounds={project.heFocus.chipBounds}
																	containerTestId="preprocess-he-focus-canvas-column"
																	controlTestIdPrefix="he-focus"
																	image={currentHeImageSource}
																	imageTransform={project.heFocus.imageTransform}
																	labels={{
																		badgeReady: "H&E preview ready",
																		badgeWaiting: "Awaiting H&E image",
																		description:
																			"Adjust the square H&E working region and orientation before alignment.",
																		emptyDescription:
																			"Upload the H&E source image in Source before defining the focus region.",
																		emptyTitle: "No H&E image loaded",
																		heading: "H&E focus canvas",
																		overlayAriaLabel: "H&E focus overlay",
																		resetAriaLabel: "Reset H&E focus transform",
																		savedHint:
																			"Saved focus bounds stay square and normalized in original H&E image coordinates.",
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
														preserveFocusedImage: true,
													},
												);
											}}
																	onRotationChange={(value) => {
																		applyHeFocusUpdate((current) => ({
																			...current,
																			imageTransform: {
																				...current.imageTransform,
																				rotationDegrees: normalizeLocalizationRotationDegrees(
																					value,
																				),
																			},
																		}));
																	}}
																	onRotationDelta={(delta) => {
																		applyHeFocusUpdate((current) => ({
																			...current,
																			imageTransform: {
																				...current.imageTransform,
																				rotationDegrees: normalizeLocalizationRotationDegrees(
																					current.imageTransform.rotationDegrees + delta,
																				),
																			},
																		}));
																	}}
																	onFlipHorizontal={() => {
																		applyHeFocusUpdate((current) => ({
																			...current,
																			imageTransform: {
																				...current.imageTransform,
																				flipHorizontal: !current.imageTransform.flipHorizontal,
																			},
																		}));
																	}}
																	onFlipVertical={() => {
																		applyHeFocusUpdate((current) => ({
																			...current,
																			imageTransform: {
																				...current.imageTransform,
																				flipVertical: !current.imageTransform.flipVertical,
																			},
																		}));
																	}}
																	onResetTransform={() => {
																		applyHeFocusUpdate((current) => ({
																			...current,
																			imageTransform: DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
																		}));
																	}}
																	onChipBoundsChange={(chipBounds) => {
																		applyHeFocusUpdate((current) => ({
																			...current,
																			chipBounds,
																		}));
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
													data-testid="he-focus-focused-image-card"
												>
													<Stack spacing={3}>
														<Heading size="sm">Saved focused H&amp;E preview</Heading>
									{heFocusImageSource ? (
										<Image
											src={heFocusImageSource}
											alt="Saved focused H&E preview"
											data-testid="he-focus-focused-image-preview"
											borderRadius="lg"
											border="1px solid"
											borderColor="gray.200"
																objectFit="contain"
																bg="white"
																maxH="280px"
																w="100%"
															/>
														) : (
															<Text fontSize="sm" color="gray.600">
																No saved focused H&amp;E preview yet.
															</Text>
														)}
													</Stack>
												</Box>
															</Flex>
														</Stack>
													) : project.currentStep === "alignment" ? (
								<AlignmentPanel
									alignment={project.alignment}
									chipBounds={project.localization.chipBounds}
									movingImage={alignmentMovingImage}
									onSolveAccepted={() => {
										onStepChange("cropQc");
									}}
									referenceImage={alignmentReferenceImage}
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
										project.cropQc.featureMatchesPreviewDataUrl
										?? project.cropQc.featureMatchesPreview?.dataUrl
										?? null
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
							alignmentReferenceImage?.dataUrl &&
							alignmentMovingImage?.dataUrl,
					)}
					canAccept={Boolean(
						project.cropQc.cropWidth && project.cropQc.cropHeight,
					)}
				/>
							) : project.currentStep === "chipConfig" || project.currentStep === "tissueSelection" ? (
								<Box position="relative">
									<Flex direction={{ base: "column", xl: "row" }} gap={5} align="stretch">
										<Box flex="1" minW={0}>
							<TissueSelectionPanel
								eosinCropDataUrl={project.cropQc.cropAssets?.eosin?.lowres.dataUrl ?? null}
								projectedSpots={tissueProjectedSpots}
								selectedSpotIds={tissueSelectedSpotIds}
								showControls={false}
								tool={tissueTool}
								disabled={isTissueInteractionDisabled}
								onToolChange={setTissueTool}
								onEditCommit={(editArea) => {
									onProjectMutate((current) => {
										const projectedSpots = current.chipConfig.projectedSpots ?? [];
										const updatedAt = new Date().toISOString();
										return {
											...current,
											tissueSelection: buildManualTissueSelectionState({
												current: current.tissueSelection,
												projectedSpots,
												editArea,
												nextValue: tissueTool === "activate" ? 1 : 0,
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
									}, { mode: "metadata", strategy: "debounced" });
								}}
							/>

										</Box>
										<Stack w={{ base: "100%", xl: "320px" }} spacing={4} flexShrink={0}>
											<Card border="1px solid" borderColor="gray.200" borderRadius="2xl" boxShadow="sm" bg="white">
												<CardBody p={4}>
													<Stack spacing={3}>
														<Text fontSize="sm" fontWeight="semibold">Chip size</Text>
														<FormControl isDisabled={isTissueInteractionDisabled}>
															<FormLabel fontSize="xs" color="gray.500" mb={1.5}>Capture pitch</FormLabel>
															<Select
																value={project.chipConfig.chipType ?? ""}
																placeholder="Select chip size"
																data-testid="tissue-chip-size-select"
																onChange={(event) => {
																	const chipId = event.target.value;
																	if (chipId !== "15um" && chipId !== "50um") return;
																	if (!project.cropQc.cropWidth || !project.cropQc.cropHeight) return;
																	const cropWidth = project.cropQc.cropWidth;
																	const cropHeight = project.cropQc.cropHeight;
																	void (async () => {
																		try {
																			setChipConfigError(null);
																			const config = await loadChipConfigData(chipId);
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
													const timestamp = new Date().toISOString();

													onProjectMutate((current) => ({
														...current,
														cropQc: {
															...current.cropQc,
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
												tissueSelection: {
													...current.tissueSelection,
													supportState: tissueSupport.supportState,
													unsupportedReason: tissueSupport.unsupportedReason,
													matrix: null,
													autoSelectedSpotIds: [],
													selectedSpotIds: [],
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
																			}));
																		} catch (error) {
																			const message =
																				error instanceof Error
																					? error.message
																					: "Failed to load chip config";
																			setChipConfigError(message);
																			onProjectMutate((current) => ({
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
													supportState: tissueSupport.supportState,
													unsupportedReason: tissueSupport.unsupportedReason,
													matrix: null,
													autoSelectedSpotIds: [],
													selectedSpotIds: [],
													paritySummary: null,
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
																			}));
																		}
																	})();
																}}
															>
																<option value="15um">15um</option>
																<option value="50um">50um</option>
															</Select>
														</FormControl>
														<Text fontSize="xs" color="gray.500">
															Changing chip size clears previous tissue edits, regenerates projected spots, and requires you to rerun auto detection manually.
														</Text>
														{chipConfigError ?? project.chipConfig.error ? (
															<Text fontSize="sm" color="red.600">{chipConfigError ?? project.chipConfig.error}</Text>
														) : null}
													</Stack>
												</CardBody>
											</Card>

											<TissueSelectionControls
												thresholdMode={project.tissueSelection.thresholdMode}
												supportState={tissueSupport.supportState}
												unsupportedReason={tissueSupport.unsupportedReason}
												isDetecting={isDetectingTissue}
												tissueTool={tissueTool}
												onThresholdModeChange={(thresholdMode) => {
													onProjectMutate((current) => {
														const nextSupport = resolveTissueSelectionSupport({
															chipType: current.chipConfig.chipType,
															rows: current.chipConfig.rows,
															columns: current.chipConfig.columns,
														});

														return {
															...current,
															tissueSelection: {
																...current.tissueSelection,
																thresholdMode,
																supportState: nextSupport.supportState,
																unsupportedReason: nextSupport.unsupportedReason,
																status: "ready",
																warning: null,
																isStale: false,
																updatedAt: new Date().toISOString(),
															},
															exportState: {
																...current.exportState,
																status: "stale",
																isStale: true,
																updatedAt: new Date().toISOString(),
															},
														};
													}, { mode: "metadata", strategy: "debounced" });
												}}
												onTissueToolChange={setTissueTool}
												onRunAutoDetection={() => {
													void runTissueAutoDetection();
												}}
											/>


											<Card border="1px solid" borderColor="gray.200" borderRadius="2xl" boxShadow="sm" bg="white">
												<CardBody p={4}>
													<Stack spacing={1}>
														<Text fontSize="sm" color="gray.600" data-testid="tissue-selected-count">
															Selected spots: {tissueSelectedSpotIds.length}
														</Text>
														{project.tissueSelection.warning ? (
															<Text fontSize="sm" color="orange.700" data-testid="tissue-detection-warning">
																{project.tissueSelection.warning}
															</Text>
														) : (
															<Text fontSize="sm" color="gray.500" data-testid="tissue-detection-status">
																{isDetectingTissue
																	? "Auto detection is running. Canvas editing is temporarily locked."
																	: project.tissueSelection.status === "complete"
																		? "Auto detection ready. Activate or deactivate spots directly on the matrix-backed canvas."
																		: "Choose a threshold mode and run auto detection to refresh the tissue matrix."}
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
												<Text fontSize="sm" fontWeight="semibold" color="gray.700">
													Detecting tissue spots…
												</Text>
												<Text fontSize="xs" color="gray.500">
													Canvas editing is paused until this run finishes.
												</Text>
											</Stack>
										</Flex>
									) : null}
								</Box>

							) : project.currentStep === "exportState" ? (
							<ExportPanel
								includeProject={includeProjectJson}
								includeAlignedImage={includeAlignedImage}
								onToggleIncludeProject={setIncludeProjectJson}
								onToggleIncludeAlignedImage={setIncludeAlignedImage}
								isExporting={isExporting}
								canExport={exportReadiness.canExport}
								onDownload={() => {
									const currentExportReadiness = getPreprocessZipExportReadiness(project);
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
