'use client';

import { Badge, Box, Button, ButtonGroup, Flex, Heading, HStack, Stack, Switch, Text } from '@chakra-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { clamp } from '@/lib/batch/affine';
import { spotRect } from '@/lib/batch/selection';
import { computeBaseView, computeZoomTransform, getTransform, relativeToImage } from '@/lib/canvasViewport';
import type {
  BatchImageSize,
  BatchPoint,
  BatchRegion,
  BatchSpot,
  BatchSpotAnchorMode,
} from '@/types/batch';

import { PREVIEW_STAGE_ZOOM_MAX, PREVIEW_STAGE_ZOOM_MIN, useStageImage, useViewportSize } from './stageSupport';

export type BatchRegionTool = 'draw' | 'erase';

/**
 * Stable empty list: a fresh `[]` default would change identity on every render
 * and silently re-run the canvas draw effect (masking redraw bugs).
 */
const EMPTY_REGIONS: readonly BatchRegion[] = [];

type BatchRegionStageProps = {
  title: string;
  description: string;
  imageUrl: string | null;
  imageSize: BatchImageSize | null;
  regions: readonly BatchRegion[];
  overlayRegions?: readonly BatchRegion[];
  overlayLabel?: string;
  interactive?: boolean;
  /** Read-only reference panel: no drawing, no view zoom, no tool controls. */
  locked?: boolean;
  tool?: BatchRegionTool;
  onToolChange?: (tool: BatchRegionTool) => void;
  spots?: readonly BatchSpot[] | null;
  selectedBarcodeSet?: ReadonlySet<string> | null;
  spotDiameterFullres?: number | null;
  anchorMode?: BatchSpotAnchorMode;
  onCommitStroke?: (points: BatchPoint[], tool: BatchRegionTool) => void;
  onUndoRegion?: () => void;
  onClearRegions?: () => void;
  testIdPrefix?: string;
  emptyMessage?: string;
};

const REGION_STROKE = 'rgba(56, 161, 105, 0.95)';
const REGION_FILL = 'rgba(56, 161, 105, 0.18)';
const OVERLAY_STROKE = 'rgba(214, 158, 46, 0.95)';
const SELECTED_SPOT_FILL = 'rgba(56, 161, 105, 0.45)';
const SELECTED_SPOT_DOT = 'rgba(56, 161, 105, 0.95)';
// Unmarked spots sit on top of the tissue image, so they need a mid-dark grey
// to stay legible instead of the faint white wash they used to be.
const UNMARKED_SPOT_FILL = 'rgba(70, 70, 70, 0.55)';
const UNMARKED_SPOT_DOT = 'rgba(90, 90, 90, 0.9)';
const CLICK_MOVEMENT_THRESHOLD_PX = 4;

export function BatchRegionStage({
  title,
  description,
  imageUrl,
  imageSize,
  regions,
  overlayRegions = EMPTY_REGIONS,
  overlayLabel = 'Reference region',
  interactive = true,
  locked = false,
  tool = 'draw',
  onToolChange,
  spots = null,
  selectedBarcodeSet = null,
  spotDiameterFullres = null,
  anchorMode = 'top-left',
  onCommitStroke,
  onUndoRegion,
  onClearRegions,
  testIdPrefix = 'batch-region',
  emptyMessage = 'Import a package to draw the selection region.',
}: BatchRegionStageProps) {
  const image = useStageImage(imageUrl);
  const {
    ref: hostRef,
    size: viewport,
    element: hostElement,
    setElement: setHostElement,
  } = useViewportSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pathRef = useRef<BatchPoint[]>([]);
  const drawingRef = useRef(false);
  const panningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = useRef(false);
  const refreshFrameRef = useRef<number | null>(null);

  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showUnmarkedSpots, setShowUnmarkedSpots] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  const requestRefresh = useCallback(() => {
    if (refreshFrameRef.current !== null) return;

    refreshFrameRef.current = window.requestAnimationFrame(() => {
      refreshFrameRef.current = null;
      setRefreshToken((value) => value + 1);
    });
  }, []);

  useEffect(() => () => {
    if (refreshFrameRef.current !== null) {
      window.cancelAnimationFrame(refreshFrameRef.current);
    }
  }, []);

  const baseView = useMemo(() => {
    if (!imageSize) return null;
    const ratio = imageSize.height > 0 ? imageSize.width / imageSize.height : 1;
    return computeBaseView(viewport, ratio);
  }, [imageSize, viewport]);

  const stage = useMemo(
    () => getTransform(baseView, viewZoom, viewPan),
    [baseView, viewPan, viewZoom],
  );

  const getLiveHostRect = useCallback(
    () => hostRef.current?.getBoundingClientRect() ?? null,
    [hostRef],
  );

  const screenToImage = useCallback((clientX: number, clientY: number): BatchPoint | null => {
    const rect = getLiveHostRect();
    if (!rect) return null;

    const relative = { x: clientX - rect.left, y: clientY - rect.top };
    const transformed = getTransform(baseView, viewZoom, viewPan);
    if (!transformed) return null;

    const point = relativeToImage(relative, transformed);
    if (!point) return null;
    return { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
  }, [baseView, getLiveHostRect, viewPan, viewZoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !viewport || !stage) return;

    const context = canvas.getContext('2d');
    if (!context) return;
    void refreshToken;

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(viewport.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(viewport.height * devicePixelRatio));
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);

    if (image) {
      context.drawImage(image, stage.originX, stage.originY, stage.width, stage.height);
    }

    const toScreen = (point: BatchPoint) => ({
      x: stage.originX + point.x * stage.width,
      y: stage.originY + point.y * stage.height,
    });

    if (showGrid && spots && spots.length > 0) {
      const scaleX = stage.width / (imageSize?.width ?? 1);
      const scaleY = stage.height / (imageSize?.height ?? 1);
      const size = (spotDiameterFullres ?? 0) * Math.min(scaleX, scaleY);
      const drawDots = size < 3;

      for (const spot of spots) {
        const rect = spotRect(spot, anchorMode, spotDiameterFullres);
        const topLeft = toScreen({
          x: rect.x / (imageSize?.width ?? 1),
          y: rect.y / (imageSize?.height ?? 1),
        });
        const selected = selectedBarcodeSet?.has(spot.barcode) ?? false;
        if (!selected && !showUnmarkedSpots) continue;

        if (drawDots) {
          context.fillStyle = selected ? SELECTED_SPOT_DOT : UNMARKED_SPOT_DOT;
          context.fillRect(topLeft.x - 1, topLeft.y - 1, 2.5, 2.5);
          continue;
        }

        context.fillStyle = selected ? SELECTED_SPOT_FILL : UNMARKED_SPOT_FILL;
        context.fillRect(topLeft.x, topLeft.y, rect.width * scaleX, rect.height * scaleY);
      }
    }

    const drawRegion = (region: BatchRegion, stroke: string, fill: string | null, dashed: boolean) => {
      if (region.points.length < 3) return;
      context.beginPath();
      const first = toScreen(region.points[0]);
      context.moveTo(first.x, first.y);
      region.points.slice(1).forEach((point) => {
        const screenPoint = toScreen(point);
        context.lineTo(screenPoint.x, screenPoint.y);
      });
      context.closePath();
      if (fill) {
        context.fillStyle = fill;
        context.fill();
      }
      context.setLineDash(dashed ? [8, 6] : []);
      context.strokeStyle = stroke;
      context.lineWidth = dashed ? 1.5 : 2;
      context.stroke();
      context.setLineDash([]);
    };

    overlayRegions.forEach((region) => drawRegion(region, OVERLAY_STROKE, null, true));
    regions.forEach((region) => drawRegion(region, REGION_STROKE, REGION_FILL, false));

    const path = pathRef.current;
    if (path.length > 1) {
      context.beginPath();
      const first = toScreen(path[0]);
      context.moveTo(first.x, first.y);
      path.slice(1).forEach((point) => {
        const screenPoint = toScreen(point);
        context.lineTo(screenPoint.x, screenPoint.y);
      });
      context.strokeStyle = tool === 'erase' ? 'rgba(229,62,62,0.9)' : REGION_STROKE;
      context.lineWidth = 2;
      context.setLineDash([6, 4]);
      context.stroke();
      context.setLineDash([]);
    }
  }, [
    anchorMode,
    image,
    imageSize,
    overlayRegions,
    refreshToken,
    regions,
    selectedBarcodeSet,
    showGrid,
    showUnmarkedSpots,
    spotDiameterFullres,
    spots,
    stage,
    tool,
    viewport,
  ]);

  const resetInteraction = useCallback(() => {
    drawingRef.current = false;
    panningRef.current = false;
    pathRef.current = [];
    panStartRef.current = null;
    pointerStartRef.current = null;
    pointerMovedRef.current = false;
    setIsDrawing(false);
    requestRefresh();
  }, [requestRefresh]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;

    if (event.button === 1) {
      event.preventDefault();
      panningRef.current = true;
      panStartRef.current = { x: event.clientX, y: event.clientY };
      return;
    }

    if (event.button !== 0) return;
    const point = screenToImage(event.clientX, event.clientY);
    if (!point) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    pathRef.current = [point];
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    pointerMovedRef.current = false;
    drawingRef.current = true;
    setIsDrawing(true);
    requestRefresh();
  }, [interactive, requestRefresh, screenToImage]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (panningRef.current && panStartRef.current) {
      const deltaX = event.clientX - panStartRef.current.x;
      const deltaY = event.clientY - panStartRef.current.y;
      setViewPan((previous) => ({ x: previous.x + deltaX, y: previous.y + deltaY }));
      panStartRef.current = { x: event.clientX, y: event.clientY };
      return;
    }

    if (!drawingRef.current) return;
    const start = pointerStartRef.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_MOVEMENT_THRESHOLD_PX) {
      pointerMovedRef.current = true;
    }

    const point = screenToImage(event.clientX, event.clientY);
    if (!point) return;
    pathRef.current.push(point);
    requestRefresh();
  }, [requestRefresh, screenToImage]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (panningRef.current) {
      panningRef.current = false;
      panStartRef.current = null;
      return;
    }

    if (!drawingRef.current) return;

    const committed = [...pathRef.current];
    const moved = pointerMovedRef.current;
    resetInteraction();

    if (moved && committed.length >= 3) {
      onCommitStroke?.(committed, tool);
    }
  }, [onCommitStroke, resetInteraction, tool]);

  /**
   * Wheel zoom is bound natively and non-passively.
   *
   * React registers `onWheel` through a passive root listener, so a
   * `preventDefault()` there is ignored and the page keeps scrolling behind the
   * canvas. Attaching the listener ourselves keeps the image area authoritative
   * whenever the pointer is over it.
   */
  useEffect(() => {
    if (!hostElement || locked) return;

    const handleWheel = (event: WheelEvent) => {
      if (!baseView) return;
      event.preventDefault();

      const rect = hostElement.getBoundingClientRect();
      const anchorScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const next = computeZoomTransform(
        baseView,
        viewZoom * (event.deltaY > 0 ? 0.9 : 1.1),
        undefined,
        anchorScreen,
      );

      if (!next) return;
      setViewZoom(clamp(next.zoom, PREVIEW_STAGE_ZOOM_MIN, PREVIEW_STAGE_ZOOM_MAX));
      setViewPan(next.pan);
    };

    hostElement.addEventListener('wheel', handleWheel, { passive: false });
    return () => hostElement.removeEventListener('wheel', handleWheel);
  }, [baseView, hostElement, locked, viewZoom]);

  return (
    <Stack spacing={4} flex='1' minW={0} data-testid={`${testIdPrefix}-stage`}>
      <Flex justify='space-between' align={{ base: 'flex-start', md: 'center' }} gap={3} wrap='wrap'>
        <Stack spacing={1}>
          <Heading size='sm'>{title}</Heading>
          <Text fontSize='sm' color='gray.500'>{description}</Text>
        </Stack>
        <HStack spacing={2}>
          {regions.length > 0 ? (
            <Badge colorScheme='green' borderRadius='full'>{regions.length} region{regions.length === 1 ? '' : 's'}</Badge>
          ) : (
            <Badge colorScheme='orange' borderRadius='full'>No region</Badge>
          )}
          {overlayRegions.length > 0 ? (
            <Badge colorScheme='yellow' borderRadius='full'>{overlayLabel}</Badge>
          ) : null}
        </HStack>
      </Flex>

      <Box
        position='relative'
        minH={{ base: '420px', lg: '620px' }}
        h={{ base: '54vh', lg: '64vh' }}
        maxH='820px'
        borderRadius='2xl'
        overflow='hidden'
        bg='gray.900'
      >
        <Box
          ref={(node) => {
            hostRef.current = node;
            setHostElement(node);
          }}
          position='absolute'
          inset={0}
        >
          <canvas
            ref={canvasRef}
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              touchAction: 'none',
              cursor: !interactive ? 'default' : tool === 'erase' ? 'crosshair' : 'crosshair',
            }}
            data-testid={`${testIdPrefix}-surface`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        </Box>

        {!image ? (
          <Flex position='absolute' inset={0} align='center' justify='center' px={6} textAlign='center'>
            <Text color='whiteAlpha.700'>{emptyMessage}</Text>
          </Flex>
        ) : null}

        <Box
          position='absolute'
          top={4}
          right={4}
          bg='blackAlpha.700'
          color='whiteAlpha.900'
          border='1px solid'
          borderColor='whiteAlpha.300'
          borderRadius='xl'
          px={3}
          py={3}
          backdropFilter='blur(12px)'
        >
          <Stack spacing={3} minW='210px'>
            {interactive ? (
              <Stack spacing={2}>
                <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>Tool</Text>
                <ButtonGroup size='xs' variant='outline' isAttached w='100%'>
                  <Button
                    flex={1}
                    color='white'
                    borderColor='whiteAlpha.400'
                    bg={tool === 'draw' ? 'whiteAlpha.300' : undefined}
                    _hover={{ bg: 'whiteAlpha.200' }}
                    onClick={() => onToolChange?.('draw')}
                  >
                    Draw
                  </Button>
                  <Button
                    flex={1}
                    color='white'
                    borderColor='whiteAlpha.400'
                    bg={tool === 'erase' ? 'whiteAlpha.300' : undefined}
                    _hover={{ bg: 'whiteAlpha.200' }}
                    onClick={() => onToolChange?.('erase')}
                  >
                    Erase
                  </Button>
                </ButtonGroup>
              </Stack>
            ) : null}

            <Stack spacing={2}>
              <Flex justify='space-between' align='center'>
                <Text fontSize='xs' color='whiteAlpha.700'>Spot overlay</Text>
                <Switch
                  size='sm'
                  isChecked={showGrid}
                  data-testid={`${testIdPrefix}-spot-overlay`}
                  onChange={(event) => setShowGrid(event.target.checked)}
                />
              </Flex>
              <Flex justify='space-between' align='center' opacity={showGrid ? 1 : 0.45}>
                <Text fontSize='xs' color='whiteAlpha.700'>Unmarked spots (grey)</Text>
                <Switch
                  size='sm'
                  isChecked={showUnmarkedSpots}
                  isDisabled={!showGrid}
                  data-testid={`${testIdPrefix}-unmarked-spots`}
                  onChange={(event) => setShowUnmarkedSpots(event.target.checked)}
                />
              </Flex>
            </Stack>

            {locked ? (
              <Text fontSize='xs' color='whiteAlpha.700'>Fixed reference view</Text>
            ) : (
            <Stack spacing={1}>
              <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>View</Text>
              <HStack spacing={2}>
                <ButtonGroup size='xs' variant='outline' isAttached>
                  <Button
                    color='white'
                    borderColor='whiteAlpha.400'
                    _hover={{ bg: 'whiteAlpha.200' }}
                    onClick={() => setViewZoom(clamp(viewZoom * 0.9, PREVIEW_STAGE_ZOOM_MIN, PREVIEW_STAGE_ZOOM_MAX))}
                  >
                    −
                  </Button>
                  <Button
                    color='white'
                    borderColor='whiteAlpha.400'
                    _hover={{ bg: 'whiteAlpha.200' }}
                    onClick={() => setViewZoom(clamp(viewZoom * 1.1, PREVIEW_STAGE_ZOOM_MIN, PREVIEW_STAGE_ZOOM_MAX))}
                  >
                    +
                  </Button>
                </ButtonGroup>
                <Button
                  size='xs'
                  variant='outline'
                  color='white'
                  borderColor='whiteAlpha.400'
                  _hover={{ bg: 'whiteAlpha.200' }}
                  onClick={() => {
                    setViewZoom(1);
                    setViewPan({ x: 0, y: 0 });
                  }}
                >
                  Fit
                </Button>
                <Text
                  fontSize='xs'
                  color='whiteAlpha.700'
                  data-testid={`${testIdPrefix}-zoom`}
                >
                  {Math.round(viewZoom * 100)}%
                </Text>
              </HStack>
            </Stack>
            )}

            {interactive && (onUndoRegion || onClearRegions) ? (
              <Stack spacing={1}>
                <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>Regions</Text>
                <HStack spacing={2}>
                  {onUndoRegion ? (
                    <Button
                      size='xs'
                      variant='outline'
                      color='white'
                      borderColor='whiteAlpha.400'
                      _hover={{ bg: 'whiteAlpha.200' }}
                      isDisabled={regions.length === 0}
                      onClick={onUndoRegion}
                    >
                      Undo
                    </Button>
                  ) : null}
                  {onClearRegions ? (
                    <Button
                      size='xs'
                      variant='outline'
                      color='white'
                      borderColor='whiteAlpha.400'
                      _hover={{ bg: 'whiteAlpha.200' }}
                      isDisabled={regions.length === 0}
                      onClick={onClearRegions}
                    >
                      Clear
                    </Button>
                  ) : null}
                </HStack>
              </Stack>
            ) : null}
          </Stack>
        </Box>

        <Box
          position='absolute'
          left={4}
          bottom={4}
          bg='blackAlpha.700'
          color='whiteAlpha.800'
          px={3}
          py={2}
          borderRadius='lg'
          maxW='420px'
        >
          <Text fontSize='xs'>
            {locked
              ? 'Reference view is fixed.'
              : isDrawing
                ? 'Release to commit the region.'
                : 'Drag to draw · middle-drag to pan · wheel to zoom'}
          </Text>
        </Box>
      </Box>
    </Stack>
  );
}
