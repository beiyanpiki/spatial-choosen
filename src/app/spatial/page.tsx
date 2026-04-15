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
	Select,
	Stack,
	Text,
	useToast,
	Wrap,
	WrapItem,
} from "@chakra-ui/react";
import { useRouter, useSearchParams } from "next/navigation";
import polygonClipping from "polygon-clipping";
import {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	computeBaseView as computeBaseViewShared,
	computeZoomTransform as computeZoomTransformShared,
	getTransform as getTransformShared,
	relativeToImage as relativeToImageShared,
} from "@/lib/canvasViewport";
import { buildSpotMatrix, parseChipType } from "@/lib/chip";
import { colorForLabel } from "@/lib/colors";
import {
	getRegionPaths as getRegionPathsShared,
	pointInRegion as pointInRegionShared,
	regionIntersectsRect as regionIntersectsRectShared,
} from "@/lib/geometry";
import { serializeProject } from "@/lib/projectPackage";
import { getProject, upsertProject } from "@/lib/projects";
import type { ChipType, Point, Project, Region, Spot } from "@/types/project";

const formatLabel = (label: number) => `#${label}`;

function SpatialContent() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const toast = useToast();

	const projectId = searchParams.get("project_id");
	const [project, setProject] = useState<Project | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [currentLabel, setCurrentLabel] = useState(1);
	const [isDrawing, setIsDrawing] = useState(false);
	const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
	const [, setCanvasRefresh] = useState(0);
	const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([]);
	const [undoStack, setUndoStack] = useState<Project[]>([]);
	const [redoStack, setRedoStack] = useState<Project[]>([]);
	const [tool, setTool] = useState<"draw" | "edit" | "erase">("draw");
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [isPanning, setIsPanning] = useState(false);
	const [highlightedLabel, setHighlightedLabel] = useState<number | null>(null);
	const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
	const [showHatching, setShowHatching] = useState(true);
	const [isExportingProject, setIsExportingProject] = useState(false);
	const [isExportingResults, setIsExportingResults] = useState(false);

	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const hostRef = useRef<HTMLDivElement | null>(null);
	const loadedImageRef = useRef<HTMLImageElement | null>(null);
	const pathRef = useRef<Point[]>([]);
	const panStartRef = useRef<{ x: number; y: number } | null>(null);
	const [hostRect, setHostRect] = useState<DOMRect | null>(null);

	const ratio =
		project?.imageWidth && project?.imageHeight
			? project.imageWidth / project.imageHeight
			: 4 / 3;

	useEffect(() => {
		if (!project) return;
		const image = new Image();
		image.src = project.imageData;
		image.onload = () => {
			loadedImageRef.current = image;
			setCanvasRefresh((v) => v + 1);
		};
	}, [project]);

	useEffect(() => {
		if (!projectId) return;
		let cancelled = false;
		const run = async () => {
			setIsLoading(true);
			setLoadError(null);
			try {
				const original = await getProject(projectId);
				if (cancelled) return;
				if (!original) {
					setProject(null);
					setLoadError("Project not found in this browser.");
					return;
				}
				setProject(original);
			} catch (error) {
				if (cancelled) return;
				console.error(error);
				setLoadError("Unable to load project from storage.");
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		};
		void run();
		return () => {
			cancelled = true;
		};
	}, [projectId]);

	const persist = useCallback(
		(next: Project, pushHistory = true) => {
			setUndoStack((stack) => {
				if (!pushHistory || !project) return stack;
				return [project, ...stack].slice(0, 50);
			});
			if (pushHistory) {
				setRedoStack([]);
			}
			setProject(next);
			upsertProject(next).catch((error) =>
				console.error("Failed to persist project", error),
			);
		},
		[project],
	);

	const updateRegionLabel = (regionId: string, label: number) => {
		if (!project) return;
		const nextRegions = project.regions.map((r) =>
			r.id === regionId ? { ...r, label, color: colorForLabel(label) } : r,
		);
		persist({ ...project, regions: nextRegions });
	};

	const deleteRegion = (regionId: string) => {
		if (!project) return;
		const nextRegions = project.regions.filter((r) => r.id !== regionId);
		setSelectedRegionIds((ids) => ids.filter((id) => id !== regionId));
		setSelectionAnchor(null);
		persist({ ...project, regions: nextRegions });
	};

	const moveRegion = useCallback(
		(regionId: string, direction: "up" | "down") => {
			if (!project) return;
			const index = project.regions.findIndex((r) => r.id === regionId);
			if (index === -1) return;
			const targetIndex = direction === "up" ? index - 1 : index + 1;
			if (targetIndex < 0 || targetIndex >= project.regions.length) return;

			const nextRegions = [...project.regions];
			const [moved] = nextRegions.splice(index, 1);
			nextRegions.splice(targetIndex, 0, moved);

			persist({ ...project, regions: nextRegions });

			setSelectionAnchor((prev) => {
				if (prev === null) return null;
				if (prev === index) return targetIndex;
				if (direction === "up" && prev >= targetIndex && prev < index)
					return prev + 1;
				if (direction === "down" && prev > index && prev <= targetIndex)
					return prev - 1;
				return prev;
			});
		},
		[persist, project],
	);

	const applyChipType = useCallback(
		(nextType: ChipType | null, pushHistory = true) => {
			if (!project) return;
			if (project.chipFromBundle && project.chipType) return;
			const rect = project.chipRect ?? null;
			let spotMatrix: Spot[][] | undefined;
			if (rect && nextType && project.imageWidth && project.imageHeight) {
				spotMatrix = buildSpotMatrix(
					rect,
					nextType,
					project.imageWidth,
					project.imageHeight,
				);
			}
			persist(
				{ ...project, chipType: nextType, chipRect: rect, spotMatrix },
				pushHistory,
			);
		},
		[persist, project],
	);

	const onPointerPos = useCallback(
		(event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
			const rect = hostRect;
			if (!rect) return null;
			return {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
			};
		},
		[hostRect],
	);

	const computeBaseView = useCallback(
		() => computeBaseViewShared(hostRect, ratio),
		[hostRect, ratio],
	);

	const getTransform = useCallback(
		() => getTransformShared(computeBaseView(), zoom, pan),
		[computeBaseView, pan, zoom],
	);

	const relativeToImage = useCallback(
		(relative: Point | null) => relativeToImageShared(relative, getTransform()),
		[getTransform],
	);

	const screenToImage = useCallback(
		(event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
			const relative = onPointerPos(event);
			return relativeToImage(relative);
		},
		[onPointerPos, relativeToImage],
	);

	const getRegionPaths = useCallback(
		(region: Region) => getRegionPathsShared(region),
		[],
	);

	const pointInRegion = useCallback(
		(point: Point, region: Region) => pointInRegionShared(point, region),
		[],
	);

	const regionIntersectsRect = useCallback(
		(
			region: Region,
			rect: { x: number; y: number; width: number; height: number },
		) => regionIntersectsRectShared(region, rect),
		[],
	);

	const findRegionAtPoint = (point: Point): Region | null => {
		if (!project) return null;
		for (let i = 0; i < project.regions.length; i += 1) {
			const region = project.regions[i];
			if (pointInRegion(point, region)) return region;
		}
		return null;
	};

	const selectRegionByIndex = (
		index: number,
		modifiers: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
	) => {
		if (!project || index < 0 || index >= project.regions.length) return;
		const id = project.regions[index].id;
		const ctrl = modifiers.ctrlKey || modifiers.metaKey;
		const shift = modifiers.shiftKey;

		if (shift && selectionAnchor !== null) {
			const start = Math.min(selectionAnchor, index);
			const end = Math.max(selectionAnchor, index);
			const rangeIds = project.regions.slice(start, end + 1).map((r) => r.id);
			if (ctrl) {
				setSelectedRegionIds((prev) =>
					Array.from(new Set([...prev, ...rangeIds])),
				);
			} else {
				setSelectedRegionIds(rangeIds);
			}
			setSelectionAnchor(index);
			return;
		}

		if (ctrl) {
			setSelectionAnchor(index);
			setSelectedRegionIds((prev) =>
				prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
			);
			return;
		}

		setSelectionAnchor(index);
		setSelectedRegionIds([id]);
	};

	const handleRegionListClick = (
		_regionId: string,
		index: number,
		event: React.MouseEvent<HTMLDivElement>,
	) => {
		setHighlightedLabel(null);
		selectRegionByIndex(index, {
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			shiftKey: event.shiftKey,
		});
	};

	const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
		if (!project) return;

		const isMiddleButton = event.button === 1;
		const point = screenToImage(event);

		if (isMiddleButton) {
			event.preventDefault();
			panStartRef.current = { x: event.clientX, y: event.clientY };
			setIsPanning(true);
			return;
		}

		if (!point) return;

		if (tool === "edit") {
			const hit = findRegionAtPoint(point);
			if (hit) {
				const hitIndex = project.regions.findIndex((r) => r.id === hit.id);
				selectRegionByIndex(hitIndex, {
					ctrlKey: event.ctrlKey,
					metaKey: event.metaKey,
					shiftKey: event.shiftKey,
				});
				setHighlightedLabel(null);
				return;
			}
			panStartRef.current = { x: event.clientX, y: event.clientY };
			setIsPanning(true);
			return;
		}

		if (tool === "erase") {
			if (selectedRegionIds.length === 0) {
				toast({
					title: "Select a region first",
					status: "info",
					duration: 1400,
				});
				return;
			}
			pathRef.current = [point];
			setCurrentPoints([point]);
			setIsDrawing(true);
			return;
		}

		pathRef.current = [point];
		setCurrentPoints([point]);
		setIsDrawing(true);
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
		if (isPanning) {
			if (!panStartRef.current) return;
			const dx = event.clientX - panStartRef.current.x;
			const dy = event.clientY - panStartRef.current.y;
			setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
			panStartRef.current = { x: event.clientX, y: event.clientY };
			return;
		}
		const point = screenToImage(event);
		if (!isDrawing || (tool !== "draw" && tool !== "erase") || !point) return;
		pathRef.current = [...pathRef.current, point];
		setCurrentPoints([...pathRef.current]);
	};

	const commitRegion = useCallback(
		(points: Point[]) => {
			if (!project || points.length < 3) return;
			const region: Region = {
				id:
					typeof crypto !== "undefined" && crypto.randomUUID
						? crypto.randomUUID()
						: `region-${Date.now()}`,
				label: currentLabel,
				color: colorForLabel(currentLabel),
				points,
				paths: [points],
			};
			persist({ ...project, regions: [...project.regions, region] });
			setSelectedRegionIds([region.id]);
			setSelectionAnchor(project.regions.length);
		},
		[currentLabel, persist, project],
	);

	const punchOut = useCallback(
		(erasePath: Point[]) => {
			if (!project || erasePath.length < 3 || selectedRegionIds.length === 0)
				return;
			const eraserPolygon = [
				erasePath.map((p) => [p.x, p.y] as [number, number]),
			];

			const nextRegions: Region[] = [];
			const nextSelected: string[] = [];

			project.regions.forEach((region) => {
				if (!selectedRegionIds.includes(region.id)) {
					nextRegions.push(region);
					return;
				}

				const sourceMulti: [number, number][][][] = [
					getRegionPaths(region).map((ring) =>
						ring.map((p) => [p.x, p.y] as [number, number]),
					),
				];

				const diff = polygonClipping.difference(sourceMulti, [eraserPolygon]);

				if (!diff || diff.length === 0) {
					return; // Fully removed
				}

				diff.forEach((poly, idx) => {
					if (!poly || poly.length === 0) return;
					const outer = poly[0];
					if (!outer || outer.length < 3) return;
					const holes = poly.slice(1);

					const toPoints = (ring: [number, number][]) =>
						ring.map(([x, y]) => ({ x, y }));
					const paths = [toPoints(outer), ...holes.map(toPoints)];
					const id = idx === 0 ? region.id : `${region.id}-${idx}`;
					nextRegions.push({ ...region, id, points: paths[0], paths });
					nextSelected.push(id);
				});
			});

			persist({ ...project, regions: nextRegions });
			setSelectedRegionIds(nextSelected);
			setSelectionAnchor(null);
		},
		[getRegionPaths, persist, project, selectedRegionIds],
	);

	const handlePointerUp = () => {
		if (isPanning) {
			setIsPanning(false);
			panStartRef.current = null;
			return;
		}
		if (!isDrawing || (tool !== "draw" && tool !== "erase")) return;
		setIsDrawing(false);
		if (tool === "erase") {
			punchOut(pathRef.current);
		} else {
			commitRegion(pathRef.current);
		}
		pathRef.current = [];
		setCurrentPoints([]);
	};

	const handleUndo = useCallback(() => {
		setUndoStack((stack) => {
			if (stack.length === 0 || !project) return stack;
			const [previous, ...rest] = stack;
			setRedoStack((redo) => [project, ...redo].slice(0, 50));
			setProject(previous);
			upsertProject(previous).catch((error) => console.error(error));
			setSelectedRegionIds([]);
			setSelectionAnchor(null);
			return rest;
		});
	}, [project]);

	const handleRedo = useCallback(() => {
		setRedoStack((stack) => {
			if (stack.length === 0 || !project) return stack;
			const [nextProj, ...rest] = stack;
			setUndoStack((undo) => [project, ...undo].slice(0, 50));
			setProject(nextProj);
			upsertProject(nextProj).catch((error) => console.error(error));
			setSelectedRegionIds([]);
			setSelectionAnchor(null);
			return rest;
		});
	}, [project]);

	const applyZoom = useCallback(
		(rawZoom: number, anchorNorm?: Point, anchorScreen?: Point) => {
			const next = computeZoomTransformShared(
				computeBaseView(),
				rawZoom,
				anchorNorm,
				anchorScreen,
			);
			if (!next) {
				setZoom(Math.max(0.2, Math.min(20, rawZoom)));
				return;
			}

			setPan(next.pan);
			setZoom(next.zoom);
		},
		[computeBaseView],
	);

	const handleZoomIn = useCallback(
		() => applyZoom(zoom + 0.2),
		[applyZoom, zoom],
	);
	const handleZoomOut = useCallback(
		() => applyZoom(zoom - 0.2),
		[applyZoom, zoom],
	);
	const handleZoomReset = useCallback(() => {
		applyZoom(1);
		setPan({ x: 0, y: 0 });
	}, [applyZoom]);

	const selectedRegions = useMemo(
		() =>
			project?.regions.filter((r) => selectedRegionIds.includes(r.id)) ?? [],
		[project?.regions, selectedRegionIds],
	);

	const matrixMask = useMemo(() => {
		if (
			!project?.matrixData ||
			!project.matrixShape ||
			project.matrixShape.length === 0 ||
			!project.matrixDtype
		) {
			return null;
		}
		const shape = project.matrixShape;
		const rows = shape[shape.length - 2] ?? 0;
		const cols = shape[shape.length - 1] ?? 1;
		if (rows <= 0 || cols <= 0) return null;
		const ctorMap = {
			float32: Float32Array,
			float64: Float64Array,
			int32: Int32Array,
			int16: Int16Array,
			int8: Int8Array,
			uint8: Uint8Array,
			uint16: Uint16Array,
			uint32: Uint32Array,
		} as const;
		const Ctor = ctorMap[project.matrixDtype];
		if (!Ctor) return null;
		const array = new Ctor(project.matrixData);
		if (array.length < rows * cols) return null;
		return { rows, cols, array };
	}, [project?.matrixData, project?.matrixShape, project?.matrixDtype]);

	const spotAssignments = useMemo(() => {
		if (!project?.spotMatrix || project.spotMatrix.length === 0) return null;
		return project.spotMatrix.map((row, rIdx) =>
			row.map((spot, cIdx) => {
				const rect = {
					x: spot.x,
					y: spot.y,
					width: spot.sizeX,
					height: spot.sizeY,
				};

				const maskedOut = (() => {
					if (!matrixMask) return false;
					if (rIdx >= matrixMask.rows || cIdx >= matrixMask.cols) return false;
					const value = matrixMask.array[rIdx * matrixMask.cols + cIdx];
					return value === 0;
				})();

				if (maskedOut) return null;

				for (let i = 0; i < project.regions.length; i += 1) {
					const region = project.regions[i];
					if (regionIntersectsRect(region, rect)) {
						return { regionId: region.id, color: region.color };
					}
				}
				return null;
			}),
		);
	}, [matrixMask, regionIntersectsRect, project?.spotMatrix, project?.regions]);

	// Canvas draw loop
	useEffect(() => {
		const canvas = canvasRef.current;
		const host = hostRef.current;
		const transform = getTransform();
		if (!canvas || !transform || !host || !project) return;

		const dpr = window.devicePixelRatio || 1;
		canvas.style.width = `${transform.rect.width}px`;
		canvas.style.height = `${transform.rect.height}px`;
		canvas.width = transform.rect.width * dpr;
		canvas.height = transform.rect.height * dpr;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		if (loadedImageRef.current) {
			ctx.drawImage(
				loadedImageRef.current,
				transform.originX,
				transform.originY,
				transform.width,
				transform.height,
			);
		}

		const projectToScreen = (pt: Point) => ({
			x: transform.originX + pt.x * transform.width,
			y: transform.originY + pt.y * transform.height,
		});

		const drawChipOverlay = () => {
			if (!project.chipRect) return;
			const { x, y, width, height } = project.chipRect;
			const topLeft = projectToScreen({ x, y });
			const rectWidth = width * transform.width;
			const rectHeight = height * transform.height;

			if (
				project.chipType &&
				project.spotMatrix &&
				project.spotMatrix.length > 0
			) {
				ctx.save();
				ctx.lineWidth = 0.8;
				project.spotMatrix.forEach((row, rIdx) => {
					row.forEach((spot, cIdx) => {
						const maskedOut = (() => {
							if (!matrixMask) return false;
							if (rIdx >= matrixMask.rows || cIdx >= matrixMask.cols)
								return false;
							const value = matrixMask.array[rIdx * matrixMask.cols + cIdx];
							return value === 0;
						})();
						if (maskedOut) return;

						const spotOrigin = projectToScreen({ x: spot.x, y: spot.y });
						const w = spot.sizeX * transform.width;
						const h = spot.sizeY * transform.height;
						const assignment = spotAssignments?.[rIdx]?.[cIdx];
						const fillColor = assignment?.color ?? "#e5e5e5";
						const strokeColor = assignment ? "#1a202c" : "#a0a0a0";
						const fillAlpha = assignment ? 0.35 : 0.2;
						const strokeAlpha = assignment ? 0.55 : 0.35;
						ctx.fillStyle = fillColor;
						ctx.strokeStyle = strokeColor;
						ctx.globalAlpha = fillAlpha;
						ctx.fillRect(spotOrigin.x, spotOrigin.y, w, h);
						ctx.globalAlpha = strokeAlpha;
						ctx.strokeRect(spotOrigin.x, spotOrigin.y, w, h);
					});
				});
				ctx.restore();
			}

			ctx.save();
			ctx.lineWidth = 2;
			ctx.strokeStyle = "#000000";
			ctx.strokeRect(topLeft.x, topLeft.y, rectWidth, rectHeight);
			ctx.restore();
		};

		const buildPath = (paths: Point[][]) => {
			ctx.beginPath();
			paths.forEach((ring) => {
				if (ring.length < 2) return;
				const mapped = ring.map(projectToScreen);
				ctx.moveTo(mapped[0].x, mapped[0].y);
				for (let i = 1; i < mapped.length; i += 1) {
					ctx.lineTo(mapped[i].x, mapped[i].y);
				}
				ctx.closePath();
			});
		};

		const drawRegion = (region: Region, isSelected: boolean) => {
			const paths = getRegionPaths(region);
			if (paths.length === 0) return;
			buildPath(paths);

			ctx.lineWidth = isSelected ? 3 : 2;
			ctx.strokeStyle = isSelected ? "#1a202c" : region.color;
			ctx.globalAlpha = isSelected ? 1 : 0.85;
			ctx.stroke();

			ctx.fillStyle = region.color;
			ctx.globalAlpha = isSelected ? 0.18 : 0.1;
			ctx.fill("evenodd");

			if (showHatching) {
				const outer = paths[0].map(projectToScreen);
				const xs = outer.map((p) => p.x);
				const ys = outer.map((p) => p.y);
				const minX = Math.min(...xs);
				const maxX = Math.max(...xs);
				const minY = Math.min(...ys);
				const maxY = Math.max(...ys);
				const height = maxY - minY;

				ctx.save();
				buildPath(paths);
				ctx.clip("evenodd");
				ctx.globalAlpha = isSelected ? 0.5 : 0.35;
				ctx.strokeStyle = region.color;
				ctx.lineWidth = 1.5;

				for (let x = minX - height; x <= maxX + height; x += 10) {
					ctx.beginPath();
					ctx.moveTo(x, minY);
					ctx.lineTo(x + height, maxY);
					ctx.stroke();
				}

				ctx.restore();
			}
			ctx.globalAlpha = 1;
		};

		const drawPathPreview = (pts: Point[], color: string) => {
			if (pts.length < 2) return;
			const mapped = pts.map(projectToScreen);
			ctx.beginPath();
			ctx.moveTo(mapped[0].x, mapped[0].y);
			for (let i = 1; i < mapped.length; i += 1) {
				ctx.lineTo(mapped[i].x, mapped[i].y);
			}
			ctx.closePath();

			ctx.lineWidth = 2;
			ctx.strokeStyle = color;
			ctx.globalAlpha = 0.9;
			ctx.setLineDash(tool === "erase" ? [8, 6] : []);
			ctx.stroke();
			ctx.setLineDash([]);

			ctx.fillStyle = color;
			ctx.globalAlpha = tool === "erase" ? 0.08 : 0.12;
			ctx.fill();
			ctx.globalAlpha = 1;
		};

		drawChipOverlay();

		[...project.regions].reverse().forEach((region) => {
			drawRegion(
				region,
				selectedRegionIds.includes(region.id) ||
					(highlightedLabel !== null && region.label === highlightedLabel),
			);
		});
		if (currentPoints.length > 1) {
			const previewColor =
				tool === "erase" ? "#2d3748" : colorForLabel(currentLabel);
			drawPathPreview(currentPoints, previewColor);
		}
	}, [
		project,
		project?.imageData,
		currentPoints,
		currentLabel,
		selectedRegionIds,
		highlightedLabel,
		showHatching,
		getTransform,
		spotAssignments,
		tool,
		getRegionPaths,
		matrixMask,
	]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host || typeof ResizeObserver === "undefined") return undefined;
		const syncRect = () => setHostRect(host.getBoundingClientRect());
		syncRect();
		const observer = new ResizeObserver(() => {
			syncRect();
			setCanvasRefresh((v) => v + 1);
		});
		observer.observe(host);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const onResize = () => {
			const host = hostRef.current;
			if (host) setHostRect(host.getBoundingClientRect());
			setCanvasRefresh((v) => v + 1);
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	useEffect(() => {
		if (project) {
			const host = hostRef.current;
			if (host) {
				setHostRect(host.getBoundingClientRect());
				setCanvasRefresh((v) => v + 1);
			}
		}
	}, [project]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return undefined;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = hostRect;
			if (!rect) return;
			const relative: Point = {
				x: e.clientX - rect.left,
				y: e.clientY - rect.top,
			};
			const norm = relativeToImage(relative);
			const next = zoom + (e.deltaY > 0 ? -0.2 : 0.2);
			applyZoom(next, norm ?? undefined, norm ? relative : undefined);
		};
		host.addEventListener("wheel", onWheel, { passive: false });
		return () => host.removeEventListener("wheel", onWheel);
	}, [applyZoom, hostRect, relativeToImage, zoom]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
			const key = e.key.toLowerCase();
			if (key === "z" && !e.shiftKey) {
				e.preventDefault();
				handleUndo();
			} else if (key === "y" || (key === "z" && e.shiftKey)) {
				e.preventDefault();
				handleRedo();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [handleRedo, handleUndo]);

	const existingLabels = useMemo(() => {
		if (!project) return [] as number[];
		return Array.from(new Set(project.regions.map((r) => r.label))).sort(
			(a, b) => a - b,
		);
	}, [project]);

	const labelOptions = useMemo(() => {
		const labels = new Set(existingLabels);
		labels.add(currentLabel);
		return Array.from(labels).sort((a, b) => a - b);
	}, [currentLabel, existingLabels]);

	const nextLabelValue = useMemo(() => {
		let candidate = 1;
		const existing = new Set(existingLabels);
		while (existing.has(candidate)) {
			candidate += 1;
		}
		return candidate;
	}, [existingLabels]);

	const chipRectInfo = useMemo(() => {
		if (!project?.chipRect || !project.imageWidth || !project.imageHeight)
			return null;
		return {
			x: Math.round(project.chipRect.x * project.imageWidth),
			y: Math.round(project.chipRect.y * project.imageHeight),
			width: Math.round(project.chipRect.width * project.imageWidth),
			height: Math.round(project.chipRect.height * project.imageHeight),
		};
	}, [project?.chipRect, project?.imageHeight, project?.imageWidth]);

	const spotGridSize = useMemo(() => {
		if (!project?.spotMatrix || project.spotMatrix.length === 0) return null;
		return {
			rows: project.spotMatrix.length,
			cols: project.spotMatrix[0]?.length ?? 0,
		};
	}, [project?.spotMatrix]);

	const cursor = useMemo(() => {
		if (isPanning) return "grabbing";
		if (tool === "edit") return "pointer";
		return "crosshair";
	}, [isPanning, tool]);

	const handleSaveProject = async () => {
		if (!project) return;
		try {
			await upsertProject(project);
			toast({
				title: "Project saved locally",
				status: "success",
				duration: 2000,
			});
		} catch (error) {
			console.error(error);
			toast({
				title: "Save failed",
				description: "Could not write to storage",
				status: "error",
			});
		}
	};

	const buildLabeledMatrixCsv = () => {
		if (!project || !project.spotMatrix || project.spotMatrix.length === 0)
			return null;
		const rows = project.spotMatrix.length;
		const cols = project.spotMatrix[0]?.length ?? 0;
		const lines: string[] = [];

		for (let r = 0; r < rows; r += 1) {
			const row = project.spotMatrix[r];
			const values: (number | "")[] = [];
			for (let c = 0; c < cols; c += 1) {
				const spot = row[c];

				// mask: 0 -> always empty
				const maskedOut = (() => {
					if (!matrixMask) return false;
					if (r >= matrixMask.rows || c >= matrixMask.cols) return false;
					const value = matrixMask.array[r * matrixMask.cols + c];
					return value === 0;
				})();
				if (maskedOut) {
					values.push(0);
					continue;
				}

				const rect = {
					x: spot.x,
					y: spot.y,
					width: spot.sizeX,
					height: spot.sizeY,
				};
				let label: number | "" = "";
				for (let i = 0; i < project.regions.length; i += 1) {
					const region = project.regions[i];
					if (regionIntersectsRect(region, rect)) {
						label = region.label;
						break;
					}
				}
				values.push(label === "" ? 0 : label);
			}
			lines.push(values.map((v) => String(v)).join(","));
		}

		return lines.join("\n");
	};

	const handleExportProject = async () => {
		if (!project) return;
		setIsExportingProject(true);
		try {
			let exportSource = project;
			if (!project.matrixData) {
				const hydrated = await getProject(project.id);
				if (hydrated?.matrixData) {
					exportSource = { ...project, matrixData: hydrated.matrixData };
				}
			}
			const blob = await serializeProject(exportSource);
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `${project.name || "project"}.spatialproj`;
			link.click();
			URL.revokeObjectURL(url);

			const sizeKb = Math.max(1, Math.round(blob.size / 1024));
			toast({
				title: "Project exported",
				description: `${sizeKb} KB saved locally as .spatialproj`,
				status: "success",
				duration: 2000,
			});
		} catch (error) {
			console.error(error);
			toast({
				title: "Export failed",
				description:
					error instanceof Error ? error.message : "Could not export project",
				status: "error",
			});
		} finally {
			setIsExportingProject(false);
		}
	};

	const handleExportResults = async () => {
		if (!project) return;
		const csv = buildLabeledMatrixCsv();
		if (!csv) {
			toast({
				title: "No results to export",
				description: "Generate a labeled matrix before exporting results.",
				status: "info",
			});
			return;
		}

		setIsExportingResults(true);
		try {
			const csvBlob = new Blob([csv], { type: "text/csv" });
			const csvUrl = URL.createObjectURL(csvBlob);
			const csvLink = document.createElement("a");
			csvLink.href = csvUrl;
			csvLink.download = `${project.name || "project"}-labels.csv`;
			csvLink.click();
			URL.revokeObjectURL(csvUrl);

			toast({
				title: "Results exported",
				description: "Labeled matrix saved as CSV.",
				status: "success",
				duration: 2000,
			});
		} catch (error) {
			console.error(error);
			toast({
				title: "Export failed",
				description:
					error instanceof Error ? error.message : "Could not export results",
				status: "error",
			});
		} finally {
			setIsExportingResults(false);
		}
	};

	const handleExitProject = () => router.push("/");

	if (!projectId) {
		return (
			<Box p={10}>
				<Heading size="md">Missing project id</Heading>
				<Text mt={2}>Navigate from the home page.</Text>
			</Box>
		);
	}

	if (loadError) {
		return (
			<Box p={10}>
				<Heading size="md" mb={3}>
					{loadError}
				</Heading>
				<Button colorScheme="brand" onClick={() => router.push("/")}>
					Back to home
				</Button>
			</Box>
		);
	}

	if (!project || isLoading) {
		return (
			<Box p={10}>
				<Heading size="md">Loading project…</Heading>
			</Box>
		);
	}

	return (
		<Flex h="100vh" bg="gray.50">
			<Box
				width={{ base: "100%", md: "360px" }}
				bg="white"
				p={6}
				borderRight="1px solid"
				borderColor="gray.100"
				display="flex"
				flexDirection="column"
				minH="0"
			>
				<Stack spacing={5} flex="1" overflowY="auto" pr={1}>
					<Box>
						<Heading size="md" mb={1}>
							Project
						</Heading>
						<Text fontSize="sm" color="gray.500">
							Edit metadata and keep everything local.
						</Text>
					</Box>

					<Stack spacing={2}>
						<Text fontWeight="semibold" fontSize="sm">
							Name
						</Text>
						<Input
							value={project.name}
							onChange={(e) => persist({ ...project, name: e.target.value })}
						/>
					</Stack>

					<Stack spacing={2}>
						<Text fontWeight="semibold" fontSize="sm">
							Project ID
						</Text>
						<Input value={project.id} isReadOnly fontFamily="mono" />
					</Stack>

					<Stack spacing={3}>
						<Heading size="sm">Chip config</Heading>
						<Stack spacing={2}>
							<Text fontWeight="semibold" fontSize="sm">
								Chip type
							</Text>
							<Select
								size="sm"
								value={project.chipType ?? ""}
								onChange={(e) => applyChipType(parseChipType(e.target.value))}
								isDisabled={Boolean(project.chipFromBundle && project.chipType)}
							>
								<option value="">None</option>
								<option value="50um">50 µm</option>
								<option value="15um">15 µm</option>
							</Select>
							{!(project.chipFromBundle && project.chipType) && (
								<Text fontSize="xs" color="gray.500">
									{project.chipType
										? "Change to regenerate spot layout instantly."
										: "When type is empty, spots stay hidden until you pick one."}
								</Text>
							)}
						</Stack>

						{chipRectInfo ? (
							<Text fontSize="sm" color="gray.600">
								Area: {chipRectInfo.width} × {chipRectInfo.height}px at (
								{chipRectInfo.x}, {chipRectInfo.y})
							</Text>
						) : (
							<Text fontSize="sm" color="gray.500">
								No chip rectangle loaded.
							</Text>
						)}

						{project.chipType && spotGridSize ? (
							<Text fontSize="sm" color="gray.600">
								Spot grid: {spotGridSize.cols} × {spotGridSize.rows} (
								{project.chipType})
							</Text>
						) : (
							<Text fontSize="sm" color="gray.500">
								Spots render after both config and chip type are set.
							</Text>
						)}
					</Stack>

					<Stack spacing={3}>
						<Heading size="sm">Regions</Heading>
						{project.regions.length === 0 && (
							<Text fontSize="sm" color="gray.500">
								No regions yet. Draw on the canvas to add.
							</Text>
						)}
						{project.regions.map((region, idx) => (
							<Flex
								key={region.id}
								align="center"
								gap={3}
								p={3}
								borderRadius="md"
								border="1px solid"
								borderColor={
									selectedRegionIds.includes(region.id)
										? "brand.400"
										: "gray.100"
								}
								bg={
									selectedRegionIds.includes(region.id) ? "brand.50" : "white"
								}
								cursor="pointer"
								flexWrap="wrap"
								onClick={(e) => handleRegionListClick(region.id, idx, e)}
							>
								<Badge
									bg={region.color}
									color="white"
									minW="40px"
									textAlign="center"
								>
									{formatLabel(region.label)}
								</Badge>
								<Select
									size="sm"
									value={String(region.label)}
									maxW="140px"
									onChange={(e) => {
										const parsed = Number(e.target.value);
										if (!Number.isFinite(parsed)) return;
										updateRegionLabel(region.id, parsed);
										setCurrentLabel(parsed);
										setHighlightedLabel(null);
									}}
								>
									{existingLabels.map((label) => (
										<option key={label} value={String(label)}>
											{formatLabel(label)}
										</option>
									))}
									{existingLabels.includes(nextLabelValue) ? null : (
										<option value={String(nextLabelValue)}>
											+ New ({formatLabel(nextLabelValue)})
										</option>
									)}
								</Select>
								<ButtonGroup size="xs" variant="ghost" spacing={1}>
									<Button
										isDisabled={idx === 0}
										onClick={(e) => {
											e.stopPropagation();
											moveRegion(region.id, "up");
										}}
									>
										Up
									</Button>
									<Button
										isDisabled={idx === project.regions.length - 1}
										onClick={(e) => {
											e.stopPropagation();
											moveRegion(region.id, "down");
										}}
									>
										Down
									</Button>
								</ButtonGroup>
								<Button
									size="xs"
									colorScheme="red"
									variant="outline"
									onClick={(e) => {
										e.stopPropagation();
										deleteRegion(region.id);
									}}
								>
									Delete
								</Button>
							</Flex>
						))}
					</Stack>
				</Stack>

				<Text
					textAlign="center"
					fontSize="sm"
					color="gray.600"
					mt="auto"
					py={1}
				>
					@M20 Genomics
				</Text>
			</Box>

			<Box
				flex="1"
				p={{ base: 4, md: 6 }}
				display="flex"
				flexDirection="column"
				minH="0"
				minW="0"
				overflow="hidden"
			>
				<Stack spacing={3} mb={2} flexShrink={0}>
					<Flex align="center" justify="space-between" gap={3} flexWrap="wrap">
						<Heading size="md">Annotate</Heading>
						<HStack spacing={2}>
							<Button size="sm" variant="outline" onClick={handleSaveProject}>
								Save project
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={handleExportResults}
								isLoading={isExportingResults}
							>
								Export results
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={handleExportProject}
								isLoading={isExportingProject}
							>
								Export project
							</Button>
							<Button
								size="sm"
								colorScheme="red"
								variant="outline"
								onClick={handleExitProject}
							>
								Exit
							</Button>
						</HStack>
					</Flex>

					<HStack spacing={3} align="center">
						<Text fontWeight="medium">Selected regions</Text>
						{selectedRegions.length === 0 && (
							<Badge bg="gray.200" color="gray.600">
								None
							</Badge>
						)}
						{selectedRegions.length === 1 && (
							<HStack spacing={2}>
								<Badge bg={selectedRegions[0].color} color="white">
									{formatLabel(selectedRegions[0].label)}
								</Badge>
								<Text fontSize="xs" color="gray.500">
									ID: {selectedRegions[0].id}
								</Text>
							</HStack>
						)}
						{selectedRegions.length > 1 && (
							<Badge bg="gray.700" color="white">
								{selectedRegions.length} selected
							</Badge>
						)}
					</HStack>

					<Stack
						spacing={2}
						flexWrap="wrap"
						direction={{ base: "column", lg: "row" }}
					>
						<HStack spacing={2} flexWrap="wrap">
							<ButtonGroup size="sm" isAttached variant="outline">
								<Button
									onClick={handleUndo}
									isDisabled={undoStack.length === 0}
								>
									Undo
								</Button>
								<Button
									onClick={handleRedo}
									isDisabled={redoStack.length === 0}
								>
									Redo
								</Button>
								<Button
									onClick={() => {
										if (!project) return;
										const remove = new Set(selectedRegionIds);
										const nextRegions = project.regions.filter(
											(r) => !remove.has(r.id),
										);
										if (nextRegions.length === project.regions.length) return;
										persist({ ...project, regions: nextRegions });
										setSelectedRegionIds([]);
										setSelectionAnchor(null);
									}}
									isDisabled={selectedRegionIds.length === 0}
									colorScheme="red"
								>
									Delete selected
								</Button>
							</ButtonGroup>

							<ButtonGroup size="sm" isAttached variant="outline">
								<Button onClick={handleZoomIn}>Zoom +</Button>
								<Button onClick={handleZoomOut}>Zoom -</Button>
								<Button onClick={handleZoomReset}>Reset</Button>
							</ButtonGroup>
							<ButtonGroup size="sm" isAttached variant="outline">
								<Button
									variant={tool === "edit" ? "solid" : "outline"}
									colorScheme="brand"
									onClick={() => setTool("edit")}
								>
									Select / Move
								</Button>
								<Button
									variant={tool === "draw" ? "solid" : "outline"}
									colorScheme="brand"
									onClick={() => setTool("draw")}
								>
									Draw
								</Button>
								<Button
									variant={tool === "erase" ? "solid" : "outline"}
									colorScheme="red"
									isDisabled={selectedRegionIds.length === 0}
									onClick={() => setTool("erase")}
								>
									Punch Out
								</Button>
							</ButtonGroup>
							<Badge variant="subtle" colorScheme="gray">
								Zoom {zoom.toFixed(1)}×
							</Badge>
						</HStack>

						<HStack spacing={3} align="center" flexWrap="wrap">
							<Text fontWeight="medium">Drawing label</Text>
							<Badge
								bg={colorForLabel(currentLabel)}
								color="white"
								px={3}
								py={1}
								borderRadius="md"
							>
								{formatLabel(currentLabel)}
							</Badge>
							<Text fontSize="sm" color="gray.500">
								Existing
							</Text>
							<Wrap spacing={2} align="center">
								{labelOptions.map((label) => (
									<WrapItem key={label}>
										<Badge
											px={3}
											py={1}
											borderRadius="md"
											cursor="pointer"
											bg={colorForLabel(label)}
											color="white"
											border={
												label === currentLabel ? "2px solid #1a202c" : "none"
											}
											onClick={() => {
												setCurrentLabel(label);
												setHighlightedLabel((prev) =>
													prev === label ? null : label,
												);
											}}
										>
											{formatLabel(label)}
										</Badge>
									</WrapItem>
								))}
								<WrapItem>
									<Badge
										px={3}
										py={1}
										borderRadius="md"
										cursor="pointer"
										bg="gray.200"
										color="gray.700"
										border="1px dashed"
										borderColor="gray.400"
										onClick={() => setCurrentLabel(nextLabelValue)}
									>
										+ New
									</Badge>
								</WrapItem>
							</Wrap>
							<Button
								size="sm"
								variant={showHatching ? "solid" : "outline"}
								colorScheme={showHatching ? "brand" : "gray"}
								ml="auto"
								onClick={() => setShowHatching((v) => !v)}
							>
								{showHatching ? "Hatching On" : "Hatching Off"}
							</Button>
						</HStack>
					</Stack>

					<Text fontSize="sm" color="gray.500">
						Zoom or scroll to inspect, drag empty space in Select/Move to pan,
						click to select, or switch to Draw to add a closed shape. Undo/Redo
						are also mapped to Ctrl/Cmd+Z / Ctrl/Cmd+Y.
					</Text>
				</Stack>

				<Box
					borderRadius="lg"
					overflow="hidden"
					boxShadow="md"
					bg="white"
					border="1px solid"
					borderColor="gray.100"
					flex="1"
					minH="0"
				>
					<Box
						position="relative"
						ref={hostRef}
						width="100%"
						height="100%"
						overflow="hidden"
					>
						<canvas
							ref={canvasRef}
							style={{
								position: "absolute",
								inset: 0,
								width: "100%",
								height: "100%",
								cursor,
							}}
							onPointerDown={handlePointerDown}
							onPointerMove={handlePointerMove}
							onPointerUp={handlePointerUp}
							onPointerLeave={handlePointerUp}
						/>
					</Box>
				</Box>
			</Box>
		</Flex>
	);
}

export default function SpatialPage() {
	return (
		<Suspense
			fallback={
				<Box p={10}>
					<Heading size="md">Loading…</Heading>
				</Box>
			}
		>
			<SpatialContent />
		</Suspense>
	);
}
