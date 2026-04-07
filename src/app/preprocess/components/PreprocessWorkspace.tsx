"use client";

import {
	Badge,
	Box,
	Button,
	Flex,
	Heading,
	HStack,
	Input,
	Spinner,
	Stack,
	Text,
	useToast,
} from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { normalizeAlignmentSlice } from "@/lib/preprocess/alignment";
import {
	type ChipConfigManifest,
	loadAllChipConfigManifests,
	loadChipConfigData,
} from "@/lib/preprocess/chipConfigs";
import { runCropQc } from "@/lib/preprocess/cropQc";
import { exportPreprocessZip } from "@/lib/preprocess/exportBundle";
import {
	invalidateOnAlignmentChange,
	invalidateOnCropQcChange,
	invalidateOnLocalizationChange,
	invalidateOnSourceAssetsChange,
} from "@/lib/preprocess/invalidation";
import { loadOpenCv } from "@/lib/preprocess/loadOpenCv";
import {
	computeLocalizationStatus,
	createDefaultChipBounds,
	DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
	normalizeLocalizationSlice,
} from "@/lib/preprocess/localization";
import { buildSourceImage } from "@/lib/preprocess/sourceImage";
import { applySpotOverrides } from "@/lib/preprocess/spotOverrides";
import { projectSpotsForCrop } from "@/lib/preprocess/spotProjection";
import { runTissueAutoSelection } from "@/lib/preprocess/tissuePipeline";
import {
	buildSelectedCountSummary,
	deriveSelectedSpotIdsFromRegions,
} from "@/lib/preprocess/tissueRegions";
import type {
	AlignmentSlice,
	CropQcSlice,
	LocalizationBoxColor,
	LocalizationSlice,
	PreprocessProject,
	PreprocessStepId,
} from "@/types/preprocess";
import { AlignmentPanel } from "./AlignmentPanel";
import { CanvasStage } from "./CanvasStage";
import { ChipConfigPanel } from "./ChipConfigPanel";
import { CropQcPanel } from "./CropQcPanel";
import { ExportPanel } from "./ExportPanel";
import { PREPROCESS_STEP_ITEMS, StepSidebar } from "./StepSidebar";
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

const normalizeLocalizationRotationDegrees = (value: number) => {
	const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
	return Object.is(wrapped, -0) ? 0 : wrapped;
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

	const localizationImage = project
		? (project.sourceAssets.images[project.localization.targetImage] ?? null)
		: null;
	const alignmentReferenceImage = project
		? (project.sourceAssets.images[project.alignment.referenceImage] ?? null)
		: null;
	const alignmentMovingImage = project
		? (project.sourceAssets.images[project.alignment.movingImage] ?? null)
		: null;
	const localizationImageDataUrl = localizationImage?.dataUrl ?? null;
	const currentStepId = project?.currentStep ?? null;
	const hasLocalizationChipBounds = Boolean(project?.localization.chipBounds);

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

				return options?.invalidateDownstream === false
					? nextProject
					: invalidateOnCropQcChange(nextProject);
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
			});

			applyCropQcUpdate(
				(current) => ({
					...current,
					cropRect: result.cropRect,
					cropWidth: result.cropWidth,
					cropHeight: result.cropHeight,
					checkerboardTileSize: 64,
					qcAccepted: false,
					status: "ready",
					issues: [],
					eosinPreviewDataUrl: result.eosinCropDataUrl,
					previewDataUrl: result.heWarpedCropDataUrl,
					checkerboardPreviewDataUrl: result.checkerboardDataUrl,
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
		if (!project || project.currentStep !== "chipConfig") return;
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

	const currentStepMeta = project
		? (PREPROCESS_STEP_ITEMS.find((step) => step.id === project.currentStep) ??
			PREPROCESS_STEP_ITEMS[0])
		: PREPROCESS_STEP_ITEMS[0];
	const currentCopy = project
		? placeholderCopyByStep[project.currentStep]
		: placeholderCopyByStep.sourceAssets;

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
							<Flex
								justify="space-between"
								align={{ base: "stretch", md: "center" }}
								gap={4}
								wrap="wrap"
							>
								<Stack spacing={1}>
									<Badge colorScheme="brand" alignSelf="flex-start">
										{currentStepMeta.label}
									</Badge>
									<Heading size="md">{currentCopy.title}</Heading>
								</Stack>
							</Flex>

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
							) : project.currentStep === "alignment" ? (
							<AlignmentPanel
								alignment={project.alignment}
								chipBounds={project.localization.chipBounds}
								movingImage={alignmentMovingImage}
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
									overlayOpacity={project.cropQc.overlayOpacity}
									onOverlayOpacityChange={(value) => {
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
										applyCropQcUpdate((current) => ({
											...current,
											qcAccepted: true,
											status: "complete",
											error: null,
										}));
									}}
									onRejectToAlign={() => {
										onStepChange("alignment");
										applyCropQcUpdate((current) => ({
											...current,
											qcAccepted: false,
											status: "stale",
										}));
									}}
									canRun={project.alignment.status === "complete"}
									canAccept={Boolean(
										project.cropQc.cropWidth && project.cropQc.cropHeight,
									)}
								/>
							) : project.currentStep === "chipConfig" ? (
								<ChipConfigPanel
									manifests={chipManifests}
									selectedChip={project.chipConfig.chipType}
									projectedSpots={project.chipConfig.projectedSpots}
									eosinCropDataUrl={project.cropQc.eosinPreviewDataUrl}
									error={chipConfigError ?? project.chipConfig.error}
									onSelectChip={(chipId) => {
										if (!project.cropQc.cropWidth || !project.cropQc.cropHeight)
											return;
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

												onProjectMutate((current) => ({
													...current,
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
														updatedAt: new Date().toISOString(),
														error: null,
													},
													tissueSelection: {
														...current.tissueSelection,
														forcedInSpotIds: [],
														forcedOutSpotIds: [],
														regions: [],
														selectedRegionId: null,
														overrideNotice:
															current.tissueSelection.forcedInSpotIds.length >
																0 ||
															current.tissueSelection.forcedOutSpotIds.length >
																0 ||
															current.tissueSelection.regions.length > 0
																? "Overrides cleared due to geometry change."
																: null,
														autoSelectedSpotIds: [],
														selectedSpotIds: [],
														paritySummary: null,
														status: "ready",
														isStale: false,
														updatedAt: new Date().toISOString(),
														error: null,
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
												}));
											}
										})();
									}}
								/>
							) : project.currentStep === "tissueSelection" ? (
								<Stack spacing={4}>
									<HStack spacing={3} align="center">
										<Text fontSize="sm" color="gray.600">
											Activation threshold
										</Text>
										<Input
											width="120px"
											type="number"
											min={0}
											max={255}
											step={1}
											value={project.tissueSelection.activationThreshold}
											data-testid="tissue-activation-threshold"
											onChange={(event) => {
												const next = Number(event.target.value);
												onProjectMutate((current) => ({
													...current,
													tissueSelection: {
														...current.tissueSelection,
														activationThreshold: Number.isFinite(next)
															? next
															: current.tissueSelection.activationThreshold,
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
												}));
											}}
										/>
										<Button
											data-testid="tissue-run-auto"
											colorScheme="brand"
											onClick={() => {
												if (
													!project.cropQc.eosinPreviewDataUrl ||
													!project.chipConfig.projectedSpots
												)
													return;
												const eosinCropDataUrl =
													project.cropQc.eosinPreviewDataUrl;
												const projectedSpots =
													project.chipConfig.projectedSpots;
												void (async () => {
													const result = await runTissueAutoSelection({
														eosinCropDataUrl,
														projectedSpots,
														params: {
															thresholdMode:
																project.tissueSelection.thresholdMode,
															activationThreshold:
																project.tissueSelection.activationThreshold,
															blockThreshold:
																project.tissueSelection.blockThreshold,
															dbscanEps: project.tissueSelection.dbscanEps,
															dbscanMinSamples:
																project.tissueSelection.dbscanMinSamples,
															minConnectedSpotCount:
																project.tissueSelection.minConnectedSpotCount,
														},
													});

													onProjectMutate((current) => {
														const hasRegions =
															current.tissueSelection.regions.length > 0;
														const finalSelectedSpotIds = hasRegions
															? deriveSelectedSpotIdsFromRegions(
																	current.tissueSelection.regions,
																	projectedSpots,
																)
															: applySpotOverrides({
																	autoSelected: result.selectedIds,
																	forcedIn:
																		current.tissueSelection.forcedInSpotIds,
																	forcedOut:
																		current.tissueSelection.forcedOutSpotIds,
																});
														const paritySummary = buildSelectedCountSummary(
															finalSelectedSpotIds,
															projectedSpots.length,
														);

														return {
															...current,
															tissueSelection: {
																...current.tissueSelection,
																thresholdMode: result.params.thresholdMode,
																activationThreshold:
																	result.params.activationThreshold,
																blockThreshold: result.params.blockThreshold,
																dbscanEps: result.params.dbscanEps,
																dbscanMinSamples:
																	result.params.dbscanMinSamples,
																minConnectedSpotCount:
																	result.params.minConnectedSpotCount,
																autoSelectedSpotIds: result.selectedIds,
																selectedSpotIds: finalSelectedSpotIds,
																paritySummary,
																warning: hasRegions ? null : result.warning,
																status: hasRegions
																	? "complete"
																	: result.warning
																		? "error"
																		: "complete",
																isStale: false,
																updatedAt: new Date().toISOString(),
																error: hasRegions ? null : result.warning,
															},
															exportState: {
																...current.exportState,
																status: hasRegions
																	? "stale"
																	: result.warning
																		? "stale"
																		: "ready",
																isStale: hasRegions || Boolean(result.warning),
																updatedAt: new Date().toISOString(),
																lastExportedAt: null,
																artifacts: [],
																error: null,
															},
														};
													});
												})();
											}}
										>
											Run auto-selection
										</Button>
									</HStack>

									<HStack justify="space-between">
										<Text color="gray.600">Selected spots</Text>
										<Text
											data-testid="tissue-selected-count"
											fontWeight="semibold"
										>
											{project.tissueSelection.paritySummary?.selectedCount ??
												0}
										</Text>
									</HStack>
									<HStack justify="space-between">
										<Text color="gray.600">Selected percent</Text>
										<Text
											data-testid="tissue-selected-percent"
											fontWeight="semibold"
										>
											{project.tissueSelection.paritySummary?.selectedPercent.toFixed(
												2,
											) ?? "0.00"}
										</Text>
									</HStack>
									<Box
										as="pre"
										fontSize="xs"
										color="gray.700"
										bg="gray.50"
										borderRadius="md"
										p={2}
										data-testid="tissue-parity-json"
									>
										{JSON.stringify(
											{
												thresholdMode: project.tissueSelection.thresholdMode,
												activationThreshold:
													project.tissueSelection.activationThreshold,
												blockThreshold: project.tissueSelection.blockThreshold,
												dbscanEps: project.tissueSelection.dbscanEps,
												dbscanMinSamples:
													project.tissueSelection.dbscanMinSamples,
												minConnectedSpotCount:
													project.tissueSelection.minConnectedSpotCount,
												summary: project.tissueSelection.paritySummary,
											},
											null,
											2,
										)}
									</Box>
									{project.tissueSelection.warning ? (
										<Text color="orange.700">
											{project.tissueSelection.warning}
										</Text>
									) : null}
									{project.tissueSelection.overrideNotice ? (
										<Text color="orange.700">
											{project.tissueSelection.overrideNotice}
										</Text>
									) : null}

									<TissueSelectionPanel
										eosinCropDataUrl={project.cropQc.eosinPreviewDataUrl}
										projectedSpots={project.chipConfig.projectedSpots ?? []}
										selectedSpotIds={(() => {
											const regions = project.tissueSelection.regions;
											const projectedSpots =
												project.chipConfig.projectedSpots ?? [];
											if (regions.length > 0) {
												return deriveSelectedSpotIdsFromRegions(
													regions,
													projectedSpots,
												);
											}
											return project.tissueSelection.autoSelectedSpotIds;
										})()}
										regions={project.tissueSelection.regions}
										selectedRegionId={project.tissueSelection.selectedRegionId}
										onRegionsChange={(nextRegions) => {
											onProjectMutate((current) => {
												const projectedSpots =
													current.chipConfig.projectedSpots ?? [];
												const finalSelectedSpotIds =
													nextRegions.length > 0
														? deriveSelectedSpotIdsFromRegions(
																nextRegions,
																projectedSpots,
															)
														: current.tissueSelection.autoSelectedSpotIds;
												const totalSpots = projectedSpots.length;
												const paritySummary = buildSelectedCountSummary(
													finalSelectedSpotIds,
													totalSpots,
												);
												return {
													...current,
													tissueSelection: {
														...current.tissueSelection,
														mode: "polygon",
														regions: nextRegions,
														selectedSpotIds: finalSelectedSpotIds,
														paritySummary,
														overrideNotice: null,
														status: "complete",
														isStale: false,
														updatedAt: new Date().toISOString(),
														warning: null,
														error: null,
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
										}}
										onSelectedRegionIdChange={(id) => {
											onProjectMutate((current) => ({
												...current,
												tissueSelection: {
													...current.tissueSelection,
													selectedRegionId: id,
												},
											}));
										}}
									/>
								</Stack>
							) : project.currentStep === "exportState" ? (
								<ExportPanel
									includeProject={includeProjectJson}
									includeAlignedImage={includeAlignedImage}
									onToggleIncludeProject={setIncludeProjectJson}
									onToggleIncludeAlignedImage={setIncludeAlignedImage}
									isExporting={isExporting}
									canExport={project.tissueSelection.status === "complete"}
									onDownload={() => {
										if (project.tissueSelection.status !== "complete") return;
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
