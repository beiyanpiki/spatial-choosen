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
import { heatmapColor } from '../../../lib/built-in/expressionColors';
import type { Point } from '@/types/project';
import type { ChipPlacement, ProjectedSpot } from '@/types/built-in';

const HANDLE_RADIUS_PX = 12;
const EDGE_THRESHOLD_PX = 8;

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
type BlockRect = { x: number; y: number; width: number; height: number };

type UnitExtent = { w: number; h: number };
type ScaleRange = { min: number; max: number };

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
  /** Chip-unit extent of the visible (post-exclusion) grid block. */
  unitExtent: UnitExtent;
  /** Allowed range for placement.scale. */
  scaleRange: ScaleRange;
  heWidth: number | null;
  heHeight: number | null;
  showSpots?: boolean;
  /** Spot coloring mode: binary tissue activation or normalized expression
   *  heatmap (`spotValueById` provides the per-spot normalized value). */
  displayMode?: 'tissue' | 'heatmap';
  /** Normalized [0, 1] expression values keyed by spot id. */
  spotValueById?: Map<string, number> | null;
  disabled?: boolean;
  onPlacementChange: (placement: ChipPlacement) => void;
};

const cornersOf = (rect: BlockRect): Record<Corner, PointHE> => ({
  tl: { x: rect.x, y: rect.y },
  tr: { x: rect.x + rect.width, y: rect.y },
  bl: { x: rect.x, y: rect.y + rect.height },
  br: { x: rect.x + rect.width, y: rect.y + rect.height },
});

export function TissueSelectionPanel({
  imageDataUrl,
  projectedSpots,
  selectedSpotIds,
  placement,
  unitExtent,
  scaleRange,
  heWidth,
  heHeight,
  showSpots = true,
  displayMode = 'tissue',
  spotValueById = null,
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

  const blockRect = useMemo<BlockRect | null>(() => {
    if (!placement || placement.scale <= 0) return null;
    return {
      x: placement.x,
      y: placement.y,
      width: placement.scale * unitExtent.w,
      height: placement.scale * unitExtent.h,
    };
  }, [placement, unitExtent]);

  const hasPlacementSpace = blockRect !== null
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

  const clampScale = useCallback(
    (scale: number) => Math.min(Math.max(scale, scaleRange.min), scaleRange.max),
    [scaleRange],
  );

  const findCornerAt = useCallback(
    (pointerScreen: Point, transform: NonNullable<ReturnType<typeof getTransformCb>>): Corner | null => {
      if (!blockRect) return null;
      const corners = cornersOf(blockRect);
      for (const corner of CORNERS) {
        const c = heToCanvas(corners[corner], transform);
        if (Math.hypot(c.x - pointerScreen.x, c.y - pointerScreen.y) <= HANDLE_RADIUS_PX) {
          return corner;
        }
      }
      return null;
    },
    [blockRect, heToCanvas],
  );

  const findEdgeAt = useCallback(
    (pointerScreen: Point, transform: NonNullable<ReturnType<typeof getTransformCb>>): Edge | null => {
      if (!blockRect) return null;
      const tl = heToCanvas(cornersOf(blockRect).tl, transform);
      const br = heToCanvas(cornersOf(blockRect).br, transform);
      const minX = Math.min(tl.x, br.x);
      const maxX = Math.max(tl.x, br.x);
      const minY = Math.min(tl.y, br.y);
      const maxY = Math.max(tl.y, br.y);
      const nearTop = Math.abs(pointerScreen.y - tl.y) <= EDGE_THRESHOLD_PX
        && pointerScreen.x >= minX && pointerScreen.x <= maxX;
      const nearBottom = Math.abs(pointerScreen.y - br.y) <= EDGE_THRESHOLD_PX
        && pointerScreen.x >= minX && pointerScreen.x <= maxX;
      const nearLeft = Math.abs(pointerScreen.x - tl.x) <= EDGE_THRESHOLD_PX
        && pointerScreen.y >= minY && pointerScreen.y <= maxY;
      const nearRight = Math.abs(pointerScreen.x - br.x) <= EDGE_THRESHOLD_PX
        && pointerScreen.y >= minY && pointerScreen.y <= maxY;
      if (nearTop) return 'top';
      if (nearBottom) return 'bottom';
      if (nearLeft) return 'left';
      if (nearRight) return 'right';
      return null;
    },
    [blockRect, heToCanvas],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      if (event.button !== 0) return;
      const hostBox = hostRef.current?.getBoundingClientRect() ?? null;
      const transform = getTransformCb();
      if (!hostBox || !transform) return;
      const pointerScreen: Point = { x: event.clientX - hostBox.left, y: event.clientY - hostBox.top };

      if (hasPlacementSpace && blockRect && placement) {
        const corner = findCornerAt(pointerScreen, transform);
        if (corner) {
          const opposite = OPPOSITE_CORNER[corner];
          const corners = cornersOf(blockRect);
          const oppHE = corners[opposite];
          const draggedHE = corners[corner];
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
          const center = { x: blockRect.x + blockRect.width / 2, y: blockRect.y + blockRect.height / 2 };
          const fixed =
            edge === 'top' ? blockRect.y + blockRect.height
              : edge === 'bottom' ? blockRect.y
                : edge === 'left' ? blockRect.x + blockRect.width
                  : blockRect.x;
          gestureRef.current = { mode: 'resize-edge', edge, fixed, center };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
          return;
        }

        const pointerHE = screenToHE(event.clientX, event.clientY);
        if (
          pointerHE
          && pointerHE.x >= blockRect.x
          && pointerHE.x <= blockRect.x + blockRect.width
          && pointerHE.y >= blockRect.y
          && pointerHE.y <= blockRect.y + blockRect.height
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
    [blockRect, disabled, findCornerAt, findEdgeAt, getTransformCb, hasPlacementSpace, pan, placement, screenToHE],
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
        const inside = blockRect && pointerHE
          && pointerHE.x >= blockRect.x
          && pointerHE.x <= blockRect.x + blockRect.width
          && pointerHE.y >= blockRect.y
          && pointerHE.y <= blockRect.y + blockRect.height;
        canvas.style.cursor = inside ? 'move' : 'grab';
        return;
      }

      const { w: unitW, h: unitH } = unitExtent;
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
          onPlacementChange({
            scale: gesture.startPlacement.scale,
            x: gesture.startPlacement.x + (pointerHE.x - gesture.startPointer.x),
            y: gesture.startPlacement.y + (pointerHE.y - gesture.startPointer.y),
          });
          return;
        }
        case 'resize-corner': {
          const pointerHE = screenToHE(event.clientX, event.clientY);
          if (!pointerHE) return;
          const { opposite, dirX, dirY } = gesture;
          const scale = clampScale(Math.max(
            Math.abs(pointerHE.x - opposite.x) / unitW,
            Math.abs(pointerHE.y - opposite.y) / unitH,
          ));
          onPlacementChange({
            scale,
            x: Math.min(opposite.x, opposite.x + dirX * scale * unitW),
            y: Math.min(opposite.y, opposite.y + dirY * scale * unitH),
          });
          return;
        }
        case 'resize-edge': {
          const pointerHE = screenToHE(event.clientX, event.clientY);
          if (!pointerHE) return;
          const { edge, fixed, center } = gesture;
          let scale: number;
          let next: ChipPlacement;
          if (edge === 'top') {
            scale = clampScale((fixed - pointerHE.y) / unitH);
            next = { scale, x: center.x - (scale * unitW) / 2, y: fixed - scale * unitH };
          } else if (edge === 'bottom') {
            scale = clampScale((pointerHE.y - fixed) / unitH);
            next = { scale, x: center.x - (scale * unitW) / 2, y: fixed };
          } else if (edge === 'left') {
            scale = clampScale((fixed - pointerHE.x) / unitW);
            next = { scale, x: fixed - scale * unitW, y: center.y - (scale * unitH) / 2 };
          } else {
            scale = clampScale((pointerHE.x - fixed) / unitW);
            next = { scale, x: fixed, y: center.y - (scale * unitH) / 2 };
          }
          onPlacementChange(next);
          return;
        }
      }
    },
    [
      blockRect,
      clampScale,
      disabled,
      findCornerAt,
      findEdgeAt,
      getTransformCb,
      hasPlacementSpace,
      onPlacementChange,
      screenToHE,
      unitExtent,
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

    // Pre-fill the placement block with white: the opaque HE draw covers the
    // in-image part, so any block area outside the image stays white.
    if (blockRect && hasPlacementSpace) {
      const tl = heToCanvas({ x: blockRect.x, y: blockRect.y }, transform);
      const br = heToCanvas({ x: blockRect.x + blockRect.width, y: blockRect.y + blockRect.height }, transform);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }

    const image = loadedImageRef.current;
    if (image) {
      ctx.drawImage(image, transform.originX, transform.originY, transform.width, transform.height);
    }

    if (showSpots) {
      const isHeatmap = displayMode === 'heatmap';
      for (const spot of projectedSpots) {
        const nw = spot.width ?? spot.diameterX ?? 0;
        const nh = spot.height ?? spot.diameterY ?? nw;
        const spotWidth = Math.max(1, nw * transform.width);
        const spotHeight = Math.max(1, nh * transform.height);
        const spotX = transform.originX + spot.x * transform.width - spotWidth / 2;
        const spotY = transform.originY + spot.y * transform.height - spotHeight / 2;
        let fillStyle = neutralSpotFillColor;
        if (isHeatmap && spotValueById) {
          const value = spotValueById.get(spot.id);
          if (typeof value === 'number') {
            fillStyle = heatmapColor(value);
          }
        } else if (selectedSpotIdSet.has(spot.id)) {
          fillStyle = assignedSpotFillColor;
        }
        ctx.fillStyle = fillStyle;
        ctx.fillRect(spotX, spotY, spotWidth, spotHeight);
      }
    }

    if (blockRect && hasPlacementSpace) {
      const tl = heToCanvas({ x: blockRect.x, y: blockRect.y }, transform);
      const br = heToCanvas({ x: blockRect.x + blockRect.width, y: blockRect.y + blockRect.height }, transform);
      ctx.strokeStyle = 'rgba(43,108,176,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

      for (const corner of CORNERS) {
        const c = heToCanvas(cornersOf(blockRect)[corner], transform);
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
    blockRect,
    canvasRefresh,
    displayMode,
    getTransformCb,
    hasPlacementSpace,
    heToCanvas,
    hostRect,
    projectedSpots,
    selectedSpotIdSet,
    showSpots,
    spotValueById,
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
