'use client';

import { Box, Button, ButtonGroup, HStack, Stack, Text, useToast } from '@chakra-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import polygonClipping from 'polygon-clipping';
import {
  computeBaseView,
  computeZoomTransform,
  getTransform,
  relativeToImage,
} from '@/lib/canvasViewport';
import { pointInRegion } from '@/lib/geometry';
import { colorForLabel } from '@/lib/colors';
import type { ProjectedSpot, TissueRegion, PreprocessPoint } from '@/types/preprocess';
import type { Point, Region } from '@/types/project';

type ToolMode = 'draw' | 'edit' | 'erase';

type TissueSelectionPanelProps = {
  eosinCropDataUrl: string | null;
  projectedSpots: ProjectedSpot[];
  selectedSpotIds: string[];
  regions: TissueRegion[];
  selectedRegionId: string | null;
  onRegionsChange: (regions: TissueRegion[]) => void;
  onSelectedRegionIdChange: (id: string | null) => void;
};

export function TissueSelectionPanel({
  eosinCropDataUrl,
  projectedSpots,
  selectedSpotIds,
  regions,
  selectedRegionId,
  onRegionsChange,
  onSelectedRegionIdChange,
}: TissueSelectionPanelProps) {
  const toast = useToast();
  const [tool, setTool] = useState<ToolMode>('edit');
  const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<PreprocessPoint[]>([]);
  const [, setIsPanning] = useState(false);
  const [canvasRefresh, setCanvasRefresh] = useState(0);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const pathRef = useRef<PreprocessPoint[]>([]);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const drawingActiveRef = useRef(false);
  const panningActiveRef = useRef(false);
  const [hostRect, setHostRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!eosinCropDataUrl) {
      loadedImageRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setImageDimensions(null);
      return;
    }
    const image = new Image();
    image.src = eosinCropDataUrl;
    image.onload = () => {
      loadedImageRef.current = image;
      setImageDimensions({ width: image.width, height: image.height });
      setCanvasRefresh((v) => v + 1);
    };
  }, [eosinCropDataUrl]);

  useEffect(() => {
    if (!hostRef.current) return;
    const updateRect = () => {
      if (!hostRef.current) return;
      setHostRect(hostRef.current.getBoundingClientRect());
    };

    updateRect();
    const observer = new ResizeObserver(() => {
      updateRect();
    });
    observer.observe(hostRef.current);
    window.addEventListener('resize', updateRect);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateRect);
    };
  }, []);

  const ratio = useMemo(() => {
    if (!imageDimensions) return 4 / 3;
    return imageDimensions.width / imageDimensions.height;
  }, [imageDimensions]);

  const effectiveSelectedRegionIds = useMemo(() => {
    if (!selectedRegionId) return [];
    return selectedRegionIds.length > 1 && selectedRegionIds.includes(selectedRegionId)
      ? selectedRegionIds
      : [selectedRegionId];
  }, [selectedRegionId, selectedRegionIds]);

  const computeBaseViewCb = useCallback(
    () => computeBaseView(hostRect, ratio),
    [hostRect, ratio],
  );

  const getLiveHostRect = useCallback(() => hostRef.current?.getBoundingClientRect() ?? hostRect, [hostRect]);

  const getTransformCb = useCallback(
    () => getTransform(computeBaseViewCb(), zoom, pan),
    [computeBaseViewCb, pan, zoom],
  );

  const relativeToImageCb = useCallback(
    (relative: Point | null) => relativeToImage(relative, getTransformCb()),
    [getTransformCb],
  );

  const screenToImage = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
      const currentHostRect = getLiveHostRect();
      if (!currentHostRect) return null;
      const relative = {
        x: event.clientX - currentHostRect.left,
        y: event.clientY - currentHostRect.top,
      };
      return relativeToImageCb(relative);
    },
    [getLiveHostRect, relativeToImageCb],
  );

  const getRegionPaths = useCallback((region: TissueRegion): PreprocessPoint[][] => {
    return region.paths?.length ? region.paths : [region.points];
  }, []);

  const pointInTissueRegion = useCallback(
    (point: Point, region: TissueRegion): boolean => {
      const geometryRegion: Region = {
        id: region.id,
        label: 0,
        color: region.color,
        points: region.points,
        paths: getRegionPaths(region),
      };
      return pointInRegion(point, geometryRegion);
    },
    [getRegionPaths],
  );

  const findRegionAtPoint = useCallback(
    (point: Point): TissueRegion | null => {
      for (let i = 0; i < regions.length; i += 1) {
        const region = regions[i];
        if (pointInTissueRegion(point, region)) return region;
      }
      return null;
    },
    [regions, pointInTissueRegion],
  );

  const selectRegionByIndex = useCallback(
    (index: number, modifiers: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
      if (index < 0 || index >= regions.length) return;
      const id = regions[index].id;
      const ctrl = modifiers.ctrlKey || modifiers.metaKey;
      const shift = modifiers.shiftKey;

      if (shift && selectionAnchor !== null) {
        const start = Math.min(selectionAnchor, index);
        const end = Math.max(selectionAnchor, index);
        const rangeIds = regions.slice(start, end + 1).map((r) => r.id);
        if (ctrl) {
          setSelectedRegionIds((prev) => Array.from(new Set([...prev, ...rangeIds])));
        } else {
          setSelectedRegionIds(rangeIds);
        }
        setSelectionAnchor(index);
        onSelectedRegionIdChange(id);
        return;
      }

      if (ctrl) {
        setSelectionAnchor(index);
        const nextSelectedRegionIds = effectiveSelectedRegionIds.includes(id)
          ? effectiveSelectedRegionIds.filter((currentId) => currentId !== id)
          : [...effectiveSelectedRegionIds, id];
        setSelectedRegionIds(nextSelectedRegionIds);
        onSelectedRegionIdChange(nextSelectedRegionIds.at(-1) ?? null);
        return;
      }

      setSelectionAnchor(index);
      setSelectedRegionIds([id]);
      onSelectedRegionIdChange(id);
    },
    [effectiveSelectedRegionIds, regions, selectionAnchor, onSelectedRegionIdChange],
  );

  const deleteSelectedRegions = useCallback(() => {
    if (effectiveSelectedRegionIds.length === 0) return;
    const remove = new Set(effectiveSelectedRegionIds);
    const next = regions.filter((region) => !remove.has(region.id));
    onRegionsChange(next);
    setSelectedRegionIds([]);
    setSelectionAnchor(null);
    onSelectedRegionIdChange(null);
  }, [effectiveSelectedRegionIds, regions, onRegionsChange, onSelectedRegionIdChange]);

  const commitRegion = useCallback(
    (points: PreprocessPoint[]) => {

      if (points.length < 3) return;
      const region: TissueRegion = {
        id:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `region-${Date.now()}`,
        label: `Region ${regions.length + 1}`,
        color: colorForLabel(regions.length),
        points,
        paths: [points],
      };
      onRegionsChange([...regions, region]);
      setSelectedRegionIds([region.id]);
      setSelectionAnchor(regions.length);
      onSelectedRegionIdChange(region.id);
    },
    [regions, onRegionsChange, onSelectedRegionIdChange],
  );

  const punchOut = useCallback(
    (erasePath: PreprocessPoint[]) => {

      if (erasePath.length < 3 || effectiveSelectedRegionIds.length === 0) return;
      const eraserPolygon = [erasePath.map((p) => [p.x, p.y] as [number, number])];

      const nextRegions: TissueRegion[] = [];
      const nextSelected: string[] = [];

      regions.forEach((region) => {
        if (!effectiveSelectedRegionIds.includes(region.id)) {
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

      onRegionsChange(nextRegions);
      setSelectedRegionIds(nextSelected);
      setSelectionAnchor(null);
      onSelectedRegionIdChange(nextSelected[0] ?? null);
    },
    [effectiveSelectedRegionIds, getRegionPaths, onRegionsChange, regions, onSelectedRegionIdChange],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const isMiddleButton = event.button === 1;
      const point = screenToImage(event);
      event.currentTarget.setPointerCapture(event.pointerId);

      if (isMiddleButton) {
        event.preventDefault();
        panStartRef.current = { x: event.clientX, y: event.clientY };
        panningActiveRef.current = true;
        setIsPanning(true);
        return;
      }

      if (!point) return;

      if (tool === 'edit') {
        const hit = findRegionAtPoint(point);
        if (hit) {
          const hitIndex = regions.findIndex((r) => r.id === hit.id);
          selectRegionByIndex(hitIndex, {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          });
          return;
        }
        panStartRef.current = { x: event.clientX, y: event.clientY };
        panningActiveRef.current = true;
        setIsPanning(true);
        return;
      }

      if (tool === 'erase') {
        if (effectiveSelectedRegionIds.length === 0) {
          toast({
            title: 'Select a region first',
            status: 'info',
            duration: 1400,
          });
          return;
        }
        pathRef.current = [point];
        drawingActiveRef.current = true;
        setCurrentPoints([point]);
        setIsDrawing(true);
        return;
      }

      // draw tool
      pathRef.current = [point];
      drawingActiveRef.current = true;
      setCurrentPoints([point]);
      setIsDrawing(true);
    },
    [effectiveSelectedRegionIds, screenToImage, tool, findRegionAtPoint, regions, selectRegionByIndex, toast],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (panningActiveRef.current) {
        if (!panStartRef.current) return;
        const dx = event.clientX - panStartRef.current.x;
        const dy = event.clientY - panStartRef.current.y;
        setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        panStartRef.current = { x: event.clientX, y: event.clientY };
        return;
      }
      const point = screenToImage(event);
      if (!drawingActiveRef.current || (tool !== 'draw' && tool !== 'erase') || !point) return;
      pathRef.current = [...pathRef.current, point];
      setCurrentPoints([...pathRef.current]);
    },
    [screenToImage, tool],
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {

    if (panningActiveRef.current) {
      panningActiveRef.current = false;
      setIsPanning(false);
      panStartRef.current = null;
      return;
    }
    if (!drawingActiveRef.current || (tool !== 'draw' && tool !== 'erase')) return;
    drawingActiveRef.current = false;
    setIsDrawing(false);
    if (tool === 'erase') {
      punchOut(pathRef.current);
    } else {
      commitRegion(pathRef.current);
    }
    pathRef.current = [];
    setCurrentPoints([]);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, [tool, punchOut, commitRegion]);

  const applyZoom = useCallback(
    (rawZoom: number, anchorNorm?: Point, anchorScreen?: Point) => {
      const result = computeZoomTransform(computeBaseViewCb(), rawZoom, anchorNorm, anchorScreen);
      if (!result) return;
      setZoom(result.zoom);
      setPan(result.pan);
    },
    [computeBaseViewCb],
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      const currentHostRect = getLiveHostRect();
      if (!currentHostRect) return;
      const anchorScreen = {
        x: event.clientX - currentHostRect.left,
        y: event.clientY - currentHostRect.top,
      };
      const anchorNorm = relativeToImageCb(anchorScreen);
      if (!anchorNorm) return;
      const delta = event.deltaY > 0 ? 0.9 : 1.1;
      applyZoom(zoom * delta, anchorNorm, anchorScreen);
    },
    [getLiveHostRect, relativeToImageCb, applyZoom, zoom],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hostRect) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    void canvasRefresh;


    canvas.width = hostRect.width;
    canvas.height = hostRect.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const transform = getTransformCb();
    if (!transform) return;

    const image = loadedImageRef.current;
    if (image) {
      ctx.drawImage(
        image,
        transform.originX,
        transform.originY,
        transform.width,
        transform.height,
      );
    }

    const selectedSpotSet = new Set(selectedSpotIds);
    projectedSpots.forEach((spot) => {
      const spotX = transform.originX + spot.x * transform.width;
      const spotY = transform.originY + spot.y * transform.height;
      const radius = Math.max(1, (spot.diameterX * transform.width) / 2);
      const selected = selectedSpotSet.has(spot.id);
      ctx.beginPath();
      ctx.arc(spotX, spotY, radius, 0, Math.PI * 2);
      ctx.fillStyle = selected ? 'rgba(46,204,113,0.35)' : 'rgba(231,76,60,0.2)';
      ctx.fill();
      ctx.strokeStyle = selected ? 'rgba(39,174,96,0.8)' : 'rgba(192,57,43,0.7)';
      ctx.stroke();
    });

    regions.forEach((region) => {
      const paths = getRegionPaths(region);
      const isSelected = effectiveSelectedRegionIds.includes(region.id);
      if (paths.length === 0) return;
      ctx.beginPath();
      paths.forEach((ring) => {
        if (ring.length < 2) return;
        const first = ring[0];
        ctx.moveTo(
          transform.originX + first.x * transform.width,
          transform.originY + first.y * transform.height,
        );
        for (let i = 1; i < ring.length; i += 1) {
          const p = ring[i];
          ctx.lineTo(
            transform.originX + p.x * transform.width,
            transform.originY + p.y * transform.height,
          );
        }
        ctx.closePath();
      });
      ctx.fillStyle = isSelected ? 'rgba(66,153,225,0.25)' : 'rgba(66,153,225,0.15)';
      ctx.fill('evenodd');
      ctx.strokeStyle = isSelected ? 'rgba(66,153,225,0.9)' : 'rgba(66,153,225,0.6)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();
    });

    if (isDrawing && currentPoints.length > 0) {
      ctx.beginPath();
      const first = currentPoints[0];
      ctx.moveTo(
        transform.originX + first.x * transform.width,
        transform.originY + first.y * transform.height,
      );
      for (let i = 1; i < currentPoints.length; i += 1) {
        const p = currentPoints[i];
        ctx.lineTo(
          transform.originX + p.x * transform.width,
          transform.originY + p.y * transform.height,
        );
      }
      ctx.strokeStyle = tool === 'erase' ? 'rgba(255,0,0,0.8)' : 'rgba(0,255,0,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [
    hostRect,
    canvasRefresh,
    projectedSpots,
    selectedSpotIds,
    regions,
    effectiveSelectedRegionIds,
    isDrawing,
    currentPoints,
    tool,
    getTransformCb,
    getRegionPaths,
  ]);

  return (
    <Stack spacing={4}>
      <ButtonGroup size='sm' isAttached variant='outline'>
        <Button
          data-testid='tissue-tool-draw'
          colorScheme={tool === 'draw' ? 'brand' : 'gray'}
          onClick={() => setTool('draw')}
        >
          Draw
        </Button>
        <Button
          data-testid='tissue-tool-edit'
          colorScheme={tool === 'edit' ? 'brand' : 'gray'}
          onClick={() => setTool('edit')}
        >
          Edit
        </Button>
        <Button
          data-testid='tissue-tool-erase'
          colorScheme={tool === 'erase' ? 'brand' : 'gray'}
          onClick={() => setTool('erase')}
        >
          Punch Out
        </Button>
      </ButtonGroup>

      <HStack justify='space-between'>
        <Text data-testid='tissue-panel-selected-count'>
          Selected spots: {selectedSpotIds.length}
        </Text>
        <Button
          size='xs'
          colorScheme='red'
          variant='outline'
          isDisabled={effectiveSelectedRegionIds.length === 0}
          onClick={deleteSelectedRegions}
          data-testid='tissue-delete-selected'
        >
          Delete selected
        </Button>
      </HStack>

      <Box
        ref={hostRef}
        position='relative'
        border='1px solid'
        borderColor='gray.200'
        borderRadius='lg'
        overflow='hidden'
        pointerEvents='auto'
      minH='280px'
      data-testid='tissue-stage-canvas'
    >
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', touchAction: 'none', pointerEvents: 'auto' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}

        />
      </Box>

      <Stack spacing={1} maxH='200px' overflowY='auto'>
        {regions.map((region, index) => (
          <HStack
            key={region.id}
            p={2}
             bg={effectiveSelectedRegionIds.includes(region.id) ? 'blue.50' : 'transparent'}
            border='1px solid'
             borderColor={effectiveSelectedRegionIds.includes(region.id) ? 'blue.200' : 'transparent'}
            borderRadius='md'
            cursor='pointer'
            data-testid='tissue-region-row'
            onClick={(e) => {
              selectRegionByIndex(index, {
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                shiftKey: e.shiftKey,
              });
            }}
          >
            <Box w='12px' h='12px' borderRadius='sm' bg={region.color} />
            <Text fontSize='sm' flex='1'>{region.label}</Text>
          </HStack>
        ))}
      </Stack>
    </Stack>
  );
}
