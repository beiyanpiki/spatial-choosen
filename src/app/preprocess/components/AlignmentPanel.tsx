"use client";

import {
	Badge,
	Box,
	Button,
	ButtonGroup,
	Divider,
	Flex,
	Heading,
	HStack,
	Input,
	Stack,
	Text,
} from "@chakra-ui/react";
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
	referenceImage: PreprocessSourceImage | null;
	onAlignmentChange: (
		updater: (current: AlignmentSlice) => AlignmentSlice,
		options?: { invalidateDownstream?: boolean },
	) => void;
};

type EditorTool = "add" | "move" | "delete";

type PendingPair = {
	source: PreprocessPoint | null;
	target: PreprocessPoint | null;
};

type EditorPoint = {
	id: string;
	point: PreprocessPoint;
	isInlier: boolean;
};

type LandmarkCanvasProps = {
	image: PreprocessSourceImage;
	imageKey: "source" | "target";
	points: readonly EditorPoint[];
	pendingPoint: PreprocessPoint | null;
	title: string;
	tool: EditorTool;
	imageTransform: LocalizationImageTransform;
	onCreatePoint: (
		imageKey: "source" | "target",
		point: PreprocessPoint,
	) => void;
	onDeletePoint: (id: string) => void;
	onMovePoint: (
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
	tool,
	imageTransform,
	onCreatePoint,
	onDeletePoint,
	onMovePoint,
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
		if (!dragPointId || tool !== "move") return;

		const onPointerMove = (event: PointerEvent) => {
			const point = toImagePoint(event.clientX, event.clientY);
			if (!point) return;
			onMovePoint(dragPointId, imageKey, point);
		};

		const onPointerUp = () => setDragPointId(null);

		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp);

		return () => {
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
		};
	}, [dragPointId, imageKey, onMovePoint, toImagePoint, tool]);

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

			if (!session.dragged && tool === "add") {
				const point = toImagePoint(clientX, clientY);
				if (point) {
					onCreatePoint(imageKey, point);
				}
			}
		},
		[imageKey, onCreatePoint, toImagePoint, tool],
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
			<HStack justify="space-between" align="center">
				<Text fontSize="sm" fontWeight="semibold" color="gray.600">
					{title}
				</Text>
				<HStack spacing={2} minW="190px">
					<Text fontSize="xs" color="gray.500" whiteSpace="nowrap">
						Zoom
					</Text>
					<Input
						type="range"
						min={ZOOM_MIN}
						max={ZOOM_MAX}
						step={0.05}
						value={zoom}
						onChange={(event) => setZoom(clampZoom(Number(event.target.value)))}
						px={0}
						h="24px"
					/>
					<Text fontSize="xs" color="gray.500" minW="40px" textAlign="right">
						{Math.round(zoom * 100)}%
					</Text>
				</HStack>
			</HStack>
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
												r={8}
												fill={
													point.isInlier
														? "rgba(56,161,105,0.92)"
														: "rgba(229,62,62,0.92)"
												}
												stroke="white"
												strokeWidth={1.5}
												style={{
													cursor:
														tool === "move"
															? "grab"
															: tool === "delete"
																? "not-allowed"
																: "crosshair",
												}}
												onPointerDown={(event) => {
													event.preventDefault();
													event.stopPropagation();
													if (tool === "move") {
														setDragPointId(point.id);
														return;
													}
													if (tool === "delete") {
														onDeletePoint(point.id);
													}
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
	const [tool, setTool] = useState<EditorTool>("add");
	const [pendingPair, setPendingPair] = useState<PendingPair>({
		source: null,
		target: null,
	});
	const pendingPairRef = useRef<PendingPair>({ source: null, target: null });
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

	useEffect(() => {
		pendingPairRef.current = pendingPair;
	}, [pendingPair]);

	const addOrUpdatePendingPoint = useCallback(
		(imageKey: "source" | "target", point: PreprocessPoint) => {
			const nextPendingPair = { ...pendingPairRef.current, [imageKey]: point };

			if (!nextPendingPair.source || !nextPendingPair.target) {
				pendingPairRef.current = nextPendingPair;
				setPendingPair(nextPendingPair);
				return;
			}

			const nextControlPoint: AlignmentControlPoint = {
				id: makePointId(),
				source: nextPendingPair.source,
				target: nextPendingPair.target,
			};

			pendingPairRef.current = { source: null, target: null };
			setPendingPair({ source: null, target: null });

			onAlignmentChange((slice) => {
				const hasDuplicatePair = slice.controlPoints.some(
					(existingPoint) =>
						existingPoint.source.x === nextControlPoint.source.x &&
						existingPoint.source.y === nextControlPoint.source.y &&
						existingPoint.target.x === nextControlPoint.target.x &&
						existingPoint.target.y === nextControlPoint.target.y,
				);

				if (hasDuplicatePair) {
					return slice;
				}

				const nextSlice: AlignmentSlice = {
					...slice,
					controlPoints: [...slice.controlPoints, nextControlPoint],
				};
				return resetSolveState(nextSlice);
			});
		},
		[onAlignmentChange, resetSolveState],
	);

	const handleDeletePoint = useCallback(
		(id: string) => {
			onAlignmentChange((slice) => {
				const nextSlice: AlignmentSlice = {
					...slice,
					controlPoints: slice.controlPoints.filter((point) => point.id !== id),
				};
				return resetSolveState(nextSlice);
			});
		},
		[onAlignmentChange, resetSolveState],
	);

	const handleMovePoint = useCallback(
		(id: string, imageKey: "source" | "target", point: PreprocessPoint) => {
			onAlignmentChange((slice) => {
				const nextSlice: AlignmentSlice = {
					...slice,
					controlPoints: slice.controlPoints.map((pair) =>
						pair.id === id
							? {
									...pair,
									[imageKey]: point,
								}
							: pair,
					),
				};
				return resetSolveState(nextSlice);
			});
		},
		[onAlignmentChange, resetSolveState],
	);

	const sourcePoints = useMemo<EditorPoint[]>(
		() =>
			alignment.controlPoints.map((pair, index) => ({
				id: pair.id,
				point: pair.source,
				isInlier: alignment.inlierMask?.[index] ?? true,
			})),
		[alignment.controlPoints, alignment.inlierMask],
	);

	const targetPoints = useMemo<EditorPoint[]>(
		() =>
			alignment.controlPoints.map((pair, index) => ({
				id: pair.id,
				point: pair.target,
				isInlier: alignment.inlierMask?.[index] ?? true,
			})),
		[alignment.controlPoints, alignment.inlierMask],
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

	return (
		<Stack spacing={5}>
			<Stack spacing={2}>
				<Text fontSize="sm" color="gray.600">
					Pair corresponding eosin and H&amp;E landmarks. Solve runs only when
					at least {ALIGNMENT_MIN_PAIRS} pairs exist.
				</Text>
				<HStack spacing={3} wrap="wrap">
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
				</HStack>
				{coverage.warning ? (
					<Text
						fontSize="sm"
						color="orange.600"
						data-testid="alignment-distribution-warning"
					>
						Landmark spread is narrow. Coverage ratios are{" "}
						{formatPercent(coverage.coverageRatioX)} width and{" "}
						{formatPercent(coverage.coverageRatioY)} height, below the{" "}
						{Math.round(ALIGNMENT_COVERAGE_THRESHOLD * 100)}% minimum.
					</Text>
				) : null}
				{runtimeError ? (
					<Text fontSize="sm" color="red.600">
						{runtimeError}
					</Text>
				) : null}
			</Stack>

			<HStack spacing={3} align="center" wrap="wrap">
				<ButtonGroup isAttached size="sm" variant="outline">
					<Button
						onClick={() => setTool("add")}
						colorScheme={tool === "add" ? "brand" : "gray"}
						data-testid="alignment-tool-add"
					>
						Add
					</Button>
					<Button
						onClick={() => setTool("move")}
						colorScheme={tool === "move" ? "brand" : "gray"}
						data-testid="alignment-tool-move"
					>
						Move
					</Button>
					<Button
						onClick={() => setTool("delete")}
						colorScheme={tool === "delete" ? "brand" : "gray"}
						data-testid="alignment-tool-delete"
					>
						Delete
					</Button>
				</ButtonGroup>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => {
						setPendingPair({ source: null, target: null });
						onAlignmentChange((slice) => {
							const nextSlice: AlignmentSlice = {
								...slice,
								controlPoints: slice.controlPoints.slice(0, -1),
							};
							return resetSolveState(nextSlice);
						});
					}}
					isDisabled={alignment.controlPoints.length === 0}
					data-testid="alignment-undo-last-point"
				>
					Undo last point
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => {
						setPendingPair({ source: null, target: null });
						onAlignmentChange((slice) =>
							resetSolveState({
								...slice,
								controlPoints: [],
								inlierMask: null,
							}),
						);
					}}
					isDisabled={alignment.controlPoints.length === 0}
					data-testid="alignment-reset"
				>
					Reset
				</Button>
				<Button
					colorScheme="brand"
					onClick={() => void solveAlignment()}
					isDisabled={!canSolve}
					data-testid="alignment-run-solve"
				>
					Solve alignment
				</Button>
				{alignment.failureReason && !alignment.solveAccepted && (
					<Button
						colorScheme="red"
						variant="outline"
						onClick={() => void solveAlignment(true)}
						isDisabled={!canSolve}
						data-testid="alignment-force-solve"
					>
						Force continue (dangerous)
					</Button>
				)}
			</HStack>

			{alignment.failureReason && !alignment.solveAccepted && (
				<Box
					border="1px solid"
					borderColor="red.200"
					borderRadius="lg"
					p={4}
					bg="red.50"
				>
					<Stack spacing={2}>
						<Text fontSize="sm" fontWeight="semibold" color="red.800">
							Warning: Precision loss risk
						</Text>
						<Text fontSize="sm" color="red.700">
							The alignment quality checks failed ({alignment.failureReason}).
							Using &ldquo;Force continue&rdquo; will skip RANSAC outlier
							detection and compute the transformation using all control points.
							This may result in precision errors and inaccurate alignment. Only
							use this if you understand the risks.
						</Text>
					</Stack>
				</Box>
			)}

			<Stack spacing={3} maxW="320px">
				<Text fontSize="sm" fontWeight="semibold" color="gray.600">
					H&amp;E transform
				</Text>
				<Text fontSize="sm" color="gray.500">
					Display-only transform for the moving image.
				</Text>
				<Stack spacing={1}>
					<Text fontSize="xs" color="gray.500">
						Rotation
					</Text>
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
					<Text fontSize="xs" color="gray.500">
						{alignment.movingImageTransform.rotationDegrees.toFixed(1)}°
					</Text>
				</Stack>
				<Stack spacing={1}>
					<Text fontSize="xs" color="gray.500">
						Scale
					</Text>
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
					<Text fontSize="xs" color="gray.500">
						{(alignment.movingImageTransform.scale * 100).toFixed(0)}%
					</Text>
				</Stack>
				<ButtonGroup size="sm" isAttached variant="outline">
					<Button
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
						Flip horizontal
					</Button>
					<Button
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
					Reset H&amp;E transform
				</Button>
			</Stack>

			<Flex direction={{ base: "column", xl: "row" }} gap={4} align="stretch">
				<LandmarkCanvas
					image={referenceImage}
					imageKey="source"
					imageTransform={DEFAULT_LOCALIZATION_IMAGE_TRANSFORM}
					points={sourcePoints}
					pendingPoint={pendingPair.source}
					title="Eosin landmarks (reference)"
					tool={tool}
					onCreatePoint={addOrUpdatePendingPoint}
					onDeletePoint={handleDeletePoint}
					onMovePoint={handleMovePoint}
					testIdPrefix="alignment-source"
				/>
				<LandmarkCanvas
					image={movingImage}
					imageKey="target"
					imageTransform={alignment.movingImageTransform}
					points={targetPoints}
					pendingPoint={pendingPair.target}
					title="H&E landmarks (moving)"
					tool={tool}
					onCreatePoint={addOrUpdatePendingPoint}
					onDeletePoint={handleDeletePoint}
					onMovePoint={handleMovePoint}
					testIdPrefix="alignment-target"
				/>
			</Flex>

			<Divider />

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
		</Stack>
	);
}
