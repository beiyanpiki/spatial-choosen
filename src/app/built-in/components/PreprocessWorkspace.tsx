"use client";

import {
	Badge,
	Box,
	Button,
	Card,
	CardBody,
	Flex,
	Heading,
	HStack,
	Input,
	Spinner,
	Stack,
	Text,
	useToast,
} from "@chakra-ui/react";
import {
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import type {
	ChipPlacement,
	PreprocessProject,
	PreprocessSourceImage,
	PreprocessStepId,
} from "@/types/built-in";
import { loadChipConfigManifest } from "@/lib/built-in/chipConfigs";
import { exportBuiltInZip, getBuiltInZipExportReadiness } from "@/lib/built-in/exportBundle";
import { buildNormalizedExpressionById } from "@/lib/built-in/expressionColors";
import { invalidateOnSourceAssetsChange } from "@/lib/built-in/invalidation";
import { parseTissueActivationCsv } from "@/lib/built-in/tissueCsvImport";
import { buildImportedTissueSelectionState } from "@/lib/built-in/projectUpdates";
import { buildSourceImage } from "@/lib/built-in/sourceImage";
import { projectSpotsForPlacement } from "@/lib/built-in/spotProjection";
import type { PreprocessPersistMode } from "@/lib/built-in/storage";
import { selectedSpotIdsFromMatrix } from "@/lib/built-in/tissueMatrix";
import { resolveTissueSelectionSupport } from "@/lib/built-in/tissueSupport";
import { ExportPanel } from "./ExportPanel";
import { StepSidebar } from "./StepSidebar";
import { TissueSelectionControls } from "./TissueSelectionControls";
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

const placeholderCopyByStep: Record<
	PreprocessStepId,
	{ title: string; body: string }
> = {
	sourceAssets: {
		title: "Source image intake",
		body: "Upload the full-resolution H&E stained tissue image and a tissue activation CSV. The CSV provides the chip size and per-spot activation state. All processing on this page is saved locally.",
	},
	tissueSelection: {
		title: "Tissue spot selection",
		body: "Refine the imported tissue spot matrix over the H&E image. Mark spots as tissue or background, or invert the whole selection.",
	},
	exportState: {
		title: "Export package",
		body: "Download the tissue image pyramid, scalefactors, spot positions, and tissue matrix for downstream analysis.",
	},
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
	image: PreprocessSourceImage | null;
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

function TissueCsvUploader({
	label,
	description,
	buttonLabel,
	emptyText,
	imported,
	summary,
	onUpload,
}: {
	label: string;
	description: string;
	buttonLabel: string;
	emptyText: string;
	imported: boolean;
	summary: string | null;
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
						colorScheme={imported ? "green" : "orange"}
						alignSelf="flex-start"
						borderRadius="full"
					>
						{imported ? "Ready" : "Missing"}
					</Badge>
				</Flex>
				<Text fontSize="sm" color="gray.600">
					{imported && summary ? summary : emptyText}
				</Text>
				<Box>
					<Button
						colorScheme="brand"
						variant={imported ? "outline" : "solid"}
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
						accept=".csv,text/csv"
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

const centeredPlacement = (
	heWidth: number,
	heHeight: number,
	rows: number,
	columns: number,
	spotDiameter: number,
	spotGap: number,
): ChipPlacement => {
	const fullW = columns * spotDiameter + (columns + 1) * spotGap;
	const fullH = rows * spotDiameter + (rows + 1) * spotGap;
	const scale = (Math.min(heWidth, heHeight) * 0.9) / Math.max(fullW, fullH);
	return {
		scale,
		x: (heWidth - scale * fullW) / 2,
		y: (heHeight - scale * fullH) / 2,
	};
};

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
	const [isEditingProjectName, setIsEditingProjectName] = useState(false);
	const [projectNameDraft, setProjectNameDraft] = useState("");
	const [showTissueSpots, setShowTissueSpots] = useState(true);
	const [tissueDisplayMode, setTissueDisplayMode] = useState<"tissue" | "heatmap">("tissue");
	const [isExporting, setIsExporting] = useState(false);

	const handleUploadHe = useCallback(
		async (fileList: FileList | null) => {
			const file = fileList?.[0];
			if (!file) return;

			try {
				const he = await buildSourceImage(file, "he");

				onProjectMutate((current) => {
					const timestamp = new Date().toISOString();
					// Replace the HE image and reset the chip placement so the
					// default-placement effect re-centers the grid on the new image.
					return invalidateOnSourceAssetsChange({
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
						chipConfig: {
							...current.chipConfig,
							placement: null,
						},
					});
				});

				toast({
					title: "HE image loaded",
					description:
						"The chip grid will be projected onto this image. Refine tissue selection on the Tissue step.",
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

	const handleUploadCsv = useCallback(
		async (fileList: FileList | null) => {
			const file = fileList?.[0];
			if (!file) return;

			try {
				const csvText = await file.text();
				const parsed = parseTissueActivationCsv(csvText);
				const manifest = await loadChipConfigManifest(parsed.chipType);
				const activeSpotCount = parsed.matrix.values.reduce<number>(
					(count, value) => (value === 1 ? count + 1 : count),
					0,
				);

				onProjectMutate((current) => {
					const timestamp = new Date().toISOString();
					const support = resolveTissueSelectionSupport({
						chipType: parsed.chipType,
						rows: parsed.rows,
						columns: parsed.columns,
					});
					const tissueSelection = buildImportedTissueSelectionState({
						current: current.tissueSelection,
						matrix: parsed.matrix,
						projectedSpots: current.chipConfig.projectedSpots,
						updatedAt: timestamp,
					});

					return {
						...current,
						chipConfig: {
							...current.chipConfig,
							chipType: parsed.chipType,
							rows: manifest.gridRows,
							columns: manifest.gridCols,
							pitchX: manifest.spotGap,
							pitchY: manifest.spotGap,
							spotDiameter: manifest.spotDiameter,
							origin: { x: 0, y: 0 },
							rotationDegrees: 0,
							placement: null,
							excludedRows: [],
							excludedColumns: [],
							barcodesByPosition: parsed.barcodesByPosition,
							log2nGeneByPosition: parsed.log2nGeneByPosition,
							projectedSpots: null,
							status: "ready",
							isStale: false,
							error: null,
							updatedAt: timestamp,
						},
						tissueSelection: {
							...tissueSelection,
							supportState: support.supportState,
							unsupportedReason: support.unsupportedReason,
						},
					};
				});

				toast({
					title: "Tissue activation imported",
					description: `${parsed.chipType} chip (${parsed.rows}×${parsed.columns}) with ${activeSpotCount} active spots.`,
					status: "success",
				});
			} catch (error) {
				console.error(error);
				toast({
					title: "Unable to import tissue CSV",
					description:
						error instanceof Error
							? error.message
							: "Choose a valid tissue activation CSV file.",
					status: "error",
				});
			}
		},
		[onProjectMutate, toast],
	);

	// Default the chip grid placement (centered, ~fit) once both the HE image
	// and a chip type are available and the user hasn't placed it yet.
	useEffect(() => {
		if (!project) return;
		const he = project.sourceAssets.images.he;
		if (
			!he ||
			typeof he.width !== "number" ||
			typeof he.height !== "number" ||
			!he.width ||
			!he.height
		) {
			return;
		}
		const chipType = project.chipConfig.chipType;
		if (chipType !== "15um" && chipType !== "50um") return;
		if (project.chipConfig.placement !== null) return;

		const heWidth = he.width;
		const heHeight = he.height;
		const { rows, columns, spotDiameter, pitchX } = project.chipConfig;
		if (
			typeof rows !== "number"
			|| typeof columns !== "number"
			|| typeof spotDiameter !== "number"
			|| typeof pitchX !== "number"
		) {
			return;
		}
		const placement = centeredPlacement(heWidth, heHeight, rows, columns, spotDiameter, pitchX);
		const timestamp = new Date().toISOString();

		onProjectMutate(
			(current) => {
				const currentHe = current.sourceAssets.images.he;
				if (
					current.chipConfig.placement !== null ||
					!currentHe ||
					currentHe.width !== heWidth ||
					currentHe.height !== heHeight
				) {
					return current;
				}
				return {
					...current,
					chipConfig: {
						...current.chipConfig,
						placement,
						status: "complete",
						isStale: false,
						error: null,
						updatedAt: timestamp,
					},
				};
			},
			METADATA_DEBOUNCED_PERSIST_OPTIONS,
		);
	}, [
		onProjectMutate,
		project,
		project?.chipConfig.chipType,
		project?.chipConfig.placement,
		project?.sourceAssets.images.he,
	]);

	const tissueSupport = project
		? resolveTissueSelectionSupport({
				chipType: project.chipConfig.chipType,
				rows: project.chipConfig.rows,
				columns: project.chipConfig.columns,
			})
		: { supportState: "unsupported" as const, unsupportedReason: null };

	const tissueProjectedSpots = useMemo(() => {
		if (!project) return [];
		const { chipConfig, sourceAssets } = project;
		const he = sourceAssets.images.he;
		const placement = chipConfig.placement;
		if (
			!he ||
			typeof he.width !== "number" ||
			typeof he.height !== "number" ||
			!placement ||
			typeof chipConfig.rows !== "number" ||
			typeof chipConfig.columns !== "number" ||
			typeof chipConfig.spotDiameter !== "number" ||
			typeof chipConfig.pitchX !== "number"
		) {
			return [];
		}
		return projectSpotsForPlacement({
			rows: chipConfig.rows,
			columns: chipConfig.columns,
			spotDiameter: chipConfig.spotDiameter,
			spotGap: chipConfig.pitchX,
			placement,
			excludedRows: chipConfig.excludedRows,
			excludedColumns: chipConfig.excludedColumns,
			heWidth: he.width,
			heHeight: he.height,
		});
	}, [project]);

	const exportReadiness = project
		? getBuiltInZipExportReadiness(project, tissueProjectedSpots)
		: { canExport: false as const, reason: "Project unavailable." };

	const tissueSelectedSpotIds = useMemo(() => {
		if (!project) return [];
		if (project.tissueSelection.matrix && tissueProjectedSpots.length > 0) {
			return selectedSpotIdsFromMatrix(
				project.tissueSelection.matrix,
				tissueProjectedSpots,
			);
		}
		return project.tissueSelection.selectedSpotIds ?? [];
	}, [project, tissueProjectedSpots]);

	// Normalized [0, 1] expression values over the visible (post-exclusion)
	// spots, for the heatmap display mode. Spots without an imported value are
	// left out so the canvas falls back to the neutral fill.
	const tissueExpressionById = useMemo(() => {
		if (!project) return null;
		return buildNormalizedExpressionById({
			log2nGeneByPosition: project.chipConfig.log2nGeneByPosition,
			spots: tissueProjectedSpots,
		});
	}, [project, tissueProjectedSpots]);

	const hasTissueExpressionData = useMemo(
		() => Object.keys(project?.chipConfig.log2nGeneByPosition ?? {}).length > 0,
		[project?.chipConfig.log2nGeneByPosition],
	);

	const tissueUnitExtent = useMemo(() => {
		if (
			!project
			|| typeof project.chipConfig.rows !== "number"
			|| typeof project.chipConfig.columns !== "number"
			|| typeof project.chipConfig.spotDiameter !== "number"
			|| typeof project.chipConfig.pitchX !== "number"
		) {
			return { w: 0, h: 0 };
		}
		const { rows, columns, spotDiameter, pitchX, excludedRows, excludedColumns } = project.chipConfig;
		const visibleCols = Math.max(0, columns - excludedColumns.length);
		const visibleRows = Math.max(0, rows - excludedRows.length);
		return {
			w: visibleCols * spotDiameter + (visibleCols + 1) * pitchX,
			h: visibleRows * spotDiameter + (visibleRows + 1) * pitchX,
		};
	}, [project]);

	const tissueScaleRange = useMemo(() => {
		const he = project?.sourceAssets.images.he;
		const spotDiameter = project?.chipConfig.spotDiameter;
		if (
			!he
			|| typeof he.width !== "number"
			|| typeof he.height !== "number"
			|| typeof spotDiameter !== "number"
			|| spotDiameter <= 0
		) {
			return { min: 0, max: 1 };
		}
		const maxDim = Math.max(he.width, he.height);
		return { min: 8 / spotDiameter, max: (4 * maxDim) / spotDiameter };
	}, [project]);

	const tissueBlockRect = useMemo<{ width: number; height: number } | null>(() => {
		const placement = project?.chipConfig.placement;
		if (!placement || tissueUnitExtent.w <= 0 || tissueUnitExtent.h <= 0) return null;
		return { width: placement.scale * tissueUnitExtent.w, height: placement.scale * tissueUnitExtent.h };
	}, [project?.chipConfig.placement, tissueUnitExtent]);

	const isTissueInteractionDisabled = tissueSupport.supportState === "unsupported";
	const tissueDetectionStatusMessage =
		project?.tissueSelection.status === "complete"
			? "Tissue spot selection is complete. Refine the selection by marking spots as tissue or background if necessary."
			: "Import a tissue activation CSV and project the chip grid to begin refining tissue spots.";

	const handlePlacementChange = useCallback(
		(placement: ChipPlacement) => {
			onProjectMutate(
				(current) => ({
					...current,
					chipConfig: {
						...current.chipConfig,
						placement,
						updatedAt: new Date().toISOString(),
					},
				}),
				METADATA_DEBOUNCED_PERSIST_OPTIONS,
			);
		},
		[onProjectMutate],
	);

	const handleResetPlacement = useCallback(() => {
		onProjectMutate(
			(current) => {
				const he = current.sourceAssets.images.he;
				const { rows, columns, spotDiameter, pitchX } = current.chipConfig;
				if (
					!he ||
					typeof he.width !== "number" ||
					typeof he.height !== "number" ||
					typeof rows !== "number" ||
					typeof columns !== "number" ||
					typeof spotDiameter !== "number" ||
					typeof pitchX !== "number"
				) {
					return current;
				}
				return {
					...current,
					chipConfig: {
						...current.chipConfig,
						placement: centeredPlacement(he.width, he.height, rows, columns, spotDiameter, pitchX),
						updatedAt: new Date().toISOString(),
					},
				};
			},
			METADATA_DEBOUNCED_PERSIST_OPTIONS,
		);
	}, [onProjectMutate]);

	const handleExcludeRowsChange = useCallback(
		(next: number[]) => {
			onProjectMutate(
				(current) => ({
					...current,
					chipConfig: {
						...current.chipConfig,
						excludedRows: next,
						updatedAt: new Date().toISOString(),
					},
				}),
				METADATA_DEBOUNCED_PERSIST_OPTIONS,
			);
		},
		[onProjectMutate],
	);

	const handleExcludeColumnsChange = useCallback(
		(next: number[]) => {
			onProjectMutate(
				(current) => ({
					...current,
					chipConfig: {
						...current.chipConfig,
						excludedColumns: next,
						updatedAt: new Date().toISOString(),
					},
				}),
				METADATA_DEBOUNCED_PERSIST_OPTIONS,
			);
		},
		[onProjectMutate],
	);

	// Arrow-key nudge: move the placement by one spot pitch per press while on
	// the tissue step. Ignored when focus is in a form field (exclusion UI, etc.).
	useEffect(() => {
		if (!project || project.currentStep !== "tissueSelection") return;
		const placement = project.chipConfig.placement;
		const { spotDiameter, pitchX } = project.chipConfig;
		if (!placement || typeof spotDiameter !== "number" || typeof pitchX !== "number") return;
		const step = (spotDiameter + pitchX) * placement.scale;
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const tag = target?.tagName ?? "";
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
			let dx = 0;
			let dy = 0;
			switch (event.key) {
				case "ArrowLeft":
					dx = -step;
					break;
				case "ArrowRight":
					dx = step;
					break;
				case "ArrowUp":
					dy = -step;
					break;
				case "ArrowDown":
					dy = step;
					break;
				default:
					return;
			}
			event.preventDefault();
			handlePlacementChange({ scale: placement.scale, x: placement.x + dx, y: placement.y + dy });
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [project, handlePlacementChange]);

	// The editable name draft is only displayed while editing, so it only needs to
	// be seeded from the persisted name when editing begins (see
	// beginProjectNameEditing); no effect-based sync is required.
	const beginProjectNameEditing = useCallback(() => {
		setProjectNameDraft(project?.name ?? "");
		setIsEditingProjectName(true);
	}, [project?.name]);

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

	const currentCopy = project
		? placeholderCopyByStep[project.currentStep]
		: placeholderCopyByStep.sourceAssets;

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
									onClick={beginProjectNameEditing}
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
												label="H&E stained tissue image"
												description="Upload the full-resolution H&E stained tissue image. Supported formats: PNG, JPG, JPEG, and TIFF."
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
										<Box flex={1} minW={0}>
											<TissueCsvUploader
												label="Tissue activation CSV"
												description="Import a tissue activation CSV (previously exported and lightly processed) to load the chip size and per-spot activation state."
												buttonLabel={
													project.tissueSelection.mode === "imported"
														? "Replace CSV"
														: "Upload CSV"
												}
												emptyText="No tissue activation CSV imported yet."
												imported={
													project.tissueSelection.mode === "imported"
													&& project.tissueSelection.matrix !== null
												}
												summary={
													project.tissueSelection.matrix
														? `${project.chipConfig.chipType ?? "Unknown"} • ${project.tissueSelection.matrix.rows}×${project.tissueSelection.matrix.columns} • ${project.tissueSelection.matrix.values.filter((value) => value === 1).length} active spots`
														: null
												}
												onUpload={(fileList) => {
													void handleUploadCsv(fileList);
												}}
											/>
										</Box>
									</Flex>
								</Stack>
							) : project.currentStep === "tissueSelection" ? (
								<Flex
									direction={{ base: "column", xl: "row" }}
									gap={5}
									align="stretch"
								>
									<Box flex="1" minW={0}>
										<TissueSelectionPanel
											imageDataUrl={
												project.sourceAssets.images.he?.workingDataUrl ??
												project.sourceAssets.images.he?.dataUrl ??
												null
											}
											projectedSpots={tissueProjectedSpots}
											selectedSpotIds={tissueSelectedSpotIds}
											placement={project.chipConfig.placement}
											unitExtent={tissueUnitExtent}
											scaleRange={tissueScaleRange}
											heWidth={project.sourceAssets.images.he?.width ?? null}
											heHeight={project.sourceAssets.images.he?.height ?? null}
											showSpots={showTissueSpots}
											displayMode={tissueDisplayMode}
											spotValueById={tissueExpressionById}
											disabled={isTissueInteractionDisabled}
											onPlacementChange={handlePlacementChange}
										/>
									</Box>
									<Stack
										w={{ base: "100%", xl: "320px" }}
										spacing={4}
										flexShrink={0}
									>
						{project.chipConfig.error ? (
							<Text fontSize="sm" color="red.600">
								{project.chipConfig.error}
							</Text>
						) : null}
										<TissueSelectionControls
											disabled={isTissueInteractionDisabled}
											showSpots={showTissueSpots}
											onShowSpotsChange={setShowTissueSpots}
											onResetPlacement={handleResetPlacement}
											blockRect={tissueBlockRect}
											rows={project.chipConfig.rows ?? 0}
											columns={project.chipConfig.columns ?? 0}
											excludedRows={project.chipConfig.excludedRows}
											excludedColumns={project.chipConfig.excludedColumns}
											onExcludeRowsChange={handleExcludeRowsChange}
											onExcludeColumnsChange={handleExcludeColumnsChange}
											displayMode={tissueDisplayMode}
											onDisplayModeChange={setTissueDisplayMode}
											hasExpressionData={hasTissueExpressionData}
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
							) : project.currentStep === "exportState" ? (
								<Stack spacing={5}>
									<Text color="gray.600" maxW="3xl">
										{currentCopy.body}
									</Text>
									<ExportPanel
										isExporting={isExporting}
										canExport={exportReadiness.canExport}
										onDownload={() => {
											const currentExportReadiness = getBuiltInZipExportReadiness(
												project,
												tissueProjectedSpots,
											);
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
													const output = await exportBuiltInZip({
														project,
														projectedSpots: tissueProjectedSpots,
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
													console.error(error);
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
								</Stack>
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
