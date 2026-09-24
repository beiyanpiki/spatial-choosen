'use client';

import {
  Box,
  Button,
  ButtonGroup,
  Card,
  CardBody,
  Flex,
  HStack,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  computeBaseView,
  computeZoomTransform,
  getTransform,
  relativeToImage,
} from '../../../lib/canvasViewport';
import type { Point } from '@/types/project';
import type { PreprocessPoint, ProjectedSpot, TissueSpotStyle } from '@/types/preprocess';
import { DEFAULT_TISSUE_SPOT_STYLE } from '../../../lib/preprocess/tissueSpotStyle';

export type ToolMode = 'activate' | 'deactivate';

const CLICK_MOVEMENT_THRESHOLD_PX = 4;
const ZOOM_WHEEL_FACTOR = 1.1;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

type TissueSelectionPanelProps = {
  eosinCropDataUrl: string | null;
  projectedSpots: ProjectedSpot[];
  selectedSpotIds: string[];
  spotStyle?: TissueSpotStyle;
  showSpots?: boolean;
  disabled?: boolean;
  showControls?: boolean;
  tool?: ToolMode;
  onToolChange?: (tool: ToolMode) => void;
  onEditCommit?: (editArea: PreprocessPoint[]) => void;
  onSpotToggle?: (spotId: string) => void;
};

export function TissueSelectionPanel({
  eosinCropDataUrl,
  projectedSpots,
  selectedSpotIds,
  spotStyle,
  showSpots = true,
  disabled = false,
  showControls = true,
  tool: controlledTool,
  onToolChange,
  onEditCommit,
  onSpotToggle,
}: TissueSelectionPanelProps) {
  const [internalTool, setInternalTool] = useState<ToolMode>('activate');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [canvasRefresh, setCanvasRefresh] = useState(0);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const pathRef = useRef<PreprocessPoint[]>([]);
  const canvasRefreshFrameRef = useRef<number | null>(null);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = useRef(false);
  const drawingActiveRef = useRef(false);
  const panningActiveRef = useRef(false);
  const spacePressedRef = useRef(false);
  const [hostRect, setHostRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    // Hold Space and drag to pan (in addition to the middle mouse button).
    // Listened on window so the modifier works even when the pointer is
    // already down on the canvas, but only activated for keys that originate
    // from the stage (or the page body): swallowing Space anywhere else would
    // break keyboard scrolling and other page shortcuts. keyup/blur stay
    // unscoped so the pressed state always clears.
    const isEditableTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.tagName === 'SELECT'
        || target.isContentEditable
        || target.tagName === 'BUTTON');

    const isStageTarget = (target: EventTarget | null) =>
      target === document.body
      || (target instanceof Node && hostRef.current?.contains(target) === true);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || isEditableTarget(event.target)) {
        return;
      }
      if (!isStageTarget(event.target)) {
        return;
      }
      event.preventDefault();
      spacePressedRef.current = true;
      setIsSpacePressed(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      spacePressedRef.current = false;
      setIsSpacePressed(false);
    };

    const handleBlur = () => {
      spacePressedRef.current = false;
      setIsSpacePressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

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
    if (!eosinCropDataUrl) {
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
    image.src = eosinCropDataUrl;

    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [eosinCropDataUrl, requestCanvasRefresh]);

  useEffect(() => () => {
    if (canvasRefreshFrameRef.current !== null) {
      window.cancelAnimationFrame(canvasRefreshFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const updateRect = () => {
      if (!hostRef.current) {
        return;
      }
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
    if (!eosinCropDataUrl || !imageDimensions) {
      return 4 / 3;
    }

    return imageDimensions.width / imageDimensions.height;
  }, [eosinCropDataUrl, imageDimensions]);

  const selectedSpotIdSet = useMemo(() => new Set(selectedSpotIds), [selectedSpotIds]);
  const neutralSpotFillColor = '#e5e5e520';

  const computeBaseViewCb = useCallback(
    () => computeBaseView(hostRect, ratio),
    [hostRect, ratio],
  );

  const getLiveHostRect = useCallback(
    () => hostRef.current?.getBoundingClientRect() ?? hostRect,
    [hostRect],
  );

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
      if (!currentHostRect) {
        return null;
      }

      const relative = {
        x: event.clientX - currentHostRect.left,
        y: event.clientY - currentHostRect.top,
      };
      return relativeToImageCb(relative);
    },
    [getLiveHostRect, relativeToImageCb],
  );

  const activeTool = controlledTool ?? internalTool;
  const handleToolChange = useCallback(
    (nextTool: ToolMode) => {
      if (controlledTool === undefined) {
        setInternalTool(nextTool);
      }
      onToolChange?.(nextTool);
    },
    [controlledTool, onToolChange],
  );

  const resetInteractionState = useCallback(() => {
    drawingActiveRef.current = false;
    panningActiveRef.current = false;
    pathRef.current = [];
    setIsDrawing(false);
    setIsPanning(false);
    panStartRef.current = null;
    pointerStartRef.current = null;
    pointerMovedRef.current = false;
    requestCanvasRefresh();
  }, [requestCanvasRefresh]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) {
        resetInteractionState();
        event.preventDefault();
        return;
      }

      if (event.button !== 0 && event.button !== 1) {
        return;
      }

      const isMiddleButton = event.button === 1;
      const isSpacePan = event.button === 0 && spacePressedRef.current;
      event.currentTarget.setPointerCapture(event.pointerId);

      if (isMiddleButton || isSpacePan) {
        event.preventDefault();
        panStartRef.current = { x: event.clientX, y: event.clientY };
        panningActiveRef.current = true;
        setIsPanning(true);
        return;
      }

      const point = screenToImage(event);
      if (!point) {
        return;
      }

      pathRef.current = [point];
      pointerStartRef.current = { x: event.clientX, y: event.clientY };
      pointerMovedRef.current = false;
      drawingActiveRef.current = true;
      setIsDrawing(true);
      requestCanvasRefresh();
    },
    [disabled, requestCanvasRefresh, resetInteractionState, screenToImage],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) {
        resetInteractionState();
        return;
      }

      if (panningActiveRef.current) {
        if (!panStartRef.current) {
          return;
        }

        const dx = event.clientX - panStartRef.current.x;
        const dy = event.clientY - panStartRef.current.y;
        setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
        panStartRef.current = { x: event.clientX, y: event.clientY };
        return;
      }

      if (!drawingActiveRef.current) {
        return;
      }

      const pointerStart = pointerStartRef.current;
      if (pointerStart && Math.hypot(
        event.clientX - pointerStart.x,
        event.clientY - pointerStart.y,
      ) > CLICK_MOVEMENT_THRESHOLD_PX) {
        pointerMovedRef.current = true;
      }

      const point = screenToImage(event);
      if (!point) {
        return;
      }
      pathRef.current.push(point);
      requestCanvasRefresh();
    },
    [disabled, requestCanvasRefresh, resetInteractionState, screenToImage],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) {
        resetInteractionState();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        return;
      }

      if (panningActiveRef.current) {
        panningActiveRef.current = false;
        setIsPanning(false);
        panStartRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        return;
      }

      if (!drawingActiveRef.current) {
        return;
      }

      drawingActiveRef.current = false;
      setIsDrawing(false);
      const committedPath = [...pathRef.current];
      const pointerStart = pointerStartRef.current;
      const pointerUpMoved = pointerStart !== null && Math.hypot(
        event.clientX - pointerStart.x,
        event.clientY - pointerStart.y,
      ) > CLICK_MOVEMENT_THRESHOLD_PX;
      const pointerMoved = pointerMovedRef.current || pointerUpMoved;
      pathRef.current = [];
      pointerStartRef.current = null;
      pointerMovedRef.current = false;
      requestCanvasRefresh();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const clickPoint = pointerMoved ? undefined : committedPath[0];
      if (clickPoint && showSpots) {
        const clickedSpot = projectedSpots.find((spot) => {
          const width = spot.width ?? spot.diameterX ?? 0;
          const height = spot.height ?? spot.diameterY ?? width;
          return Math.abs(clickPoint.x - spot.x) <= width / 2
            && Math.abs(clickPoint.y - spot.y) <= height / 2;
        });
        if (clickedSpot) {
          onSpotToggle?.(clickedSpot.id);
        }
      } else if (pointerMoved && committedPath.length >= 3) {
        onEditCommit?.(committedPath);
      }
    },
    [disabled, onEditCommit, onSpotToggle, projectedSpots, requestCanvasRefresh, resetInteractionState, showSpots],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      resetInteractionState();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [resetInteractionState],
  );

  const applyZoom = useCallback(
    (rawZoom: number, anchorNorm?: Point, anchorScreen?: Point) => {
      const result = computeZoomTransform(computeBaseViewCb(), rawZoom, anchorNorm, anchorScreen);
      if (!result) {
        return;
      }
      setZoom(result.zoom);
      setPan(result.pan);
    },
    [computeBaseViewCb],
  );

  const zoomByFactor = useCallback(
    (factor: number) => {
      applyZoom(zoom * factor);
    },
    [applyZoom, zoom],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      if (disabled) {
        resetInteractionState();
        event.preventDefault();
        return;
      }

      const currentHostRect = getLiveHostRect();
      if (!currentHostRect) {
        return;
      }

      const anchorScreen = {
        x: event.clientX - currentHostRect.left,
        y: event.clientY - currentHostRect.top,
      };
      const rawAnchor = relativeToImageCb(anchorScreen);
      // A cursor slightly outside the image still zooms — clamp the anchor to
      // the image edge instead of rejecting the gesture.
      const anchorNorm = rawAnchor ?? (() => {
        const transform = getTransformCb();
        if (!transform) {
          return null;
        }
        return {
          x: clamp((anchorScreen.x - transform.originX) / transform.width, 0, 1),
          y: clamp((anchorScreen.y - transform.originY) / transform.height, 0, 1),
        };
      })();
      if (!anchorNorm) {
        return;
      }

      event.preventDefault();
      const delta = event.deltaY > 0 ? 1 / ZOOM_WHEEL_FACTOR : ZOOM_WHEEL_FACTOR;
      applyZoom(zoom * delta, anchorNorm, anchorScreen);
    },
    [applyZoom, disabled, getLiveHostRect, getTransformCb, relativeToImageCb, resetInteractionState, zoom],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hostRect) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    void canvasRefresh;

    canvas.width = hostRect.width;
    canvas.height = hostRect.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const transform = getTransformCb();
    if (!transform) {
      return;
    }

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

    if (showSpots) {
      for (const spot of projectedSpots) {
        const normalizedSpotWidth = spot.width ?? spot.diameterX ?? 0;
        const normalizedSpotHeight = spot.height ?? spot.diameterY ?? normalizedSpotWidth;
        const spotWidth = Math.max(1, normalizedSpotWidth * transform.width);
        const spotHeight = Math.max(1, normalizedSpotHeight * transform.height);
        const spotX = transform.originX + spot.x * transform.width - spotWidth / 2;
        const spotY = transform.originY + spot.y * transform.height - spotHeight / 2;
        const selected = selectedSpotIdSet.has(spot.id);
        if (selected) {
          const style = spotStyle ?? DEFAULT_TISSUE_SPOT_STYLE;
          ctx.globalAlpha = clamp(style.opacity, 0, 1);
          ctx.fillStyle = style.color;
        } else {
          ctx.fillStyle = neutralSpotFillColor;
        }
        ctx.fillRect(spotX, spotY, spotWidth, spotHeight);
        ctx.globalAlpha = 1;
      }
    }

    const currentPoints = pathRef.current;
    if (isDrawing && currentPoints.length > 0) {
      ctx.beginPath();
      const first = currentPoints[0];
      ctx.moveTo(
        transform.originX + first.x * transform.width,
        transform.originY + first.y * transform.height,
      );
      for (let index = 1; index < currentPoints.length; index += 1) {
        const point = currentPoints[index];
        ctx.lineTo(
          transform.originX + point.x * transform.width,
          transform.originY + point.y * transform.height,
        );
      }
      ctx.strokeStyle = activeTool === 'deactivate' ? 'rgba(255,0,0,0.8)' : 'rgba(0,255,0,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [
    activeTool,
    canvasRefresh,
    getTransformCb,
    hostRect,
    isDrawing,
    projectedSpots,
    selectedSpotIdSet,
    showSpots,
    spotStyle,
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
              <Text fontSize='lg' fontWeight='semibold'>Tissue Spot Selection</Text>
              <Text fontSize='sm' color='gray.500'>
                Automatically identify tissue-covered spots and refine the selection manually if needed.
              </Text>
            </Stack>
            <HStack spacing={3} wrap='wrap' justify={{ base: 'flex-start', md: 'flex-end' }}>
              <Text data-testid='tissue-panel-selected-count' fontSize='sm' color='gray.600'>
                Number of Tissue Spots: {selectedSpotIds.length}
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
            <HStack
              position='absolute'
              top={3}
              right={3}
              zIndex={1}
              spacing={1}
              bg='blackAlpha.700'
              borderRadius='lg'
              px={1.5}
              py={1}
              backdropFilter='blur(8px)'
              data-testid='tissue-zoom-controls'
            >
              <Button
                size='xs'
                variant='ghost'
                color='white'
                _hover={{ bg: 'whiteAlpha.300' }}
                aria-label='Zoom out tissue canvas'
                isDisabled={disabled}
                onClick={() => zoomByFactor(1 / ZOOM_WHEEL_FACTOR)}
                data-testid='tissue-zoom-out'
              >
                −
              </Button>
              <Text
                fontSize='xs'
                color='whiteAlpha.950'
                fontWeight='semibold'
                minW='44px'
                textAlign='center'
                data-testid='tissue-zoom-value'
              >
                {Math.round(zoom * 100)}%
              </Text>
              <Button
                size='xs'
                variant='ghost'
                color='white'
                _hover={{ bg: 'whiteAlpha.300' }}
                aria-label='Zoom in tissue canvas'
                isDisabled={disabled}
                onClick={() => zoomByFactor(ZOOM_WHEEL_FACTOR)}
                data-testid='tissue-zoom-in'
              >
                +
              </Button>
              <Button
                size='xs'
                variant='ghost'
                color='white'
                _hover={{ bg: 'whiteAlpha.300' }}
                aria-label='Reset tissue canvas view'
                isDisabled={disabled}
                onClick={resetView}
                data-testid='tissue-zoom-reset'
              >
                Fit
              </Button>
            </HStack>
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', touchAction: 'none', pointerEvents: 'auto',
                cursor: disabled
                  ? 'default'
                  : isPanning
                    ? 'grabbing'
                    : isSpacePressed
                      ? 'grab'
                      : 'crosshair',
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onWheel={handleWheel}
            />
          </Box>

          {showControls ? (
            <ButtonGroup size='sm' isAttached variant='outline' alignSelf='flex-start'>
              <Button
                data-testid='tissue-tool-activate'
                colorScheme={activeTool === 'activate' ? 'brand' : 'gray'}
                isDisabled={disabled}
                onClick={() => handleToolChange('activate')}
              >
                Mark as tissue
              </Button>
              <Button
                data-testid='tissue-tool-deactivate'
                colorScheme={activeTool === 'deactivate' ? 'brand' : 'gray'}
                isDisabled={disabled}
                onClick={() => handleToolChange('deactivate')}
              >
                Mark as background
              </Button>
            </ButtonGroup>
          ) : null}
        </Stack>
      </CardBody>
    </Card>
  );
}
