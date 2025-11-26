'use client';

import {
  Badge,
  Box,
  Button,
  ButtonGroup,
  Flex,
  Heading,
  HStack,
  Input,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Stack,
  Select,
  Text,
  Wrap,
  WrapItem,
  useToast,
} from '@chakra-ui/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { colorForLabel } from '@/lib/colors';
import { getProject, upsertProject } from '@/lib/projects';
import { Point, Project, Region } from '@/types/project';

const formatLabel = (label: number) => `#${label}`;

function SpatialContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const toast = useToast();

  const projectId = searchParams.get('project_id');
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentLabel, setCurrentLabel] = useState(1);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [canvasRefresh, setCanvasRefresh] = useState(0);
  const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([]);
  const [undoStack, setUndoStack] = useState<Project[]>([]);
  const [redoStack, setRedoStack] = useState<Project[]>([]);
  const [tool, setTool] = useState<'draw' | 'edit'>('draw');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [highlightedLabel, setHighlightedLabel] = useState<number | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [showHatching, setShowHatching] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const pathRef = useRef<Point[]>([]);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const [hostRect, setHostRect] = useState<DOMRect | null>(null);

  const ratio = project?.imageWidth && project?.imageHeight
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
  }, [project?.imageData]);

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
          setLoadError('Project not found in this browser.');
          return;
        }
        setProject(original);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setLoadError('Unable to load project from storage.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
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
      upsertProject(next).catch((error) => console.error('Failed to persist project', error));
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

  const onPointerPos = useCallback((event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const rect = hostRect;
    if (!rect) return null;
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, [hostRect]);

  const computeBaseView = useCallback(() => {
    const rect = hostRect;
    if (!rect) return null;
    let viewWidth = rect.width;
    let viewHeight = viewWidth / ratio;
    if (viewHeight > rect.height) {
      viewHeight = rect.height;
      viewWidth = viewHeight * ratio;
    }
    const viewX = (rect.width - viewWidth) / 2;
    const viewY = (rect.height - viewHeight) / 2;
    return { rect, viewWidth, viewHeight, viewX, viewY };
  }, [hostRect, ratio]);

  const getTransform = useCallback(() => {
    const base = computeBaseView();
    if (!base) return null;
    const scaledWidth = base.viewWidth * zoom;
    const scaledHeight = base.viewHeight * zoom;
    const originX = base.viewX + pan.x + (base.viewWidth - scaledWidth) / 2;
    const originY = base.viewY + pan.y + (base.viewHeight - scaledHeight) / 2;
    return {
      ...base,
      originX,
      originY,
      width: scaledWidth,
      height: scaledHeight,
    };
  }, [computeBaseView, pan.x, pan.y, zoom]);

  const relativeToImage = useCallback((relative: Point | null) => {
    const transform = getTransform();
    if (!transform || !relative) return null;
    const x = (relative.x - transform.originX) / transform.width;
    const y = (relative.y - transform.originY) / transform.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }, [getTransform]);

  const screenToImage = useCallback((event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const relative = onPointerPos(event);
    return relativeToImage(relative);
  }, [onPointerPos, relativeToImage]);

  const pointInPolygon = (point: Point, polygon: Point[]) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      const intersect = yi > point.y !== yj > point.y
        && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const findRegionAtPoint = (point: Point): Region | null => {
    if (!project) return null;
    for (let i = project.regions.length - 1; i >= 0; i -= 1) {
      const region = project.regions[i];
      if (pointInPolygon(point, region.points)) return region;
    }
    return null;
  };

  const selectRegionByIndex = (index: number, modifiers: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (!project || index < 0 || index >= project.regions.length) return;
    const id = project.regions[index].id;
    const ctrl = modifiers.ctrlKey || modifiers.metaKey;
    const shift = modifiers.shiftKey;

    if (shift && selectionAnchor !== null) {
      const start = Math.min(selectionAnchor, index);
      const end = Math.max(selectionAnchor, index);
      const rangeIds = project.regions.slice(start, end + 1).map((r) => r.id);
      if (ctrl) {
        setSelectedRegionIds((prev) => Array.from(new Set([...prev, ...rangeIds])));
      } else {
        setSelectedRegionIds(rangeIds);
      }
      setSelectionAnchor(index);
      return;
    }

    if (ctrl) {
      setSelectionAnchor(index);
      setSelectedRegionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
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

    if (tool === 'edit') {
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
    if (!isDrawing || tool !== 'draw' || !point) return;
    pathRef.current = [...pathRef.current, point];
    setCurrentPoints([...pathRef.current]);
  };

  const commitRegion = useCallback(
    (points: Point[]) => {
    if (!project || points.length < 3) return;
    const region: Region = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `region-${Date.now()}`,
      label: currentLabel,
      color: colorForLabel(currentLabel),
      points,
    };
    persist({ ...project, regions: [...project.regions, region] });
    setSelectedRegionIds([region.id]);
    setSelectionAnchor(project.regions.length);
  },
  [currentLabel, persist, project],
);

  const handlePointerUp = () => {
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
      return;
    }
    if (!isDrawing || tool !== 'draw') return;
    setIsDrawing(false);
    commitRegion(pathRef.current);
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

  const applyZoom = useCallback((rawZoom: number, anchorNorm?: Point, anchorScreen?: Point) => {
    const nextZoom = Math.max(0.2, Math.min(20, rawZoom));
    const base = computeBaseView();
    if (!base) {
      setZoom(nextZoom);
      return;
    }

    const width = base.viewWidth * nextZoom;
    const height = base.viewHeight * nextZoom;
    const oxNoPan = base.viewX + (base.viewWidth - width) / 2;
    const oyNoPan = base.viewY + (base.viewHeight - height) / 2;

    const hasAnchor = Boolean(anchorNorm && anchorScreen);
    const pivotNorm = hasAnchor ? (anchorNorm as Point) : { x: 0.5, y: 0.5 };
    const pivotScreen = hasAnchor
      ? (anchorScreen as Point)
      : {
          x: base.viewX + base.viewWidth / 2,
          y: base.viewY + base.viewHeight / 2,
        };

    const nextPan = {
      x: pivotScreen.x - (oxNoPan + pivotNorm.x * width),
      y: pivotScreen.y - (oyNoPan + pivotNorm.y * height),
    };

    setPan(nextPan);
    setZoom(nextZoom);
  }, [computeBaseView]);

  const handleZoomIn = useCallback(() => applyZoom(zoom + 0.2), [applyZoom, zoom]);
  const handleZoomOut = useCallback(() => applyZoom(zoom - 0.2), [applyZoom, zoom]);
  const handleZoomReset = useCallback(() => {
    applyZoom(1);
    setPan({ x: 0, y: 0 });
  }, [applyZoom]);

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

    const ctx = canvas.getContext('2d');
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

    const drawPath = (pts: Point[], color: string, isSelected: boolean) => {
      if (pts.length < 2) return;
      const mapped = pts.map(projectToScreen);
      ctx.beginPath();
      ctx.moveTo(mapped[0].x, mapped[0].y);
      for (let i = 1; i < mapped.length; i += 1) {
        ctx.lineTo(mapped[i].x, mapped[i].y);
      }
      ctx.closePath();

      // Outline
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.strokeStyle = isSelected ? '#1a202c' : color;
      ctx.globalAlpha = isSelected ? 1 : 0.85;
      ctx.stroke();

      // Soft base fill
      ctx.fillStyle = color;
      ctx.globalAlpha = isSelected ? 0.18 : 0.1;
      ctx.fill();

      if (showHatching) {
        // Hatched highlight with same color
        const xs = mapped.map((p) => p.x);
        const ys = mapped.map((p) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const height = maxY - minY;

        ctx.save();
        ctx.clip();
        ctx.globalAlpha = isSelected ? 0.5 : 0.35;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;

        // Draw 45° stripes spaced every 10px
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

    project.regions.forEach((region) =>
      drawPath(
        region.points,
        region.color,
        selectedRegionIds.includes(region.id)
          || (highlightedLabel !== null && region.label === highlightedLabel),
      ));
    if (currentPoints.length > 1) {
      drawPath(currentPoints, colorForLabel(currentLabel), false);
    }
  }, [project, project?.imageData, currentPoints, currentLabel, canvasRefresh, selectedRegionIds, highlightedLabel, showHatching, getTransform]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return undefined;
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
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
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
      const relative: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const norm = relativeToImage(relative);
      const next = zoom + (e.deltaY > 0 ? -0.2 : 0.2);
      applyZoom(next, norm ?? undefined, norm ? relative : undefined);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [applyZoom, hostRect, relativeToImage, zoom]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRedo, handleUndo]);

  const existingLabels = useMemo(() => {
    if (!project) return [] as number[];
    return Array.from(new Set(project.regions.map((r) => r.label))).sort((a, b) => a - b);
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

  const selectedRegions = useMemo(
    () => project?.regions.filter((r) => selectedRegionIds.includes(r.id)) ?? [],
    [project?.regions, selectedRegionIds],
  );

  const cursor = useMemo(() => {
    if (isPanning) return 'grabbing';
    if (tool === 'edit') return 'pointer';
    return 'crosshair';
  }, [isPanning, tool]);

  const transform = getTransform();

  const handleSaveProject = async () => {
    if (!project) return;
    try {
      await upsertProject(project);
      toast({ title: 'Project saved locally', status: 'success', duration: 2000 });
    } catch (error) {
      console.error(error);
      toast({ title: 'Save failed', description: 'Could not write to storage', status: 'error' });
    }
  };

  const handleExportProject = () => {
    if (!project) return;
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.name || 'project'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExitProject = () => router.push('/');

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
        <Heading size="md" mb={3}>{loadError}</Heading>
        <Button colorScheme="brand" onClick={() => router.push('/')}>Back to home</Button>
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
        width={{ base: '100%', md: '360px' }}
        bg="white"
        p={6}
        borderRight="1px solid"
        borderColor="gray.100"
        overflowY="auto"
      >
        <Stack spacing={5}>
          <Box>
            <Heading size="md" mb={1}>Project</Heading>
            <Text fontSize="sm" color="gray.500">Edit metadata and keep everything local.</Text>
          </Box>

          <Stack spacing={2}>
            <Text fontWeight="semibold" fontSize="sm">Name</Text>
            <Input
              value={project.name}
              onChange={(e) => persist({ ...project, name: e.target.value })}
            />
          </Stack>

          <Stack spacing={2}>
            <Text fontWeight="semibold" fontSize="sm">Project ID</Text>
            <Input value={project.id} isReadOnly fontFamily="mono" />
          </Stack>

          <Stack direction="row" spacing={3}>
            <Stack flex="1" spacing={2}>
              <Text fontWeight="semibold" fontSize="sm">Chip Width (µm)</Text>
              <NumberInput
                min={0}
                value={project.chipWidth ?? ''}
                onChange={(value) => {
                  const parsed = Number(value);
                  persist({ ...project, chipWidth: Number.isFinite(parsed) ? parsed : undefined });
                }}
              >
                <NumberInputField />
                <NumberInputStepper>
                  <NumberIncrementStepper />
                  <NumberDecrementStepper />
                </NumberInputStepper>
              </NumberInput>
            </Stack>
            <Stack flex="1" spacing={2}>
              <Text fontWeight="semibold" fontSize="sm">Chip Height (µm)</Text>
              <NumberInput
                min={0}
                value={project.chipHeight ?? ''}
                onChange={(value) => {
                  const parsed = Number(value);
                  persist({ ...project, chipHeight: Number.isFinite(parsed) ? parsed : undefined });
                }}
              >
                <NumberInputField />
                <NumberInputStepper>
                  <NumberIncrementStepper />
                  <NumberDecrementStepper />
                </NumberInputStepper>
              </NumberInput>
            </Stack>
          </Stack>

          <Stack spacing={3}>
            <Heading size="sm">Regions</Heading>
            {project.regions.length === 0 && (
              <Text fontSize="sm" color="gray.500">No regions yet. Draw on the canvas to add.</Text>
            )}
            {project.regions.map((region, idx) => (
              <Flex
                key={region.id}
                align="center"
                gap={3}
                p={3}
                borderRadius="md"
                border="1px solid"
                borderColor={selectedRegionIds.includes(region.id) ? 'brand.400' : 'gray.100'}
                bg={selectedRegionIds.includes(region.id) ? 'brand.50' : 'white'}
                cursor="pointer"
                flexWrap="wrap"
                onClick={(e) => handleRegionListClick(region.id, idx, e)}
              >
                <Badge bg={region.color} color="white" minW="40px" textAlign="center">
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
                    <option key={label} value={String(label)}>{formatLabel(label)}</option>
                  ))}
                  {existingLabels.includes(nextLabelValue) ? null : (
                    <option value={String(nextLabelValue)}>+ New ({formatLabel(nextLabelValue)})</option>
                  )}
                </Select>
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
      </Box>

      <Box flex="1" p={{ base: 4, md: 6 }} display="flex" flexDirection="column" minH="0" minW="0" overflow="hidden">
        <Stack spacing={3} mb={2} flexShrink={0}>
          <Flex align="center" justify="space-between" gap={3} flexWrap="wrap">
            <Heading size="md">Annotate</Heading>
            <HStack spacing={2}>
              <Button size="sm" variant="outline" onClick={handleSaveProject}>Save project</Button>
              <Button size="sm" variant="outline" onClick={handleExportProject}>Export</Button>
              <Button size="sm" colorScheme="red" variant="outline" onClick={handleExitProject}>Exit</Button>
            </HStack>
          </Flex>

          <HStack spacing={3} align="center">
            <Text fontWeight="medium">Selected regions</Text>
            {selectedRegions.length === 0 && (
              <Badge bg="gray.200" color="gray.600">None</Badge>
            )}
            {selectedRegions.length === 1 && (
              <HStack spacing={2}>
                <Badge bg={selectedRegions[0].color} color="white">
                  {formatLabel(selectedRegions[0].label)}
                </Badge>
                <Text fontSize="xs" color="gray.500">ID: {selectedRegions[0].id}</Text>
              </HStack>
            )}
            {selectedRegions.length > 1 && (
              <Badge bg="gray.700" color="white">
                {selectedRegions.length} selected
              </Badge>
            )}
          </HStack>

          <Stack spacing={2} flexWrap="wrap" direction={{ base: 'column', lg: 'row' }}>
            <HStack spacing={2} flexWrap="wrap">
              <ButtonGroup size="sm" isAttached variant="outline">
                <Button onClick={handleUndo} isDisabled={undoStack.length === 0}>Undo</Button>
                <Button onClick={handleRedo} isDisabled={redoStack.length === 0}>Redo</Button>
                <Button
                  onClick={() => {
                    if (!project) return;
                    const remove = new Set(selectedRegionIds);
                    const nextRegions = project.regions.filter((r) => !remove.has(r.id));
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
                  variant={tool === 'edit' ? 'solid' : 'outline'}
                  colorScheme="brand"
                  onClick={() => setTool('edit')}
                >
                  Select / Move
                </Button>
                <Button
                  variant={tool === 'draw' ? 'solid' : 'outline'}
                  colorScheme="brand"
                  onClick={() => setTool('draw')}
                >
                  Draw
                </Button>
              </ButtonGroup>
              <Badge variant="subtle" colorScheme="gray">Zoom {zoom.toFixed(1)}×</Badge>
            </HStack>

            <HStack spacing={3} align="center" flexWrap="wrap">
              <Text fontWeight="medium">Drawing label</Text>
              <Badge bg={colorForLabel(currentLabel)} color="white" px={3} py={1} borderRadius="md">
                {formatLabel(currentLabel)}
              </Badge>
              <Text fontSize="sm" color="gray.500">Existing</Text>
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
                      border={label === currentLabel ? '2px solid #1a202c' : 'none'}
                      onClick={() => {
                        setCurrentLabel(label);
                        setHighlightedLabel((prev) => (prev === label ? null : label));
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
                variant={showHatching ? 'solid' : 'outline'}
                colorScheme={showHatching ? 'brand' : 'gray'}
                ml="auto"
                onClick={() => setShowHatching((v) => !v)}
              >
                {showHatching ? 'Hatching On' : 'Hatching Off'}
              </Button>
            </HStack>
          </Stack>

          <Text fontSize="sm" color="gray.500">
            Zoom or scroll to inspect, drag empty space in Select/Move to pan, click to select, or switch to Draw to add a closed shape. Undo/Redo are also mapped to Ctrl/Cmd+Z / Ctrl/Cmd+Y.
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
          <Box position="relative" ref={hostRef} width="100%" height="100%" overflow="hidden">

            <canvas
              ref={canvasRef}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor }}
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
      fallback={(
        <Box p={10}>
          <Heading size="md">Loading…</Heading>
        </Box>
      )}
    >
      <SpatialContent />
    </Suspense>
  );
}
