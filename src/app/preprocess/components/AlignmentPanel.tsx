"use client";

import {
	Badge,
	Box,
	Button,
	ButtonGroup,
	Flex,
	Heading,
	HStack,
	Input,
	Stack,
	Text,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
	computeBaseView,
	computeZoomTransform,
	getTransform,
	relativeToImage,
} from "@/lib/canvasViewport";
import {
	ALIGNMENT_COVERAGE_THRESHOLD,
	ALIGNMENT_MIN_PAIRS,
	ALIGNMENT_RMSE_MULTIPLIER,
	ALIGNMENT_TARGET_PAIRS,
	computeAlignmentStatus,
	computeCoverageWarning,
	normalizeAlignmentSlice,
	solveAffineAlignment,
} from "@/lib/preprocess/alignment";
import {
	applyImageDisplayTransform,
	invertImageDisplayTransform,
} from "@/lib/preprocess/imageTransforms";
import { loadOpenCv } from "@/lib/preprocess/loadOpenCv";
import { DEFAULT_LOCALIZATION_IMAGE_TRANSFORM } from "@/lib/preprocess/localization";
import type {
	AlignmentControlPoint,
	AlignmentSlice,
	LocalizationImageTransform,
	PreprocessPoint,
	PreprocessRect,
	PreprocessSourceImage,
} from "@/types/preprocess";

type AlignmentPanelProps = {
	alignment: AlignmentSlice;
	chipBounds: PreprocessRect | null;
	movingImage: PreprocessSourceImage | null;
	referenceImage: PreprocessSourceImage | null;
	onAlignmentChange: (
		updater: (current: AlignmentSlice) => AlignmentSlice,
		options?: { invalidateDownstream?: boolean },
	) => void;
};

type InteractionMode =
	| "awaiting-source"
	| "awaiting-target"
	| "selected-pair"
	| "reposition-source"
	| "reposition-target";

type EditorPoint = {
	id: string;
	point: PreprocessPoint;
	isInlier: boolean;
	isSelected: boolean;
};

type LandmarkCanvasProps = {
	image: PreprocessSourceImage;
	imageKey: "source" | "target";
	points: readonly EditorPoint[];
	pendingPoint: PreprocessPoint | null;
	title: string;
	interactionMode: InteractionMode;
	selectedPairId: string | null;
	imageTransform: LocalizationImageTransform;
	panelContent?: ReactNode;
	onBackgroundPoint: (
		imageKey: "source" | "target",
		point: PreprocessPoint,
	) => void;
	onBackgroundFallback: () => void;
	onSelectPoint: (id: string) => void;
	onRepositionPoint: (
		id: string,
		imageKey: "source" | "target",
		point: PreprocessPoint,
	) => void;
	testIdPrefix: string;
};

type PanSession = {
	lastX: number;
	lastY: number;
	dragged: boolean;
	pointerId: number;
};

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

const makePointId = () =>
	typeof crypto !== "undefined" && crypto.randomUUID
		? crypto.randomUUID()
		: `align-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const formatPercent = (value: number | null) =>
	value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const formatMetric = (value: number | null, digits = 3) =>
	value === null ? "—" : value.toFixed(digits);
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 50;

const clampZoom = (value: number) => clamp(value, ZOOM_MIN, ZOOM_MAX);

function LandmarkCanvas({
	image,
	imageKey,
	points,
	pendingPoint,
	title,
	interactionMode,
	imageTransform,
	panelContent,
	onBackgroundPoint,
	onBackgroundFallback,
	onSelectPoint,
	onRepositionPoint,
	testIdPrefix,
}: LandmarkCanvasProps) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);
	const [viewport, setViewport] = useState<{
		width: number;
		height: number;
	} | null>(null);

	useEffect(() => {
		const node = hostElement;
		if (!node) return;

		const update = () => {
			setViewport({ width: node.clientWidth, height: node.clientHeight });
		};

		update();

		const observer = new ResizeObserver(update);
		observer.observe(node);

		return () => observer.disconnect();
	}, [hostElement]);

	const baseView = useMemo(
		() =>
			computeBaseView(
				viewport,
				Math.max(1, (image.width ?? 1) / Math.max(1, image.height ?? 1)),
			),
		[image.height, image.width, viewport],
	);

	const [zoom, setZoom] = useState(1);
	const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
	const effectiveZoom = zoom * imageTransform.scale;
	const viewportTransform = useMemo(
		() => getTransform(baseView, effectiveZoom, panOffset),
		[baseView, effectiveZoom, panOffset],
	);

	const toImagePoint = useCallback(
		(clientX: number, clientY: number) => {
			const host = hostRef.current;
			if (!host || !viewportTransform) return null;

			const rect = host.getBoundingClientRect();
			const normalized = relativeToImage(
				{ x: clientX - rect.left, y: clientY - rect.top },
				viewportTransform,
			);
			if (!normalized) return null;
			return invertImageDisplayTransform(normalized, imageTransform);
		},
		[imageTransform, viewportTransform],
	);

	const [dragPointId, setDragPointId] = useState<string | null>(null);
	const panSessionRef = useRef<PanSession | null>(null);

	useEffect(() => {
		if (
			!dragPointId ||
			(interactionMode !== "reposition-source" &&
				interactionMode !== "reposition-target")
		)
			return;

		const onPointerMove = (event: PointerEvent) => {
			const point = toImagePoint(event.clientX, event.clientY);
			if (!point) return;
			onRepositionPoint(dragPointId, imageKey, point);
		};

		const onPointerUp = () => setDragPointId(null);

		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp);

		return () => {
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
		};
	}, [dragPointId, imageKey, interactionMode, onRepositionPoint, toImagePoint]);

	const beginPan = useCallback(
		(clientX: number, clientY: number, pointerId: number) => {
			panSessionRef.current = {
				lastX: clientX,
				lastY: clientY,
				dragged: false,
				pointerId,
			};
		},
		[],
	);

	const updatePan = useCallback(
		(clientX: number, clientY: number, pointerId: number) => {
			const session = panSessionRef.current;
			if (!session || session.pointerId !== pointerId) return;

			const dx = clientX - session.lastX;
			const dy = clientY - session.lastY;

			if (!session.dragged && Math.hypot(dx, dy) < 4) return;

			session.dragged = true;
			session.lastX = clientX;
			session.lastY = clientY;
			setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
		},
		[],
	);

	const endPan = useCallback(
		(clientX: number, clientY: number, pointerId: number) => {
			const session = panSessionRef.current;
			if (!session || session.pointerId !== pointerId) return;

			panSessionRef.current = null;

			if (
				!session.dragged &&
				((imageKey === "source" && interactionMode === "awaiting-source") ||
					(imageKey === "target" && interactionMode === "awaiting-target") ||
					(imageKey === "source" && interactionMode === "reposition-source") ||
					(imageKey === "target" && interactionMode === "reposition-target"))
			) {
				const point = toImagePoint(clientX, clientY);
				if (point) {
					onBackgroundPoint(imageKey, point);
					return;
				}
			}

			onBackgroundFallback();
		},
		[imageKey, interactionMode, onBackgroundFallback, onBackgroundPoint, toImagePoint],
	);

	useEffect(() => {
		const host = hostElement;
		if (!host) return;

		const handlePointerDown = (event: PointerEvent) => {
			if (event.target instanceof SVGCircleElement) return;
			event.preventDefault();
			host.setPointerCapture(event.pointerId);
			beginPan(event.clientX, event.clientY, event.pointerId);
		};

		const handlePointerMove = (event: PointerEvent) => {
			updatePan(event.clientX, event.clientY, event.pointerId);
		};

		const handlePointerUp = (event: PointerEvent) => {
			if (host.hasPointerCapture(event.pointerId)) {
				host.releasePointerCapture(event.pointerId);
			}
			endPan(event.clientX, event.clientY, event.pointerId);
		};

		const handlePointerCancel = (event: PointerEvent) => {
			if (host.hasPointerCapture(event.pointerId)) {
				host.releasePointerCapture(event.pointerId);
			}
			panSessionRef.current = null;
		};

		host.addEventListener("pointerdown", handlePointerDown);
		host.addEventListener("pointermove", handlePointerMove);
		host.addEventListener("pointerup", handlePointerUp);
		host.addEventListener("pointercancel", handlePointerCancel);

		return () => {
			host.removeEventListener("pointerdown", handlePointerDown);
			host.removeEventListener("pointermove", handlePointerMove);
			host.removeEventListener("pointerup", handlePointerUp);
			host.removeEventListener("pointercancel", handlePointerCancel);
		};
	}, [beginPan, endPan, hostElement, updatePan]);

	useEffect(() => {
		const host = hostElement;
		if (!host) return;

		const handleWheel = (event: WheelEvent) => {
			event.preventDefault();

			const rect = host.getBoundingClientRect();
			const anchorScreen = {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
			};
			const anchorNorm = relativeToImage(anchorScreen, viewportTransform);
			const next = computeZoomTransform(
				baseView,
				zoom + (event.deltaY > 0 ? -0.2 : 0.2),
				anchorNorm ?? undefined,
				anchorNorm ? anchorScreen : undefined,
			);
			if (!next) return;

			const nextScaleSafe = Math.max(imageTransform.scale, Number.EPSILON);
			setZoom(clampZoom(next.zoom / nextScaleSafe));
			setPanOffset(next.pan);
		};

		host.addEventListener("wheel", handleWheel, { passive: false });
		return () => host.removeEventListener("wheel", handleWheel);
	}, [baseView, hostElement, imageTransform.scale, viewportTransform, zoom]);

	const renderPoint = useCallback(
		(point: PreprocessPoint) => {
			if (!viewportTransform) return null;
			const displayPoint = applyImageDisplayTransform(point, imageTransform);
			return {
				x: viewportTransform.originX + displayPoint.x * viewportTransform.width,
				y:
					viewportTransform.originY + displayPoint.y * viewportTransform.height,
			};
		},
		[imageTransform, viewportTransform],
	);

	return (
		<Stack spacing={3} flex="1" minW={0}>
			<Box
				border="1px solid"
				borderColor="gray.100"
				borderRadius="lg"
				overflow="hidden"
				bg="gray.900"
				minH="320px"
				h={{ base: "52vh", xl: "58vh" }}
				maxH="680px"
				position="relative"
				data-testid={`${testIdPrefix}-canvas-container`}
			>
				<Box
					position="absolute"
					top={4}
					left={4}
					zIndex={2}
					bg="blackAlpha.700"
					color="whiteAlpha.950"
					border="1px solid"
					borderColor="whiteAlpha.300"
					borderRadius="xl"
					px={3}
					py={3}
					backdropFilter="blur(12px)"
					maxW="320px"
				>
					<Stack spacing={2}>
						<Text
							fontSize="xs"
							textTransform="uppercase"
							letterSpacing="0.12em"
							color="whiteAlpha.700"
						>
							{title}
						</Text>
						<Text fontSize="xs" color="whiteAlpha.800">
							Pan with drag, zoom with wheel, and use the guided workflow to
							place or edit landmarks.
						</Text>
					</Stack>
				</Box>
				{panelContent ? (
					<Box position="absolute" top={4} right={4} zIndex={2}>
						{panelContent}
					</Box>
				) : null}
				<Box
					ref={(node) => {
						hostRef.current = node;
						setHostElement(node);
					}}
					position="absolute"
					inset={0}
					data-testid={
						testIdPrefix === "alignment-source"
							? "alignment-add-point-eosin"
							: testIdPrefix === "alignment-target"
								? "alignment-add-point-he"
								: `${testIdPrefix}-canvas-host`
					}
				>
					{viewportTransform ? (
						<>
							<Box
								position="absolute"
								left={`${viewportTransform.originX}px`}
								top={`${viewportTransform.originY}px`}
								width={`${viewportTransform.width}px`}
								height={`${viewportTransform.height}px`}
								overflow="visible"
								pointerEvents="none"
							>
								<img
									src={image.dataUrl}
									alt={title || "Alignment source image"}
									draggable={false}
									style={{
										display: "block",
										width: "100%",
										height: "100%",
										objectFit: "contain",
										userSelect: "none",
										pointerEvents: "none",
										transformOrigin: "center center",
										transform: `rotate(${imageTransform.rotationDegrees}deg) scale(${imageTransform.flipHorizontal ? -1 : 1}, ${imageTransform.flipVertical ? -1 : 1})`,
									}}
								/>
							</Box>
							<svg
								width="100%"
								height="100%"
								viewBox={`0 0 ${viewport?.width ?? 1} ${viewport?.height ?? 1}`}
								role="img"
								aria-label={title || "Alignment landmark overlay"}
								style={{ position: "absolute", inset: 0, touchAction: "none" }}
							>
								<title>{title || "Alignment landmark overlay"}</title>
								{points.map((point, index) => {
									const rendered = renderPoint(point.point);
									if (!rendered) return null;
									return (
										<g key={point.id}>
											<circle
												cx={rendered.x}
												cy={rendered.y}
												r={point.isSelected ? 9 : 8}
												fill={
													point.isSelected
														? "rgba(49,130,206,0.96)"
														: point.isInlier
															? "rgba(56,161,105,0.92)"
															: "rgba(229,62,62,0.92)"
												}
												stroke="white"
												strokeWidth={point.isSelected ? 2.5 : 1.5}
												style={{
													cursor:
														(imageKey === "source" &&
															interactionMode === "reposition-source") ||
														(imageKey === "target" &&
															interactionMode === "reposition-target")
															? "grab"
															: "pointer",
												}}
												onPointerDown={(event) => {
													event.preventDefault();
													event.stopPropagation();
													if (
														(imageKey === "source" &&
															interactionMode === "reposition-source") ||
														(imageKey === "target" &&
															interactionMode === "reposition-target")
													) {
														setDragPointId(point.id);
														return;
													}
													onSelectPoint(point.id);
												}}
											/>
											<text
												x={rendered.x + 11}
												y={rendered.y - 11}
												fontSize="12"
												fill="white"
											>
												{index + 1}
											</text>
										</g>
									);
								})}
								{pendingPoint
									? (() => {
											const rendered = renderPoint(pendingPoint);
											if (!rendered) return null;
											return (
												<circle
													cx={rendered.x}
													cy={rendered.y}
													r={7}
													fill="rgba(236,201,75,0.95)"
													stroke="white"
													strokeWidth={1.5}
													strokeDasharray="2 2"
												/>
											);
										})()
									: null}
							</svg>
						</>
					) : null}
				</Box>
			</Box>
		</Stack>
	);
}

export function AlignmentPanel({
	alignment,
	chipBounds,
	movingImage,
	referenceImage,
	onAlignmentChange,
}: AlignmentPanelProps) {
	const [interactionMode, setInteractionMode] = useState<InteractionMode>(
		"awaiting-source",
	);
	const [pendingSourcePoint, setPendingSourcePoint] =
		useState<PreprocessPoint | null>(null);
	const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
	const [repositionPairId, setRepositionPairId] = useState<string | null>(null);
	const [showDiagnostics, setShowDiagnostics] = useState(false);
	const [runtimeStatus, setRuntimeStatus] = useState<
		"idle" | "loading" | "ready" | "error"
	>("idle");
	const [runtimeError, setRuntimeError] = useState<string | null>(null);

	const hasBothImages = Boolean(
		referenceImage?.dataUrl && movingImage?.dataUrl,
	);

	useEffect(() => {
		if (!hasBothImages) {
			setRuntimeStatus("idle");
			setRuntimeError(null);
			return;
		}

		let cancelled = false;
		setRuntimeStatus("loading");
		setRuntimeError(null);

		const load = async () => {
			try {
				await loadOpenCv();
				if (!cancelled) setRuntimeStatus("ready");
			} catch (error) {
				if (!cancelled) {
					setRuntimeStatus("error");
					setRuntimeError(
						error instanceof Error
							? error.message
							: "Failed to initialize OpenCV runtime",
					);
				}
			}
		};
		load();

		return () => {
			cancelled = true;
		};
	}, [hasBothImages]);

	const resetSolveState = useCallback(
		(current: AlignmentSlice): AlignmentSlice => ({
			...current,
			inlierMask: null,
			affineMatrix: null,
			reprojectionRmse: null,
			inlierRatio: null,
			ransacReprojThreshold: null,
			qualityFlags: {
				minPairs: current.controlPoints.length >= ALIGNMENT_MIN_PAIRS,
				inlierRatio: false,
				rmse: false,
				finiteMatrix: false,
				scaleRange: false,
				accepted: false,
			},
			solveAccepted: false,
			failureReason: null,
			transform: null,
			status: computeAlignmentStatus({
				hasReferenceImage: Boolean(referenceImage?.dataUrl),
				hasMovingImage: Boolean(movingImage?.dataUrl),
				solveAccepted: false,
				failureReason: null,
			}),
			isStale: false,
			updatedAt: new Date().toISOString(),
			error: null,
		}),
		[movingImage?.dataUrl, referenceImage?.dataUrl],
	);

	const clearLocalInteractionState = useCallback(() => {
		setPendingSourcePoint(null);
		setSelectedPairId(null);
		setRepositionPairId(null);
		setInteractionMode("awaiting-source");
	}, []);

	useEffect(() => {
		if (
			selectedPairId &&
			!alignment.controlPoints.some((pair) => pair.id === selectedPairId)
		) {
			setSelectedPairId(null);
			setRepositionPairId(null);
			setInteractionMode("awaiting-source");
		}
	}, [alignment.controlPoints, selectedPairId]);

	const mutateControlPoints = useCallback(
		(
			mutator: (controlPoints: AlignmentControlPoint[]) => AlignmentControlPoint[],
			options?: {
				afterApply?: (nextControlPoints: AlignmentControlPoint[]) => void;
				preserveSelection?: boolean;
			},
		) => {
			onAlignmentChange((slice) => {
				const nextControlPoints = mutator(slice.controlPoints);
				if (nextControlPoints === slice.controlPoints) {
					return slice;
				}
				const nextSlice: AlignmentSlice = {
					...slice,
					controlPoints: nextControlPoints,
				};
				return resetSolveState(nextSlice);
			});
			options?.afterApply?.(mutator(alignment.controlPoints));
			if (!options?.preserveSelection) {
				setSelectedPairId(null);
			}
		},
		[alignment.controlPoints, onAlignmentChange, resetSolveState],
	);

	const handleBackgroundPoint = useCallback(
		(imageKey: "source" | "target", point: PreprocessPoint) => {
			if (imageKey === "source" && interactionMode === "awaiting-source") {
				setPendingSourcePoint(point);
				setSelectedPairId(null);
				setRepositionPairId(null);
				setInteractionMode("awaiting-target");
				return;
			}

			if (imageKey === "target" && interactionMode === "awaiting-source") {
				return;
			}

			if (
				imageKey === "target" &&
				interactionMode === "awaiting-target" &&
				pendingSourcePoint
			) {
				const nextControlPoint: AlignmentControlPoint = {
					id: makePointId(),
					source: pendingSourcePoint,
					target: point,
				};
				const hasDuplicatePair = alignment.controlPoints.some(
					(existingPoint) =>
						existingPoint.source.x === nextControlPoint.source.x &&
						existingPoint.source.y === nextControlPoint.source.y &&
						existingPoint.target.x === nextControlPoint.target.x &&
						existingPoint.target.y === nextControlPoint.target.y,
				);

				if (hasDuplicatePair) {
					clearLocalInteractionState();
					return;
				}

				mutateControlPoints(
					(controlPoints) => [...controlPoints, nextControlPoint],
					{
						afterApply: clearLocalInteractionState,
					},
				);
				return;
			}

			if (imageKey === "source" && interactionMode === "awaiting-target") {
				return;
			}

			if (
				imageKey === "source" &&
				interactionMode === "reposition-source" &&
				repositionPairId
			) {
				mutateControlPoints(
					(controlPoints) =>
						controlPoints.map((pair) =>
							pair.id === repositionPairId ? { ...pair, source: point } : pair,
						),
					{ afterApply: clearLocalInteractionState },
				);
				return;
			}

			if (
				imageKey === "target" &&
				interactionMode === "reposition-target" &&
				repositionPairId
			) {
				mutateControlPoints(
					(controlPoints) =>
						controlPoints.map((pair) =>
							pair.id === repositionPairId ? { ...pair, target: point } : pair,
						),
					{ afterApply: clearLocalInteractionState },
				);
				return;
			}

			clearLocalInteractionState();
		},
		[
			alignment.controlPoints,
			clearLocalInteractionState,
			interactionMode,
			mutateControlPoints,
			pendingSourcePoint,
			repositionPairId,
		],
	);

	const handleRepositionPoint = useCallback(
		(id: string, imageKey: "source" | "target", point: PreprocessPoint) => {
			if (
				(imageKey === "source" && interactionMode !== "reposition-source") ||
				(imageKey === "target" && interactionMode !== "reposition-target")
			) {
				clearLocalInteractionState();
				return;
			}

			if (!repositionPairId || repositionPairId !== id) {
				return;
			}

			mutateControlPoints(
				(controlPoints) =>
					controlPoints.map((pair) =>
						pair.id === repositionPairId
							? imageKey === "source"
								? { ...pair, source: point }
								: { ...pair, target: point }
							: pair,
					),
				{
					afterApply: clearLocalInteractionState,
				},
			);
		},
		[
			clearLocalInteractionState,
			interactionMode,
			mutateControlPoints,
			repositionPairId,
		],
	);

	const handleSelectPair = useCallback(
		(id: string) => {
			setPendingSourcePoint(null);
			setSelectedPairId(id);
			setRepositionPairId(null);
			setInteractionMode("selected-pair");
		},
		[],
	);

	const selectedPair = useMemo(
		() =>
			selectedPairId
				? alignment.controlPoints.find((pair) => pair.id === selectedPairId) ?? null
				: null,
		[selectedPairId, alignment.controlPoints],
	);

	const workflowInstruction = useMemo(() => {
		if (interactionMode === "awaiting-source") {
			return "Click the eosin canvas to place the reference landmark for a new pair.";
		}
		if (interactionMode === "awaiting-target") {
			return "Click the H&E canvas to complete the landmark pair.";
		}
		if (interactionMode === "reposition-source") {
			return "Select the new eosin landmark position for the chosen pair.";
		}
		if (interactionMode === "reposition-target") {
			return "Select the new H&E landmark position for the chosen pair.";
		}
		return selectedPair
			? "Selected pair ready. Reposition either point, delete the pair, or continue solving."
			: "Select an existing pair or start a new one from the eosin canvas.";
	}, [interactionMode, selectedPair]);


	const sourcePoints = useMemo<EditorPoint[]>(
		() =>
			alignment.controlPoints.map((pair, index) => ({
				id: pair.id,
				point: pair.source,
				isInlier: alignment.inlierMask?.[index] ?? true,
				isSelected: pair.id === selectedPairId,
			})),
		[alignment.controlPoints, alignment.inlierMask, selectedPairId],
	);

	const targetPoints = useMemo<EditorPoint[]>(
		() =>
			alignment.controlPoints.map((pair, index) => ({
				id: pair.id,
				point: pair.target,
				isInlier: alignment.inlierMask?.[index] ?? true,
				isSelected: pair.id === selectedPairId,
			})),
		[alignment.controlPoints, alignment.inlierMask, selectedPairId],
	);

	const coverage = useMemo(
		() => computeCoverageWarning(alignment.controlPoints, chipBounds),
		[alignment.controlPoints, chipBounds],
	);

	const canSolve =
		hasBothImages &&
		runtimeStatus === "ready" &&
		alignment.controlPoints.length >= ALIGNMENT_MIN_PAIRS &&
		referenceImage?.width &&
		referenceImage.height &&
		movingImage?.width &&
		movingImage.height;

	const solveAlignment = useCallback(
		async (forceMode = false) => {
			if (
				!referenceImage?.width ||
				!referenceImage.height ||
				!movingImage?.width ||
				!movingImage.height
			)
				return;

			onAlignmentChange((current) => ({
				...current,
				status: "processing",
				isStale: false,
				updatedAt: new Date().toISOString(),
				error: null,
			}));

			try {
				const { cv } = await loadOpenCv();
				const result = solveAffineAlignment({
					cv,
					controlPoints: alignment.controlPoints,
					chipBounds,
					referenceImageSize: {
						width: referenceImage.width,
						height: referenceImage.height,
					},
					movingImageSize: {
						width: movingImage.width,
						height: movingImage.height,
					},
					forceMode,
				});

				onAlignmentChange((current) => ({
					...current,
					inlierMask: result.inlierMask,
					affineMatrix: result.affineMatrix,
					reprojectionRmse: result.reprojectionRmse,
					inlierRatio: result.inlierRatio,
					ransacReprojThreshold: result.ransacReprojThreshold,
					qualityFlags: result.qualityFlags,
					solveAccepted: result.solveAccepted,
					failureReason: result.failureReason,
					transform: result.transform,
					status: computeAlignmentStatus({
						hasReferenceImage: Boolean(referenceImage?.dataUrl),
						hasMovingImage: Boolean(movingImage?.dataUrl),
						solveAccepted: result.solveAccepted,
						failureReason: result.failureReason,
					}),
					isStale: false,
					updatedAt: new Date().toISOString(),
					error: result.failureReason,
				}));
			} catch (error) {
				onAlignmentChange((current) => ({
					...current,
					solveAccepted: false,
					failureReason: "solve-failed",
					status: "error",
					error:
						error instanceof Error ? error.message : "Alignment solve failed",
					isStale: false,
					updatedAt: new Date().toISOString(),
				}));
			}
		},
		[
			alignment.controlPoints,
			chipBounds,
			movingImage?.dataUrl,
			movingImage?.height,
			movingImage?.width,
			onAlignmentChange,
			referenceImage?.dataUrl,
			referenceImage?.height,
			referenceImage?.width,
		],
	);

	if (!referenceImage?.dataUrl || !movingImage?.dataUrl) {
		return (
			<Box
				border="1px solid"
				borderColor="orange.200"
				borderRadius="lg"
				p={5}
				bg="orange.50"
			>
				<Stack spacing={2}>
					<Heading size="sm">Alignment needs both source images</Heading>
					<Text color="orange.800" fontSize="sm">
						Eosin and H&E images must be present before landmark pairing and
						alignment solving can run.
					</Text>
					<Text color="orange.700" fontSize="sm">
						Return to Source Assets to upload or replace the missing image, then
						re-check localization before continuing.
					</Text>
				</Stack>
			</Box>
		);
	}

	const workflowOverlay = (
		<Box
			position="absolute"
			top={4}
			left={4}
			right={4}
			zIndex={3}
			bg="blackAlpha.700"
			color="whiteAlpha.950"
			border="1px solid"
			borderColor="whiteAlpha.300"
			borderRadius="xl"
			px={4}
			py={4}
			backdropFilter="blur(12px)"
			data-testid="alignment-workflow-overlay"
		>
			<Stack spacing={3}>
				<Flex justify="space-between" align={{ base: "flex-start", md: "center" }} gap={3} wrap="wrap">
					<Stack spacing={1}>
						<Text fontSize="xs" textTransform="uppercase" letterSpacing="0.12em" color="whiteAlpha.700">
							Guided alignment workflow
						</Text>
						<Text fontSize="sm" fontWeight="semibold" data-testid="alignment-workflow-instruction">
							{workflowInstruction}
						</Text>
					</Stack>
					<HStack spacing={2} wrap="wrap">
						<Badge
							colorScheme={
								alignment.controlPoints.length >= ALIGNMENT_MIN_PAIRS
									? "green"
									: "orange"
							}
							data-testid="alignment-pair-count-badge"
							data-pair-count={alignment.controlPoints.length}
						>
							Pairs {alignment.controlPoints.length} / {ALIGNMENT_TARGET_PAIRS}
						</Badge>
						<Badge
							colorScheme={
								runtimeStatus === "ready"
									? "green"
									: runtimeStatus === "error"
										? "red"
										: "orange"
							}
							data-testid="alignment-runtime-status-badge"
							data-runtime-status={runtimeStatus}
						>
							OpenCV {runtimeStatus}
						</Badge>
						<Badge
							colorScheme={
								alignment.solveAccepted
									? "green"
									: alignment.failureReason
										? "red"
										: "gray"
							}
							data-testid="alignment-status"
							data-solve-accepted={alignment.solveAccepted ? "true" : "false"}
							data-failure-reason={alignment.failureReason ?? ""}
						>
							{alignment.solveAccepted
								? "Accepted"
								: alignment.failureReason
									? "Rejected"
									: "Not solved"}
						</Badge>
						{selectedPair ? (
							<Badge colorScheme="purple" data-testid="alignment-selected-pair-badge">
								Selected pair #{alignment.controlPoints.findIndex((pair) => pair.id === selectedPair.id) + 1}
							</Badge>
						) : null}
					</HStack>
				</Flex>
				<Flex gap={3} wrap="wrap" align="center">
					<Button
						size="sm"
						variant="outline"
						color="white"
						borderColor="whiteAlpha.400"
						_hover={{ bg: "whiteAlpha.200" }}
						onClick={() => {
							if (!selectedPairId) return;
							setPendingSourcePoint(null);
							setRepositionPairId(selectedPairId);
							setInteractionMode("reposition-source");
						}}
						isDisabled={!selectedPairId}
						data-testid="alignment-select-reposition-source"
					>
						Move eosin point
					</Button>
					<Button
						size="sm"
						variant="outline"
						color="white"
						borderColor="whiteAlpha.400"
						_hover={{ bg: "whiteAlpha.200" }}
						onClick={() => {
							if (!selectedPairId) return;
							setPendingSourcePoint(null);
							setRepositionPairId(selectedPairId);
							setInteractionMode("reposition-target");
						}}
						isDisabled={!selectedPairId}
						data-testid="alignment-select-reposition-target"
					>
						Move H&E point
					</Button>
					<Button
						size="sm"
						variant="outline"
						colorScheme="red"
						onClick={() => {
							if (!selectedPairId) return;
							setPendingSourcePoint(null);
							setRepositionPairId(null);
							mutateControlPoints(
								(controlPoints) =>
									controlPoints.filter((point) => point.id !== selectedPairId),
								{ afterApply: clearLocalInteractionState },
							);
						}}
						isDisabled={!selectedPairId}
						data-testid="alignment-select-delete-pair"
					>
						Delete pair
					</Button>
					<Button
						size="sm"
						variant="ghost"
						color="white"
						_hover={{ bg: "whiteAlpha.200" }}
						onClick={clearLocalInteractionState}
						isDisabled={interactionMode === "awaiting-source" && !pendingSourcePoint}
						data-testid="alignment-select-cancel"
					>
						Cancel
					</Button>
					<Button
						size="sm"
						variant="ghost"
						color="white"
						_hover={{ bg: "whiteAlpha.200" }}
						onClick={() => setShowDiagnostics((current) => !current)}
						data-testid="alignment-diagnostics-toggle"
					>
						{showDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						color="white"
						_hover={{ bg: "whiteAlpha.200" }}
						onClick={() => {
							setPendingSourcePoint(null);
							setRepositionPairId(null);
							mutateControlPoints(
								(controlPoints) => controlPoints.slice(0, -1),
								{ afterApply: clearLocalInteractionState },
							);
						}}
						isDisabled={alignment.controlPoints.length === 0}
						data-testid="alignment-undo-last-point"
					>
						Undo last point
					</Button>
					<Button
						size="sm"
						variant="ghost"
						color="white"
						_hover={{ bg: "whiteAlpha.200" }}
						onClick={() => {
							setPendingSourcePoint(null);
							setRepositionPairId(null);
							mutateControlPoints(() => [], {
								afterApply: clearLocalInteractionState,
							});
						}}
						isDisabled={alignment.controlPoints.length === 0}
						data-testid="alignment-reset"
					>
						Reset pairs
					</Button>
					<Button
						size="sm"
						colorScheme="brand"
						onClick={() => void solveAlignment()}
						isDisabled={!canSolve}
						data-testid="alignment-run-solve"
					>
						Solve alignment
					</Button>
					{alignment.failureReason && !alignment.solveAccepted ? (
						<Button
							size="sm"
							colorScheme="red"
							variant="outline"
							onClick={() => void solveAlignment(true)}
							isDisabled={!canSolve}
							data-testid="alignment-force-solve"
						>
							Force continue (dangerous)
						</Button>
					) : null}
				</Flex>
			</Stack>
		</Box>
	);

	const referenceViewControls = (
		<Box
			bg="blackAlpha.700"
			color="whiteAlpha.950"
			border="1px solid"
			borderColor="whiteAlpha.300"
			borderRadius="xl"
			px={3}
			py={3}
			backdropFilter="blur(12px)"
			data-testid="alignment-reference-view-controls"
		>
			<Stack spacing={3} minW="220px">
				<Text fontSize="xs" textTransform="uppercase" letterSpacing="0.12em" color="whiteAlpha.700">
					Reference view
				</Text>
				<Text fontSize="xs" color="whiteAlpha.800">
					Use wheel zoom and drag pan on the eosin canvas. Landmark placement stays guided by the shared workflow overlay.
				</Text>
			</Stack>
		</Box>
	);

	const movingViewControls = (
		<Box
			bg="blackAlpha.700"
			color="whiteAlpha.950"
			border="1px solid"
			borderColor="whiteAlpha.300"
			borderRadius="xl"
			px={3}
			py={3}
			backdropFilter="blur(12px)"
			data-testid="alignment-moving-view-controls"
		>
			<Stack spacing={3} minW="260px">
				<Text fontSize="xs" textTransform="uppercase" letterSpacing="0.12em" color="whiteAlpha.700">
					Moving image view + transform
				</Text>
				<Stack spacing={1}>
					<Text fontSize="xs" color="whiteAlpha.700">Rotation</Text>
					<Input
						type="range"
						min={-180}
						max={180}
						step={0.5}
						value={alignment.movingImageTransform.rotationDegrees}
						data-testid="alignment-he-rotation-slider"
						onChange={(event) => {
							const nextRotation = Number(event.target.value);
							onAlignmentChange(
								(slice) =>
									normalizeAlignmentSlice({
										...slice,
										movingImageTransform: {
											...slice.movingImageTransform,
											rotationDegrees: nextRotation,
										},
									}),
								{ invalidateDownstream: false },
							);
						}}
						px={0}
					/>
				</Stack>
				<Stack spacing={1}>
					<Text fontSize="xs" color="whiteAlpha.700">Scale</Text>
					<Input
						type="range"
						min={0.5}
						max={4}
						step={0.05}
						value={alignment.movingImageTransform.scale}
						data-testid="alignment-he-scale-slider"
						onChange={(event) => {
							const nextScale = Number(event.target.value);
							onAlignmentChange(
								(slice) =>
									normalizeAlignmentSlice({
										...slice,
										movingImageTransform: {
											...slice.movingImageTransform,
											scale: nextScale,
										},
									}),
								{ invalidateDownstream: false },
							);
						}}
						px={0}
					/>
				</Stack>
				<ButtonGroup size="sm" isAttached variant="outline">
					<Button
						color="white"
						borderColor="whiteAlpha.400"
						_hover={{ bg: "whiteAlpha.200" }}
						data-testid="alignment-he-flip-horizontal"
						onClick={() => {
							onAlignmentChange(
								(slice) =>
									normalizeAlignmentSlice({
										...slice,
										movingImageTransform: {
											...slice.movingImageTransform,
											flipHorizontal: !slice.movingImageTransform.flipHorizontal,
										},
									}),
								{ invalidateDownstream: false },
							);
						}}
					>
						Flip horizontal
					</Button>
					<Button
						color="white"
						borderColor="whiteAlpha.400"
						_hover={{ bg: "whiteAlpha.200" }}
						onClick={() => {
							onAlignmentChange(
								(slice) =>
									normalizeAlignmentSlice({
										...slice,
										movingImageTransform: {
											...slice.movingImageTransform,
											flipVertical: !slice.movingImageTransform.flipVertical,
										},
									}),
								{ invalidateDownstream: false },
							);
						}}
					>
						Flip vertical
					</Button>
				</ButtonGroup>
				<Button
					size="sm"
					variant="ghost"
					color="white"
					_hover={{ bg: "whiteAlpha.200" }}
					onClick={() => {
						onAlignmentChange(
							(slice) =>
								normalizeAlignmentSlice({
									...slice,
									movingImageTransform: DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
								}),
							{ invalidateDownstream: false },
						);
					}}
				>
					Reset H&E transform
				</Button>
			</Stack>
		</Box>
	);

	return (
		<Stack spacing={5}>
			<Box position="relative" pt={{ base: 52, xl: 44 }}>
				{workflowOverlay}
				{coverage.warning ? (
					<Text
						fontSize="sm"
						color="orange.600"
						mb={3}
						data-testid="alignment-distribution-warning"
					>
						Landmark spread is narrow. Coverage ratios are
						 {formatPercent(coverage.coverageRatioX)} width and
						 {formatPercent(coverage.coverageRatioY)} height, below the
						 {Math.round(ALIGNMENT_COVERAGE_THRESHOLD * 100)}% minimum.
					</Text>
				) : null}
				{runtimeError ? (
					<Text fontSize="sm" color="red.600" mb={3}>
						{runtimeError}
					</Text>
				) : null}
				{alignment.failureReason && !alignment.solveAccepted ? (
					<Box
						border="1px solid"
						borderColor="red.200"
						borderRadius="lg"
						p={4}
						bg="red.50"
						mb={4}
					>
						<Stack spacing={2}>
							<Text fontSize="sm" fontWeight="semibold" color="red.800">
								Warning: Precision loss risk
							</Text>
							<Text fontSize="sm" color="red.700">
								The alignment quality checks failed ({alignment.failureReason}). Using
								 &ldquo;Force continue&rdquo; will skip RANSAC outlier detection and compute the
								 transformation using all control points. This may result in precision
								 errors and inaccurate alignment. Only use this if you understand the risks.
							</Text>
						</Stack>
					</Box>
				) : null}
				<Flex direction={{ base: "column", xl: "row" }} gap={4} align="stretch">
					<LandmarkCanvas
						image={referenceImage}
						imageKey="source"
						imageTransform={DEFAULT_LOCALIZATION_IMAGE_TRANSFORM}
						points={sourcePoints}
						pendingPoint={pendingSourcePoint}
						title="Eosin landmarks (reference)"
						interactionMode={interactionMode}
						selectedPairId={selectedPairId}
						panelContent={referenceViewControls}
						onBackgroundPoint={handleBackgroundPoint}
						onBackgroundFallback={clearLocalInteractionState}
						onSelectPoint={handleSelectPair}
						onRepositionPoint={handleRepositionPoint}
						testIdPrefix="alignment-source"
					/>
					<LandmarkCanvas
						image={movingImage}
						imageKey="target"
						imageTransform={alignment.movingImageTransform}
						points={targetPoints}
						pendingPoint={null}
						title="H&E landmarks (moving)"
						interactionMode={interactionMode}
						selectedPairId={selectedPairId}
						panelContent={movingViewControls}
						onBackgroundPoint={handleBackgroundPoint}
						onBackgroundFallback={clearLocalInteractionState}
						onSelectPoint={handleSelectPair}
						onRepositionPoint={handleRepositionPoint}
						testIdPrefix="alignment-target"
					/>
				</Flex>
			</Box>
			{showDiagnostics ? (
				<Stack spacing={2} fontSize="sm">
					<HStack justify="space-between">
						<Text color="gray.600">Inlier ratio</Text>
						<Text fontWeight="semibold" data-testid="alignment-inlier-ratio">
							{formatPercent(alignment.inlierRatio)}
						</Text>
					</HStack>
					<HStack justify="space-between">
						<Text color="gray.600">Reprojection RMSE</Text>
						<Text fontWeight="semibold" data-testid="alignment-rmse">
							{formatMetric(alignment.reprojectionRmse)} px
							{alignment.ransacReprojThreshold !== null
								? ` (threshold ${formatMetric(ALIGNMENT_RMSE_MULTIPLIER * alignment.ransacReprojThreshold)} px)`
								: ""}
						</Text>
					</HStack>
					<HStack justify="space-between">
						<Text color="gray.600">Quality gates</Text>
						<Text fontWeight="semibold">
							minPairs:{alignment.qualityFlags.minPairs ? "✓" : "✗"} • inlier:
							{alignment.qualityFlags.inlierRatio ? "✓" : "✗"} • rmse:
							{alignment.qualityFlags.rmse ? "✓" : "✗"} • matrix:
							{alignment.qualityFlags.finiteMatrix ? "✓" : "✗"} • scale:
							{alignment.qualityFlags.scaleRange ? "✓" : "✗"}
						</Text>
					</HStack>
					<Box
						as="pre"
						fontSize="xs"
						color="gray.700"
						bg="gray.50"
						borderRadius="md"
						p={2}
						data-testid="alignment-matrix-json"
					>
						{alignment.affineMatrix
							? JSON.stringify(alignment.affineMatrix)
							: "null"}
					</Box>
				</Stack>
			) : null}
		</Stack>
	);
}
