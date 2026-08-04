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
import { computeBaseView, getTransform } from '../../../lib/canvasViewport';
import type { ChipPlacement, ProjectedSpot } from '@/types/built-in';

const HANDLE_RADIUS_PX = 12;
const MIN_PLACEMENT_SIZE_PX = 8;

type Corner = 'tl' | 'tr' | 'bl' | 'br';
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

type PointHE = { x: number; y: number };

type Gesture =
  | { mode: 'move'; startPointer: PointHE; startPlacement: ChipPlacement }
  | {
      mode: 'resize';
      opposite: PointHE;
      dirX: number;
      dirY: number;
    };

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
    () => getTransform(computeBaseView(hostRect, ratio), 1, { x: 0, y: 0 }),
    [hostRect, ratio],
  );

  const hasPlacementSpace = placement !== null
    && typeof heWidth === 'number'
    && typeof heHeight === 'number'
    && heWidth > 0
    && heHeight > 0;

  // HE-pixel point <-> canvas-pixel point via the current transform.
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
      if (!heWidth || !heHeight) return next;
      const maxDim = Math.max(heWidth, heHeight);
      const size = Math.min(Math.max(next.size, MIN_PLACEMENT_SIZE_PX), maxDim);
      const maxX = Math.max(0, heWidth - size);
      const maxY = Math.max(0, heHeight - size);
      return {
        size,
        x: Math.min(Math.max(next.x, 0), maxX),
        y: Math.min(Math.max(next.y, 0), maxY),
      };
    },
    [heWidth, heHeight],
  );

  const findCornerAt = useCallback(
    (pointerScreen: PointHE, transform: NonNullable<ReturnType<typeof getTransformCb>>): Corner | null => {
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

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled || !hasPlacementSpace || !placement) return;
      if (event.button !== 0) return;

      const transform = getTransformCb();
      if (!transform) return;
      const hostBox = hostRef.current?.getBoundingClientRect() ?? null;
      if (!hostBox) return;
      const pointerScreen = { x: event.clientX - hostBox.left, y: event.clientY - hostBox.top };
      const pointerHE = screenToHE(event.clientX, event.clientY);
      if (!pointerHE) return;

      const corner = findCornerAt(pointerScreen, transform);
      if (corner) {
        const opposite = OPPOSITE_CORNER[corner];
        const oppHE = cornerHE(placement, opposite);
        const draggedHE = cornerHE(placement, corner);
        gestureRef.current = {
          mode: 'resize',
          opposite: oppHE,
          dirX: Math.sign(draggedHE.x - oppHE.x) || 1,
          dirY: Math.sign(draggedHE.y - oppHE.y) || 1,
        };
      } else if (
        pointerHE.x >= placement.x
        && pointerHE.x <= placement.x + placement.size
        && pointerHE.y >= placement.y
        && pointerHE.y <= placement.y + placement.size
      ) {
        gestureRef.current = { mode: 'move', startPointer: pointerHE, startPlacement: placement };
      } else {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [disabled, findCornerAt, getTransformCb, hasPlacementSpace, placement, screenToHE],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled || !hasPlacementSpace) return;
      const gesture = gestureRef.current;

      if (!gesture) {
        // Hover cursor feedback only.
        const transform = getTransformCb();
        const hostBox = hostRef.current?.getBoundingClientRect() ?? null;
        const canvas = canvasRef.current;
        if (!transform || !hostBox || !canvas || !placement) return;
        const pointerScreen = { x: event.clientX - hostBox.left, y: event.clientY - hostBox.top };
        const corner = findCornerAt(pointerScreen, transform);
        if (corner) {
          canvas.style.cursor = CORNER_CURSOR[corner];
        } else {
          const pointerHE = screenToHE(event.clientX, event.clientY);
          const inside = pointerHE
            && pointerHE.x >= placement.x
            && pointerHE.x <= placement.x + placement.size
            && pointerHE.y >= placement.y
            && pointerHE.y <= placement.y + placement.size;
          canvas.style.cursor = inside ? 'move' : 'default';
        }
        return;
      }

      const pointerHE = screenToHE(event.clientX, event.clientY);
      if (!pointerHE) return;

      if (gesture.mode === 'move') {
        const dx = pointerHE.x - gesture.startPointer.x;
        const dy = pointerHE.y - gesture.startPointer.y;
        onPlacementChange(
          clampPlacement({
            ...gesture.startPlacement,
            x: gesture.startPlacement.x + dx,
            y: gesture.startPlacement.y + dy,
          }),
        );
      } else {
        const { opposite, dirX, dirY } = gesture;
        const size = Math.max(
          Math.abs(pointerHE.x - opposite.x),
          Math.abs(pointerHE.y - opposite.y),
        );
        const placed = clampPlacement({
          size,
          x: Math.min(opposite.x, opposite.x + dirX * size),
          y: Math.min(opposite.y, opposite.y + dirY * size),
        });
        onPlacementChange(placed);
      }
    },
    [
      clampPlacement,
      disabled,
      findCornerAt,
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
                Drag the grid to position it over the tissue; drag a corner handle to resize it.
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
            />
          </Box>
        </Stack>
      </CardBody>
    </Card>
  );
}
