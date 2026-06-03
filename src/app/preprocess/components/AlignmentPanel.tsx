"use client";

import {
	ChevronDownIcon,
	ChevronUpIcon,
	CloseIcon,
	InfoOutlineIcon,
} from "@chakra-ui/icons";
import {
	Badge,
	Box,
	Button,
	ButtonGroup,
	Flex,
	Heading,
	HStack,
	IconButton,
	Stack,
	Text,
} from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
	onSolveAccepted: () => void;
	onAlignmentChange: (
		updater: (current: AlignmentSlice) => AlignmentSlice,
		options?: { invalidateDownstream?: boolean },
	) => void;
	referenceImage: PreprocessSourceImage | null;
	referenceImageTransform: LocalizationImageTransform;
	showMovingImagePaddingBoundary: boolean;
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
	showImageBoundary?: boolean;
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

type HelpOverlayState = "expanded" | "collapsed" | "hidden";

const HELP_COPY = {
	expanded: "Drag to pan. Wheel to zoom. Add or adjust landmarks in order.",
	collapsed: "Pan, zoom, and place landmarks.",
	reopen: "Show canvas help",
	minimize: "Minimize canvas help",
	expand: "Expand canvas help",
	dismiss: "Dismiss canvas help",
} as const;

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
	showImageBoundary = false,
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
	const [helpOverlayState, setHelpOverlayState] =
		useState<HelpOverlayState>("expanded");

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
				Math.max(1, image.workingWidth && image.workingHeight
					? image.workingWidth / image.workingHeight
					: (image.width ?? 1) / Math.max(1, image.height ?? 1)),
			),
		[image.workingWidth, image.workingHeight, image.height, image.width, viewport],
	);

	const [zoom, setZoom] = useState(1);
	const imageDataUrl = image.workingDataUrl ?? image.thumbnailDataUrl ?? image.dataUrl;
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
		[
			imageKey,
			interactionMode,
			onBackgroundFallback,
			onBackgroundPoint,
			toImagePoint,
		],
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
				borderColor="gray.200"
				borderRadius="lg"
				overflow="hidden"
				bg="white"
				minH="320px"
				h={{ base: "52vh", xl: "58vh" }}
				maxH="680px"
				position="relative"
				boxShadow="sm"
				data-testid={`${testIdPrefix}-canvas-container`}
			>
				<Box
					position="absolute"
					left={4}
					bottom={4}
					zIndex={2}
					pointerEvents="none"
				>
					{helpOverlayState === "hidden" ? (
						<IconButton
							aria-label={HELP_COPY.reopen}
							icon={<InfoOutlineIcon boxSize={4} />}
							size="sm"
							variant="outline"
							onClick={() => setHelpOverlayState("expanded")}
							pointerEvents="auto"
							bg="blackAlpha.700"
							color="whiteAlpha.900"
							borderColor="whiteAlpha.300"
							_hover={{ bg: "blackAlpha.800" }}
							_active={{ bg: "blackAlpha.800" }}
							data-testid={`${testIdPrefix}-help-reopen`}
						/>
					) : (
						<Stack
							spacing={helpOverlayState === "expanded" ? 2 : 1}
							bg="blackAlpha.700"
							color="whiteAlpha.900"
							px={3}
							py={2}
							borderRadius="lg"
							maxW={helpOverlayState === "expanded" ? "320px" : "220px"}
							pointerEvents="auto"
						>
							<Flex align="center" gap={2} minW={0}>
								<Text fontSize="xs" fontWeight="semibold" flex="1" minW={0}>
									{title}
								</Text>
								<HStack spacing={1} flexShrink={0}>
									<IconButton
										aria-label={
											helpOverlayState === "expanded"
												? HELP_COPY.minimize
												: HELP_COPY.expand
										}
										icon={
											helpOverlayState === "expanded" ? (
												<ChevronDownIcon boxSize={4} />
											) : (
												<ChevronUpIcon boxSize={4} />
											)
										}
										size="xs"
										variant="ghost"
										color="whiteAlpha.900"
										onClick={() =>
											setHelpOverlayState((current) =>
												current === "expanded" ? "collapsed" : "expanded",
											)
										}
										_hover={{ bg: "whiteAlpha.200" }}
										_active={{ bg: "whiteAlpha.200" }}
									/>
									<IconButton
										aria-label={HELP_COPY.dismiss}
										icon={<CloseIcon boxSize={2.5} />}
										size="xs"
										variant="ghost"
										color="whiteAlpha.900"
										onClick={() => setHelpOverlayState("hidden")}
										_hover={{ bg: "whiteAlpha.200" }}
										_active={{ bg: "whiteAlpha.200" }}
									/>
								</HStack>
							</Flex>
							<Text fontSize="xs" color="whiteAlpha.900">
								{helpOverlayState === "expanded"
									? HELP_COPY.expanded
									: HELP_COPY.collapsed}
							</Text>
						</Stack>
					)}
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
								<Box
									position="absolute"
									inset={0}
									data-testid={`${testIdPrefix}-image-transform-layer`}
									style={{
										transformOrigin: "center center",
										transform: `scale(${imageTransform.flipHorizontal ? -1 : 1}, ${imageTransform.flipVertical ? -1 : 1}) rotate(${imageTransform.rotationDegrees}deg)`,
									}}
								>
									<img
										src={imageDataUrl}
										alt={title || "Alignment source image"}
										draggable={false}
										style={{
											display: "block",
											width: "100%",
											height: "100%",
											objectFit: "contain",
											userSelect: "none",
											pointerEvents: "none",
										}}
									/>
									{showImageBoundary ? (
										<Box
											position="absolute"
											inset={0}
											data-testid={`${testIdPrefix}-image-boundary`}
											pointerEvents="none"
											outline="1px solid black"
										/>
									) : null}
								</Box>
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
	onSolveAccepted,
	onAlignmentChange,
	referenceImage,
	referenceImageTransform,
	showMovingImagePaddingBoundary,
}: AlignmentPanelProps) {
	const [interactionMode, setInteractionMode] =
		useState<InteractionMode>("awaiting-source");
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
      source: null,
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
			mutator: (
				controlPoints: AlignmentControlPoint[],
			) => AlignmentControlPoint[],
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

			mutateControlPoints((controlPoints) =>
				controlPoints.map((pair) =>
					pair.id === repositionPairId
						? imageKey === "source"
							? { ...pair, source: point }
							: { ...pair, target: point }
						: pair,
				),
				{ preserveSelection: true },
			);
		},
		[
			clearLocalInteractionState,
			interactionMode,
			mutateControlPoints,
			repositionPairId,
		],
	);

	const handleSelectPair = useCallback((id: string) => {
		setPendingSourcePoint(null);
		setSelectedPairId(id);
		setRepositionPairId(null);
		setInteractionMode("selected-pair");
	}, []);

	const selectedPair = useMemo(
		() =>
			selectedPairId
				? (alignment.controlPoints.find((pair) => pair.id === selectedPairId) ??
					null)
				: null,
		[selectedPairId, alignment.controlPoints],
	);

	const workflowInstruction = useMemo(() => {
		if (alignment.solveAccepted) {
			return "Alignment accepted. Continue to crop QC or keep adjusting landmarks if something looks off.";
		}
		if (interactionMode === "awaiting-source") {
			return "Use wheel zoom and drag pan on the eosin canvas, then click it to place the reference landmark for a new pair.";
		}
		if (interactionMode === "awaiting-target") {
			return "Pan or zoom as needed, then click the H&E canvas to complete the landmark pair.";
		}
		if (interactionMode === "reposition-source") {
			return "Use the eosin canvas to choose the new reference landmark position for the selected pair.";
		}
		if (interactionMode === "reposition-target") {
			return "Use the H&E canvas to choose the new moving-image landmark position for the selected pair.";
		}
		return selectedPair
			? "Selected pair ready. Reposition either point, delete the pair, or continue solving while using pan and zoom directly on the canvases."
			: "Start on the eosin canvas, using wheel zoom and drag pan as needed before placing the next reference point.";
	}, [alignment.solveAccepted, interactionMode, selectedPair]);

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
		async (
			solveMode: "ransac" | "allPoints" | "inlierSubset" = "allPoints",
			seedInlierMask?: readonly boolean[] | null,
		) => {
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
					solveMode,
					seedInlierMask,
				});

                onAlignmentChange((current) => ({
                  ...current,
                  source: result.solveAccepted ? "manual" : null,
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
				if (result.solveAccepted) {
					onSolveAccepted();
				}
			} catch (error) {
				onAlignmentChange((current) => ({
					...current,
					solveAccepted: false,
					source: null,
					affineMatrix: null,
					transform: null,
					inlierMask: null,
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
			onSolveAccepted,
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
			bg="rgba(255, 255, 255, 0.94)"
			color="gray.800"
			border="1px solid"
			borderColor="gray.200"
			borderRadius="2xl"
			px={{ base: 3, md: 4 }}
			py={{ base: 3, md: 4 }}
			boxShadow="0 18px 48px rgba(15, 23, 42, 0.12)"
			backdropFilter="blur(18px)"
			data-testid="alignment-workflow-overlay"
		>
			<Stack spacing={3}>
				<Flex
					justify="space-between"
					align={{ base: "flex-start", lg: "center" }}
					gap={3}
					wrap="wrap"
				>
					<Stack spacing={2} flex="1" minW="240px">
						<Flex align="center" gap={2} wrap="wrap">
							<Text
								fontSize="xs"
								textTransform="uppercase"
								letterSpacing="0.12em"
								color="gray.500"
							>
								Guided alignment workflow
							</Text>
							<Badge
								colorScheme={
									alignment.controlPoints.length >= ALIGNMENT_MIN_PAIRS
										? "green"
										: "orange"
								}
								borderRadius="full"
								px={2.5}
								py={1}
								data-testid="alignment-pair-count-badge"
								data-pair-count={alignment.controlPoints.length}
							>
								Pairs {alignment.controlPoints.length} /{" "}
								{ALIGNMENT_TARGET_PAIRS}
							</Badge>
						</Flex>
						<Text
							fontSize={{ base: "sm", md: "md" }}
							fontWeight="semibold"
							lineHeight="1.45"
							data-testid="alignment-workflow-instruction"
						>
							{workflowInstruction}
						</Text>
					</Stack>
					<Flex
						gap={2}
						wrap="wrap"
						align="center"
						justify={{ base: "flex-start", lg: "flex-end" }}
					>
						<Badge
							colorScheme={
								runtimeStatus === "ready"
									? "green"
									: runtimeStatus === "error"
										? "red"
										: "orange"
							}
							borderRadius="full"
							px={2.5}
							py={1}
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
							borderRadius="full"
							px={2.5}
							py={1}
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
							<Badge
								colorScheme="purple"
								borderRadius="full"
								px={2.5}
								py={1}
								data-testid="alignment-selected-pair-badge"
							>
								Selected pair #
								{alignment.controlPoints.findIndex(
									(pair) => pair.id === selectedPair.id,
								) + 1}
							</Badge>
						) : null}
					</Flex>
				</Flex>
				<Flex gap={2} wrap="wrap" align="center">
					<Button
						size="sm"
						variant="outline"
						color="gray.700"
						borderColor="gray.300"
						bg="whiteAlpha.800"
						_hover={{ bg: "white" }}
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
						color="gray.700"
						borderColor="gray.300"
						bg="whiteAlpha.800"
						_hover={{ bg: "white" }}
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
						color="gray.700"
						_hover={{ bg: "gray.100" }}
						onClick={clearLocalInteractionState}
						isDisabled={
							interactionMode === "awaiting-source" && !pendingSourcePoint
						}
						data-testid="alignment-select-cancel"
					>
						Cancel
					</Button>
					<Button
						size="sm"
						variant="ghost"
						color="gray.700"
						_hover={{ bg: "gray.100" }}
						onClick={() => setShowDiagnostics((current) => !current)}
						data-testid="alignment-diagnostics-toggle"
					>
						{showDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						color="gray.700"
						_hover={{ bg: "gray.100" }}
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
						color="gray.700"
						_hover={{ bg: "gray.100" }}
						onClick={() => {
							setPendingSourcePoint(null);
							setRepositionPairId(null);
							if (alignment.controlPoints.length > 0) {
								mutateControlPoints(() => [], {
									afterApply: clearLocalInteractionState,
								});
								return;
							}

							onAlignmentChange((current) => resetSolveState(current));
							clearLocalInteractionState();
						}}
						isDisabled={alignment.controlPoints.length === 0}
						data-testid="alignment-reset"
					>
						Reset pairs
					</Button>
					<Button
						size="sm"
						colorScheme="brand"
						boxShadow="sm"
						onClick={() => void solveAlignment()}
						isDisabled={!canSolve}
						data-testid="alignment-run-solve"
					>
						Solve alignment
					</Button>
				</Flex>
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
			<Stack spacing={3} minW="220px">
				<Stack spacing={2} data-testid="alignment-he-section-scale">
					<Flex justify="space-between" align="center" gap={3}>
						<Text
							fontSize="xs"
							textTransform="uppercase"
							letterSpacing="0.12em"
							color="whiteAlpha.700"
						>
							Zoom
						</Text>
						<Text fontSize="sm" fontWeight="semibold">
							{(alignment.movingImageTransform.scale * 100).toFixed(0)}%
						</Text>
					</Flex>
					<ButtonGroup size="sm" isAttached variant="outline">
						<Button
							aria-label="Zoom out H&E image"
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
												scale: Math.max(
													0.5,
													slice.movingImageTransform.scale - 0.05,
												),
											},
										}),
									{ invalidateDownstream: false },
								);
							}}
						>
							−
						</Button>
						<Button
							aria-label="Zoom in H&E image"
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
												scale: Math.min(
													4,
													slice.movingImageTransform.scale + 0.05,
												),
											},
										}),
									{ invalidateDownstream: false },
								);
							}}
						>
							+
						</Button>
					</ButtonGroup>
				</Stack>
				<Stack spacing={2} data-testid="alignment-he-section-rotation">
					<Flex justify="space-between" align="center" gap={3}>
						<Text
							fontSize="xs"
							textTransform="uppercase"
							letterSpacing="0.12em"
							color="whiteAlpha.700"
						>
							Rotation
						</Text>
						<Text fontSize="sm" fontWeight="semibold">
							{alignment.movingImageTransform.rotationDegrees.toFixed(1)}°
						</Text>
					</Flex>
					<ButtonGroup size="sm" variant="outline" isAttached flexWrap="wrap">
						<Button
							aria-label="Rotate H&E left 90 degrees"
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
												rotationDegrees:
													slice.movingImageTransform.rotationDegrees - 90,
											},
										}),
									{ invalidateDownstream: false },
								);
							}}
						>
							↺90
						</Button>
						<Button
							aria-label="Rotate H&E right 90 degrees"
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
												rotationDegrees:
													slice.movingImageTransform.rotationDegrees + 90,
											},
										}),
									{ invalidateDownstream: false },
								);
							}}
						>
							↻90
						</Button>
						<Button
							aria-label="Rotate H&E left 1 degree"
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
												rotationDegrees:
													slice.movingImageTransform.rotationDegrees - 1,
											},
										}),
									{ invalidateDownstream: false },
								);
							}}
						>
							↺1
						</Button>
						<Button
							aria-label="Rotate H&E right 1 degree"
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
												rotationDegrees:
													slice.movingImageTransform.rotationDegrees + 1,
											},
										}),
									{ invalidateDownstream: false },
								);
							}}
						>
							↻1
						</Button>
					</ButtonGroup>
				</Stack>
				<Stack spacing={2} data-testid="alignment-he-section-flip">
					<Text
						fontSize="xs"
						textTransform="uppercase"
						letterSpacing="0.12em"
						color="whiteAlpha.700"
					>
						Flip
					</Text>
					<ButtonGroup size="sm" variant="outline" isAttached>
						<Button
							aria-label="Flip H&E horizontally"
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
												flipHorizontal:
													!slice.movingImageTransform.flipHorizontal,
											},
										}),
									{ invalidateDownstream: false },
								);
							}}
						>
							⇋
						</Button>
						<Button
							aria-label="Flip H&E vertically"
							color="white"
							borderColor="whiteAlpha.400"
							_hover={{ bg: "whiteAlpha.200" }}
							data-testid="alignment-he-flip-vertical"
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
							⇅
						</Button>
					</ButtonGroup>
				</Stack>
				<Stack spacing={2} data-testid="alignment-he-section-reset">
					<Text
						fontSize="xs"
						textTransform="uppercase"
						letterSpacing="0.12em"
						color="whiteAlpha.700"
					>
						Reset
					</Text>
					<Button
						size="sm"
						variant="outline"
						color="white"
						borderColor="whiteAlpha.400"
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
						⟲
					</Button>
				</Stack>
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
				<Flex direction={{ base: "column", xl: "row" }} gap={4} align="stretch">
					<LandmarkCanvas
						image={referenceImage}
						imageKey="source"
						imageTransform={referenceImageTransform}
						points={sourcePoints}
						pendingPoint={pendingSourcePoint}
						title="Eosin landmarks (reference)"
						interactionMode={interactionMode}
						selectedPairId={selectedPairId}
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
						showImageBoundary={showMovingImagePaddingBoundary}
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
