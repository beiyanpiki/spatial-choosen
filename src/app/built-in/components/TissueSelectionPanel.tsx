'use client';

import {
  Box,
  Card,
  CardBody,
  Flex,
  HStack,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { colorForLabel } from '../../../lib/colors';
import {
  computeBaseView,
  computeZoomTransform,
  getTransform,
  relativeToImage,
} from '../../../lib/canvasViewport';
import type { Point } from '@/types/project';
import type { ChipPlacement, ProjectedSpot } from '@/types/built-in';

const HANDLE_RADIUS_PX = 12;
const EDGE_THRESHOLD_PX = 8;
const MIN_PLACEMENT_SIZE_PX = 8;

type Corner = 'tl' | 'tr' | 'bl' | 'br';
type Edge = 'top' | 'bottom' | 'left' | 'right';
const CORNERS: readonly Corner[] = ['tl', 'tr', 'bl', 'br'];
const OPPOSITE_CORNER: Record<Corner, Corner> = {
  tl: 'br',
  tr: 'bl',
  bl: 'tr',
  br: 'tl',
};
const CORNER_CURSOR: Record<Corner, string> = {
  tl: 'nwse-resize',
  tr: 'nesw-resize',
  bl: 'nesw-resize',
  br: 'nwse-resize',
};
const EDGE_CURSOR: Record<Edge, string> = {
  top: 'ns-resize',
  bottom: 'ns-resize',
  left: 'ew-resize',
  right: 'ew-resize',
};

type PointHE = { x: number; y: number };

type Gesture =
  | { mode: 'move'; startPointer: PointHE; startPlacement: ChipPlacement }
  | { mode: 'resize-corner'; opposite: PointHE; dirX: number; dirY: number }
  | { mode: 'resize-edge'; edge: Edge; fixed: number; center: PointHE }
  | { mode: 'pan'; startScreen: Point; startPan: Point };

type TissueSelectionPanelProps = {
  imageDataUrl: string | null;
  projectedSpots: ProjectedSpot[];
  selectedSpotIds: string[];
  placement: ChipPlacement | null;
  heWidth: number | null;
  heHeight: number | null;
  showSpots?: boolean;
  disabled?: boolean;
  onPlacementChange: (placement: ChipPlacement) => void;
};

const cornerHE = (placement: ChipPlacement, corner: Corner): PointHE => {
  const { x, y, size } = placement;
  switch (corner) {
    case 'tl':
      return { x, y };
    case 'tr':
      return { x: x + size, y };
    case 'bl':
      return { x, y: y + size };
    case 'br':
      return { x: x + size, y: y + size };
  }
};

export function TissueSelectionPanel({
  imageDataUrl,
  projectedSpots,
  selectedSpotIds,
  placement,
  heWidth,
  heHeight,
  showSpots = true,
  disabled = false,
  onPlacementChange,
}: TissueSelectionPanelProps) {
  const [canvasRefresh, setCanvasRefresh] = useState(0);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [hostRect, setHostRect] = useState<DOMRect | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const canvasRefreshFrameRef = useRef<number | null>(null);
  const gestureRef = useRef<Gesture | null>(null);

  const requestCanvasRefresh = useCallback(() => {
    if (canvasRefreshFrameRef.current !== null) {
      return;
    }
    canvasRefreshFrameRef.current = window.requestAnimationFrame(() => {
      canvasRefreshFrameRef.current = null;
      setCanvasRefresh((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    if (!imageDataUrl) {
      loadedImageRef.current = null;
      requestCanvasRefresh();
      return;
    }
    const image = new Image();
    image.onload = () => {
      loadedImageRef.current = image;
      setImageDimensions({ width: image.width, height: image.height });
      requestCanvasRefresh();
    };
    image.onerror = () => {
      loadedImageRef.current = null;
      setImageDimensions(null);
      requestCanvasRefresh();
    };
    image.src = imageDataUrl;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [imageDataUrl, requestCanvasRefresh]);

  useEffect(() => () => {
    if (canvasRefreshFrameRef.current !== null) {
      window.cancelAnimationFrame(canvasRefreshFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;
    const updateRect = () => {
      if (hostRef.current) setHostRect(hostRef.current.getBoundingClientRect());
    };
    updateRect();
    const observer = new ResizeObserver(updateRect);
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

  const selectedSpotIdSet = useMemo(() => new Set(selectedSpotIds), [selectedSpotIds]);
  const assignedSpotFillColor = useMemo(() => `${colorForLabel(1)}E6`, []);
  const neutralSpotFillColor = '#cbd5e026';

  const getTransformCb = useCallback(
    () => getTransform(computeBaseView(hostRect, ratio), zoom, pan),
    [hostRect, ratio, zoom, pan],
  );

  const hasPlacementSpace = placement !== null
    && typeof heWidth === 'number'
    && typeof heHeight === 'number'
    && heWidth > 0
    && heHeight > 0;

  // HE-pixel point <-> canvas-pixel point via the current (zoomed/panned) transform.
  const heToCanvas = useCallback(
    (point: PointHE, transform: NonNullable<ReturnType<typeof getTransformCb>>) => ({
      x: transform.originX + (heWidth ? point.x / heWidth : 0) * transform.width,
      y: transform.originY + (heHeight ? point.y / heHeight : 0) * transform.height,
    }),
    [heWidth, heHeight],
  );

  const screenToHE = useCallback(
    (clientX: number, clientY: number): PointHE | null => {
      const currentHostRect = hostRef.current?.getBoundingClientRect() ?? hostRect;
      const transform = getTransformCb();
      if (!currentHostRect || !transform || !heWidth || !heHeight) return null;
      const relX = clientX - currentHostRect.left;
      const relY = clientY - currentHostRect.top;
      return {
        x: ((relX - transform.originX) / transform.width) * heWidth,
        y: ((relY - transform.originY) / transform.height) * heHeight,
      };
    },
    [getTransformCb, heWidth, heHeight, hostRect],
  );

  const clampPlacement = useCallback(
    (next: ChipPlacement): ChipPlacement => {
      // The grid may extend beyond the HE image; the out-of-image area becomes
      // white padding in the output. Only enforce a sane size range and leave
      // the position free (including beyond the image bounds).
      const dimMax = Math.max(heWidth ?? 0, heHeight ?? 0);
      const maxSize = dimMax > 0 ? dimMax * 4 : next.size;
      const size = Math.min(Math.max(next.size, MIN_PLACEMENT_SIZE_PX), maxSize);
      return { size, x: next.x, y: next.y };
    },
    [heWidth, heHeight],
  );

  const findCornerAt = useCallback(
    (pointerScreen: Point, transform: NonNullable<ReturnType<typeof getTransformCb>>): Corner | null => {
      if (!placement) return null;
      for (const corner of CORNERS) {
        const c = heToCanvas(cornerHE(placement, corner), transform);
        if (Math.hypot(c.x - pointerScreen.x, c.y - pointerScreen.y) <= HANDLE_RADIUS_PX) {
          return corner;
        }
      }
      return null;
    },
    [heToCanvas, placement],
  );

  const findEdgeAt = useCallback(
    (pointerScreen: Point, transform: NonNullable<ReturnType<typeof getTransformCb>>): Edge | null => {
      if (!placement) return null;
      const tl = heToCanvas(cornerHE(placement, 'tl'), transform);
      const tr = heToCanvas(cornerHE(placement, 'tr'), transform);
      const bl = heToCanvas(cornerHE(placement, 'bl'), transform);
      const br = heToCanvas(cornerHE(placement, 'br'), transform);
      const minX = Math.min(tl.x, br.x);
      const maxX = Math.max(tl.x, br.x);
      const minY = Math.min(tl.y, br.y);
      const maxY = Math.max(tl.y, br.y);
      const nearTop = Math.abs(pointerScreen.y - tl.y) <= EDGE_THRESHOLD_PX
        && pointerScreen.x >= minX && pointerScreen.x <= maxX;
      const nearBottom = Math.abs(pointerScreen.y - bl.y) <= EDGE_THRESHOLD_PX
        && pointerScreen.x >= minX && pointerScreen.x <= maxX;
      const nearLeft = Math.abs(pointerScreen.x - tl.x) <= EDGE_THRESHOLD_PX
        && pointerScreen.y >= minY && pointerScreen.y <= maxY;
      const nearRight = Math.abs(pointerScreen.x - tr.x) <= EDGE_THRESHOLD_PX
        && pointerScreen.y >= minY && pointerScreen.y <= maxY;
      if (nearTop) return 'top';
      if (nearBottom) return 'bottom';
      if (nearLeft) return 'left';
      if (nearRight) return 'right';
      return null;
    },
    [heToCanvas, placement],
  );

  const applyResizeEdge = useCallback(
    (edge: Edge, fixed: number, center: PointHE, pointerHE: PointHE): ChipPlacement => {
      let size: number;
      let next: ChipPlacement;
      switch (edge) {
        case 'top':
          size = fixed - pointerHE.y;
          next = { size, x: center.x - size / 2, y: fixed - size };
          break;
        case 'bottom':
          size = pointerHE.y - fixed;
          next = { size, x: center.x - size / 2, y: fixed };
          break;
        case 'left':
          size = fixed - pointerHE.x;
          next = { size, x: fixed - size, y: center.y - size / 2 };
          break;
        case 'right':
          size = pointerHE.x - fixed;
          next = { size, x: fixed, y: center.y - size / 2 };
          break;
      }
      return clampPlacement(next);
    },
    [clampPlacement],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      if (event.button !== 0) return;
      const hostBox = hostRef.current?.getBoundingClientRect() ?? null;
      const transform = getTransformCb();
      if (!hostBox || !transform) return;
      const pointerScreen: Point = { x: event.clientX - hostBox.left, y: event.clientY - hostBox.top };

      if (hasPlacementSpace && placement) {
        const corner = findCornerAt(pointerScreen, transform);
        if (corner) {
          const opposite = OPPOSITE_CORNER[corner];
          const oppHE = cornerHE(placement, opposite);
          const draggedHE = cornerHE(placement, corner);
          gestureRef.current = {
            mode: 'resize-corner',
            opposite: oppHE,
            dirX: Math.sign(draggedHE.x - oppHE.x) || 1,
            dirY: Math.sign(draggedHE.y - oppHE.y) || 1,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
          return;
        }

        const edge = findEdgeAt(pointerScreen, transform);
        if (edge) {
          const center = {
            x: placement.x + placement.size / 2,
            y: placement.y + placement.size / 2,
          };
          const fixed =
            edge === 'top' ? placement.y + placement.size
              : edge === 'bottom' ? placement.y
                : edge === 'left' ? placement.x + placement.size
                  : placement.x;
          gestureRef.current = { mode: 'resize-edge', edge, fixed, center };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
          return;
        }

        const pointerHE = screenToHE(event.clientX, event.clientY);
        if (
          pointerHE
          && pointerHE.x >= placement.x
          && pointerHE.x <= placement.x + placement.size
          && pointerHE.y >= placement.y
          && pointerHE.y <= placement.y + placement.size
        ) {
          gestureRef.current = { mode: 'move', startPointer: pointerHE, startPlacement: placement };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
          return;
        }
      }

      // Otherwise, dragging pans the (possibly zoomed) view.
      gestureRef.current = { mode: 'pan', startScreen: pointerScreen, startPan: pan };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [disabled, findCornerAt, findEdgeAt, getTransformCb, hasPlacementSpace, pan, placement, screenToHE],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      const gesture = gestureRef.current;
      const hostBox = hostRef.current?.getBoundingClientRect() ?? null;
      const canvas = canvasRef.current;
      if (!hostBox) return;
      const pointerScreen: Point = { x: event.clientX - hostBox.left, y: event.clientY - hostBox.top };

      if (!gesture) {
        // Hover cursor feedback only.
        const transform = getTransformCb();
        if (!transform || !canvas) return;
        const corner = hasPlacementSpace ? findCornerAt(pointerScreen, transform) : null;
        if (corner) {
          canvas.style.cursor = CORNER_CURSOR[corner];
          return;
        }
        const edge = hasPlacementSpace ? findEdgeAt(pointerScreen, transform) : null;
        if (edge) {
          canvas.style.cursor = EDGE_CURSOR[edge];
          return;
        }
        const pointerHE = screenToHE(event.clientX, event.clientY);
        const inside = placement && pointerHE
          && pointerHE.x >= placement.x
          && pointerHE.x <= placement.x + placement.size
          && pointerHE.y >= placement.y
          && pointerHE.y <= placement.y + placement.size;
        canvas.style.cursor = inside ? 'move' : 'grab';
        return;
      }

      switch (gesture.mode) {
        case 'pan': {
          setPan({
            x: gesture.startPan.x + (pointerScreen.x - gesture.startScreen.x),
            y: gesture.startPan.y + (pointerScreen.y - gesture.startScreen.y),
          });
          return;
        }
        case 'move': {
          const pointerHE = screenToHE(event.clientX, event.clientY);
          if (!pointerHE) return;
          onPlacementChange(
            clampPlacement({
              ...gesture.startPlacement,
              x: gesture.startPlacement.x + (pointerHE.x - gesture.startPointer.x),
              y: gesture.startPlacement.y + (pointerHE.y - gesture.startPointer.y),
            }),
          );
          return;
        }
        case 'resize-corner': {
          const pointerHE = screenToHE(event.clientX, event.clientY);
          if (!pointerHE) return;
          const { opposite, dirX, dirY } = gesture;
          const size = Math.max(
            Math.abs(pointerHE.x - opposite.x),
            Math.abs(pointerHE.y - opposite.y),
          );
          onPlacementChange(
            clampPlacement({
              size,
              x: Math.min(opposite.x, opposite.x + dirX * size),
              y: Math.min(opposite.y, opposite.y + dirY * size),
            }),
          );
          return;
        }
        case 'resize-edge': {
          const pointerHE = screenToHE(event.clientX, event.clientY);
          if (!pointerHE) return;
          onPlacementChange(
            applyResizeEdge(gesture.edge, gesture.fixed, gesture.center, pointerHE),
          );
          return;
        }
      }
    },
    [
      applyResizeEdge,
      clampPlacement,
      disabled,
      findCornerAt,
      findEdgeAt,
      getTransformCb,
      hasPlacementSpace,
      onPlacementChange,
      placement,
      screenToHE,
    ],
  );

  const endGesture = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (gestureRef.current) {
      gestureRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }, []);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      const hostBox = hostRef.current?.getBoundingClientRect() ?? null;
      const base = computeBaseView(hostRect, ratio);
      if (!hostBox || !base) return;
      const anchorScreen: Point = { x: event.clientX - hostBox.left, y: event.clientY - hostBox.top };
      const anchorNorm = relativeToImage(anchorScreen, getTransformCb());
      event.preventDefault();
      const delta = event.deltaY > 0 ? 0.9 : 1.1;
      const result = computeZoomTransform(base, zoom * delta, anchorNorm ?? undefined, anchorScreen);
      if (result) {
        setZoom(result.zoom);
        setPan(result.pan);
      }
    },
    [disabled, getTransformCb, hostRect, ratio, zoom],
  );

  // Draw the HE image, the activation grid, the placement outline, and handles.
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

    // Pre-fill the placement box with white: the opaque HE draw covers the
    // in-image part, so any box area outside the image stays white — matching
    // the white padding used in the final output when the box exceeds the image.
    if (placement && hasPlacementSpace) {
      const tl = heToCanvas(cornerHE(placement, 'tl'), transform);
      const br = heToCanvas(cornerHE(placement, 'br'), transform);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }

    const image = loadedImageRef.current;
    if (image) {
      ctx.drawImage(image, transform.originX, transform.originY, transform.width, transform.height);
    }

    if (showSpots) {
      for (const spot of projectedSpots) {
        const nw = spot.width ?? spot.diameterX ?? 0;
        const nh = spot.height ?? spot.diameterY ?? nw;
        const spotWidth = Math.max(1, nw * transform.width);
        const spotHeight = Math.max(1, nh * transform.height);
        const spotX = transform.originX + spot.x * transform.width - spotWidth / 2;
        const spotY = transform.originY + spot.y * transform.height - spotHeight / 2;
        ctx.fillStyle = selectedSpotIdSet.has(spot.id) ? assignedSpotFillColor : neutralSpotFillColor;
        ctx.fillRect(spotX, spotY, spotWidth, spotHeight);
      }
    }

    if (placement && hasPlacementSpace) {
      const tl = heToCanvas(cornerHE(placement, 'tl'), transform);
      const br = heToCanvas(cornerHE(placement, 'br'), transform);
      ctx.strokeStyle = 'rgba(43,108,176,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

      for (const corner of CORNERS) {
        const c = heToCanvas(cornerHE(placement, corner), transform);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(43,108,176,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }, [
    assignedSpotFillColor,
    canvasRefresh,
    getTransformCb,
    hasPlacementSpace,
    heToCanvas,
    hostRect,
    placement,
    projectedSpots,
    selectedSpotIdSet,
    showSpots,
  ]);

  return (
    <Card border='1px solid' borderColor='gray.200' borderRadius='2xl' boxShadow='sm' bg='white'>
      <CardBody p={{ base: 4, xl: 5 }}>
        <Stack spacing={4} h='100%'>
          <Flex
            justify='space-between'
            align={{ base: 'flex-start', md: 'center' }}
            gap={3}
            direction={{ base: 'column', md: 'row' }}
          >
            <Stack spacing={1}>
              <Text fontSize='lg' fontWeight='semibold'>Chip grid placement</Text>
              <Text fontSize='sm' color='gray.500'>
                Drag the grid to position it; drag an edge or corner to resize. Scroll to zoom, drag outside the grid to pan.
              </Text>
            </Stack>
            <HStack spacing={3} wrap='wrap' justify={{ base: 'flex-start', md: 'flex-end' }}>
              <Text data-testid='tissue-panel-selected-count' fontSize='sm' color='gray.600'>
                Active spots: {selectedSpotIds.length}
              </Text>
            </HStack>
          </Flex>

          <Box
            ref={hostRef}
            position='relative'
            border='1px solid'
            borderColor='gray.200'
            borderRadius='xl'
            overflow='hidden'
            bg='gray.50'
            pointerEvents={disabled ? 'none' : 'auto'}
            minH={{ base: '420px', xl: '680px' }}
            opacity={disabled ? 0.8 : 1}
            data-testid='tissue-stage-canvas'
          >
            <canvas
              ref={canvasRef}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', touchAction: 'none', pointerEvents: 'auto' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
              onWheel={handleWheel}
            />
          </Box>
        </Stack>
      </CardBody>
    </Card>
  );
}
