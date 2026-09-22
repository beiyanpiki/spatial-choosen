'use client';

import { Badge, Box, Button, ButtonGroup, Flex, Heading, HStack, Slider, SliderFilledTrack, SliderThumb, SliderTrack, Stack, Text } from '@chakra-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { computeBaseView, computeZoomTransform, getTransform } from '@/lib/canvasViewport';
import type { Pan } from '@/lib/canvasViewport';
import {
  clampNormalizedSquareRect,
  LOCALIZATION_BOX_COLOR_SWATCHS,
  resizeChipBounds,
  translateChipBounds,
} from '@/lib/preprocess/localization';
import {
  FlipHorizontalIcon,
  FlipVerticalIcon,
  ResetIcon,
  RotateLeftIcon,
  RotateRightIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from './stageControlsIcons';
import type {
  LocalizationBoxColor,
  LocalizationImageTransform,
  LocalizationResizeHandle,
  PreprocessPoint,
  PreprocessRect,
  PreprocessSourceImage,
} from '@/types/preprocess';

type CanvasStageProps = {
  allowOutOfBoundsChipBounds?: boolean;
  boxColor: LocalizationBoxColor;
  chipBounds: PreprocessRect | null;
  onChipBoundsCancel?: () => void;
  onChipBoundsCommit?: (chipBounds: PreprocessRect) => void;
  containerTestId?: string;
  controlTestIdPrefix?: string;
  image: PreprocessSourceImage | null;
  imageTransform: LocalizationImageTransform;
  labels?: Partial<CanvasStageLabels>;
  onChipBoundsChange: (chipBounds: PreprocessRect) => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onResetTransform: () => void;
  onRotationChange: (rotationDegrees: number) => void;
  onRotationDelta: (delta: number) => void;
  onScaleChange: (scale: number) => void;
  onScaleDelta: (delta: number) => void;
};

type CanvasStageLabels = {
  badgeReady: string | null;
  badgeWaiting: string;
  description: string;
  emptyDescription: string;
  emptyTitle: string;
  heading: string;
  overlayAriaLabel: string;
  resetAriaLabel: string;
  savedHint: string;
};

type ViewportSize = {
  width: number;
  height: number;
};

type DragState =
  | {
      kind: 'move';
      startPoint: PreprocessPoint;
      startRect: PreprocessRect;
    }
  | {
      kind: 'resize';
      handle: LocalizationResizeHandle;
      startRect: PreprocessRect;
    }
  | {
      kind: 'rotate';
    }
  | {
      kind: 'pan';
      startScreen: ScreenPoint;
      startPan: Pan;
    };

type RotationOverlay = {
  centerPoint: { x: number; y: number };
  guidePoint: { x: number; y: number };
  handlePoint: { x: number; y: number };
};

type ScreenPoint = {
  x: number;
  y: number;
};

const CORNER_HANDLE_ORDER: readonly LocalizationResizeHandle[] = ['nw', 'ne', 'se', 'sw'];
const EDGE_HANDLE_ORDER: readonly LocalizationResizeHandle[] = ['n', 'e', 's', 'w'];
const ALL_HANDLE_ORDER: readonly LocalizationResizeHandle[] = [
  ...CORNER_HANDLE_ORDER,
  ...EDGE_HANDLE_ORDER,
];

const SCREEN_POINT_EPSILON = 1e-6;
const clampScale = (scale: number) => Math.min(4, Math.max(0.5, scale));
const normalizeDegrees = (value: number) => {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
};

const ZOOM_BUTTON_STEP = 0.1;
const ZOOM_WHEEL_FACTOR = 1.1;
const PAN_KEEP_VISIBLE_MARGIN = 48;
const KEYBOARD_NUDGE_STEP = 0.0025;
const KEYBOARD_NUDGE_LARGE_STEP = 0.01;
const KEYBOARD_COMMIT_DELAY_MS = 350;
const BOX_OUTLINE_HALO_COLOR = 'rgba(0, 0, 0, 0.55)';

const clampPanToKeepImageVisible = (pan: Pan, base: ReturnType<typeof computeBaseView>, scale: number): Pan => {
  if (!base) return pan;

  const scaledWidth = base.viewWidth * scale;
  const scaledHeight = base.viewHeight * scale;
  const margin = Math.min(PAN_KEEP_VISIBLE_MARGIN, scaledWidth / 2, scaledHeight / 2);
  const freeX = (base.viewWidth - scaledWidth) / 2;
  const freeY = (base.viewHeight - scaledHeight) / 2;
  const minPanX = margin - scaledWidth - base.viewX - freeX;
  const maxPanX = base.rect.width - margin - base.viewX - freeX;
  const minPanY = margin - scaledHeight - base.viewY - freeY;
  const maxPanY = base.rect.height - margin - base.viewY - freeY;

  return {
    x: Math.min(maxPanX, Math.max(minPanX, pan.x)),
    y: Math.min(maxPanY, Math.max(minPanY, pan.y)),
  };
};

const DEFAULT_CANVAS_STAGE_LABELS: CanvasStageLabels = {
  badgeReady: null,
  badgeWaiting: 'Awaiting eosin reference',
  description: 'Use the controls on the right to adjust the position and orientation of the NATA Align image until the ROI is completely enclosed within the green capture area.',
  emptyDescription: 'Upload the eosin reference image in Source images before placing the capture area.',
  emptyTitle: 'No eosin reference loaded',
  heading: 'Define Capture Area',
  overlayAriaLabel: 'Chip capture area overlay',
  resetAriaLabel: 'Reset localization transform',
  savedHint: 'Saved chip coordinates remain normalized in the eosin source image.',
};

const buildTestId = (prefix: string, suffix: string) => `${prefix}-${suffix}`;

const loadImageElement = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new window.Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Unable to load image preview'));
  image.src = src;
});

const projectCanvasPointToScreen = (
  point: PreprocessPoint,
  displayTransform: ReturnType<typeof getTransform>,
): ScreenPoint | null => {
  if (!displayTransform) return null;

  return {
    x: displayTransform.originX + point.x * displayTransform.width,
    y: displayTransform.originY + point.y * displayTransform.height,
  };
};

const projectScreenPointToCanvas = (
  screenPoint: ScreenPoint | null,
  displayTransform: ReturnType<typeof getTransform>,
): PreprocessPoint | null => {
  if (!screenPoint || !displayTransform) return null;

  return {
    x: (screenPoint.x - displayTransform.originX) / displayTransform.width,
    y: (screenPoint.y - displayTransform.originY) / displayTransform.height,
  };
};

const getRectSourceCorners = (
  rect: PreprocessRect,
): readonly [PreprocessPoint, PreprocessPoint, PreprocessPoint, PreprocessPoint] => [
  { x: rect.x, y: rect.y },
  { x: rect.x + rect.width, y: rect.y },
  { x: rect.x + rect.width, y: rect.y + rect.height },
  { x: rect.x, y: rect.y + rect.height },
] as const;

const getDistance = (start: ScreenPoint, end: ScreenPoint) => Math.hypot(end.x - start.x, end.y - start.y);

const getVisualLowerLeftPoint = (points: readonly ScreenPoint[]) => points.reduce((selected, point) => {
  const sameScreenRow = Math.abs(point.y - selected.y) <= SCREEN_POINT_EPSILON;
  const lowerOnScreen = point.y > selected.y + SCREEN_POINT_EPSILON;
  const sameRowAndFurtherLeft = sameScreenRow && point.x < selected.x;
  return lowerOnScreen || sameRowAndFurtherLeft ? point : selected;
});

const getVisualLowerLeftMarkerPoints = (
  polygonPoints: readonly ScreenPoint[],
): readonly [ScreenPoint, ScreenPoint, ScreenPoint] => {
  const edgeLengths = polygonPoints.map((point, index) => getDistance(point, polygonPoints[(index + 1) % polygonPoints.length]));
  const markerSize = Math.max(16, Math.min(32, Math.min(...edgeLengths) * 0.18));
  const lowerLeft = getVisualLowerLeftPoint(polygonPoints);

  return [
    { x: lowerLeft.x, y: lowerLeft.y - markerSize },
    lowerLeft,
    { x: lowerLeft.x + markerSize, y: lowerLeft.y },
  ] as const;
};

export function CanvasStage({
  allowOutOfBoundsChipBounds = false,
  boxColor,
  chipBounds,
  onChipBoundsCancel,
  onChipBoundsCommit,
  containerTestId = 'preprocess-localization-canvas-column',
  controlTestIdPrefix = 'localize',
  image,
  imageTransform,
  labels,
  onChipBoundsChange,
  onFlipHorizontal,
  onFlipVertical,
  onResetTransform,
  onRotationChange,
  onRotationDelta,
  onScaleChange,
  onScaleDelta,
}: CanvasStageProps) {
  const copy = {
    ...DEFAULT_CANVAS_STAGE_LABELS,
    ...labels,
  };
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragDidMoveRef = useRef(false);
  const dragLatestBoundsRef = useRef<PreprocessRect | null>(null);

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [viewportSize, setViewportSize] = useState<ViewportSize | null>(null);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const keyboardCommitTimeoutRef = useRef<number | null>(null);
  const pendingKeyboardBoundsRef = useRef<PreprocessRect | null>(null);
  const imageDataUrl = image?.workingDataUrl ?? image?.thumbnailDataUrl ?? image?.dataUrl ?? null;

  useEffect(() => () => {
    if (keyboardCommitTimeoutRef.current !== null) {
      window.clearTimeout(keyboardCommitTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!imageDataUrl) return;

    let cancelled = false;

    loadImageElement(imageDataUrl)
      .then((loadedImage) => {
        if (!cancelled) setImageElement(loadedImage);
      })
      .catch(() => {
        if (!cancelled) setImageElement(null);
      });

    return () => {
      cancelled = true;
    };
  }, [imageDataUrl]);

  const activeImageElement = imageDataUrl && imageElement?.src === imageDataUrl
    ? imageElement
    : null;

  useEffect(() => {
    const node = hostElement;
    if (!node) return;

    const updateSize = () => {
      setViewportSize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [hostElement]);

  const baseView = useMemo(() => {
    const ratio = image?.workingWidth && image?.workingHeight
      ? image.workingWidth / image.workingHeight
      : (image?.width && image?.height ? image.width / image.height : 4 / 3);

    return computeBaseView(viewportSize, ratio);
  }, [image?.workingWidth, image?.workingHeight, image?.height, image?.width, viewportSize]);

  const imageAspectRatio = image?.width && image?.height
    ? image.width / image.height
    : 1;

  const displayTransform = useMemo(
    () => getTransform(baseView, imageTransform.scale, pan),
    [baseView, imageTransform.scale, pan],
  );

  const normalizedChipBounds = useMemo(
    () => {
      if (!chipBounds) return null;
      return allowOutOfBoundsChipBounds
        ? chipBounds
        : clampNormalizedSquareRect(chipBounds, imageAspectRatio);
    },
    [allowOutOfBoundsChipBounds, chipBounds, imageAspectRatio],
  );

  const zoomStageTo = useCallback((nextScale: number, anchorNorm?: PreprocessPoint, anchorScreen?: ScreenPoint) => {
    const result = computeZoomTransform(baseView, nextScale, anchorNorm, anchorScreen);
    if (!result) return;
    setPan(clampPanToKeepImageVisible(result.pan, baseView, result.zoom));
  }, [baseView]);

  const resetStageView = useCallback(() => {
    setPan({ x: 0, y: 0 });
    onResetTransform();
  }, [onResetTransform]);

  const scheduleKeyboardCommit = useCallback((bounds: PreprocessRect) => {
    pendingKeyboardBoundsRef.current = bounds;
    if (keyboardCommitTimeoutRef.current !== null) {
      window.clearTimeout(keyboardCommitTimeoutRef.current);
    }
    keyboardCommitTimeoutRef.current = window.setTimeout(() => {
      keyboardCommitTimeoutRef.current = null;
      const pendingBounds = pendingKeyboardBoundsRef.current;
      pendingKeyboardBoundsRef.current = null;
      if (pendingBounds) {
        onChipBoundsCommit?.(pendingBounds);
      }
    }, KEYBOARD_COMMIT_DELAY_MS);
  }, [onChipBoundsCommit]);

  const handleStageKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      const nextScale = clampScale(imageTransform.scale + ZOOM_BUTTON_STEP);
      zoomStageTo(nextScale);
      onScaleChange(nextScale);
      return;
    }

    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      const nextScale = clampScale(imageTransform.scale - ZOOM_BUTTON_STEP);
      zoomStageTo(nextScale);
      onScaleChange(nextScale);
      return;
    }

    if (event.key === '0') {
      event.preventDefault();
      resetStageView();
      return;
    }

    const nudgeStep = event.shiftKey ? KEYBOARD_NUDGE_LARGE_STEP : KEYBOARD_NUDGE_STEP;
    const nudgeDelta = {
      ArrowUp: { x: 0, y: -nudgeStep },
      ArrowDown: { x: 0, y: nudgeStep },
      ArrowLeft: { x: -nudgeStep, y: 0 },
      ArrowRight: { x: nudgeStep, y: 0 },
    }[event.key];
    if (!nudgeDelta || !normalizedChipBounds) return;

    event.preventDefault();
    const nextBounds = translateChipBounds(
      normalizedChipBounds,
      nudgeDelta,
      imageAspectRatio,
      { clampToImage: !allowOutOfBoundsChipBounds },
    );
    onChipBoundsChange(nextBounds);
    scheduleKeyboardCommit(nextBounds);
  };

  const rotationOverlay = useMemo<RotationOverlay | null>(() => {
    if (!displayTransform) return null;

    const centerPoint = {
      x: displayTransform.originX + displayTransform.width / 2,
      y: displayTransform.originY + displayTransform.height / 2,
    };
    const baseDistance = Math.min(displayTransform.width, displayTransform.height) / 2;
    const handleDistance = baseDistance + 36;
    const rotationRadians = ((imageTransform.rotationDegrees - 90) * Math.PI) / 180;

    return {
      centerPoint,
      guidePoint: {
        x: centerPoint.x + Math.cos(rotationRadians) * Math.max(baseDistance, 24),
        y: centerPoint.y + Math.sin(rotationRadians) * Math.max(baseDistance, 24),
      },
      handlePoint: {
        x: centerPoint.x + Math.cos(rotationRadians) * handleDistance,
        y: centerPoint.y + Math.sin(rotationRadians) * handleDistance,
      },
    };
  }, [displayTransform, imageTransform.rotationDegrees]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !viewportSize) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(viewportSize.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(viewportSize.height * devicePixelRatio));
    canvas.style.width = `${viewportSize.width}px`;
    canvas.style.height = `${viewportSize.height}px`;

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, viewportSize.width, viewportSize.height);

    if (!activeImageElement || !displayTransform) return;

    context.save();
    context.translate(
      displayTransform.originX + displayTransform.width / 2,
      displayTransform.originY + displayTransform.height / 2,
    );
    context.scale(imageTransform.flipHorizontal ? -1 : 1, imageTransform.flipVertical ? -1 : 1);
    context.rotate((imageTransform.rotationDegrees * Math.PI) / 180);
    context.drawImage(
      activeImageElement,
      -displayTransform.width / 2,
      -displayTransform.height / 2,
      displayTransform.width,
      displayTransform.height,
    );
    context.restore();
  }, [activeImageElement, displayTransform, imageTransform, viewportSize]);

  const getRelativePoint = useCallback((clientX: number, clientY: number) => {
    const host = hostRef.current;
    if (!host) return null;

    const rect = host.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  const getOverlayImagePoint = useCallback((clientX: number, clientY: number) => {
    const relativePoint = getRelativePoint(clientX, clientY);
    return projectScreenPointToCanvas(relativePoint, displayTransform);
  }, [displayTransform, getRelativePoint]);

  const getInteractionImagePoint = useCallback((clientX: number, clientY: number) => (
    getOverlayImagePoint(clientX, clientY)
  ), [getOverlayImagePoint]);

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (dragState.kind === 'pan') {
        const relativePoint = getRelativePoint(event.clientX, event.clientY);
        if (!relativePoint) return;
        setPan(clampPanToKeepImageVisible(
          {
            x: dragState.startPan.x + (relativePoint.x - dragState.startScreen.x),
            y: dragState.startPan.y + (relativePoint.y - dragState.startScreen.y),
          },
          baseView,
          imageTransform.scale,
        ));
        return;
      }

      if (dragState.kind === 'rotate') {
        if (!rotationOverlay) return;
        const relativePoint = getRelativePoint(event.clientX, event.clientY);
        if (!relativePoint) return;
        const centerX = rotationOverlay.centerPoint.x;
        const centerY = rotationOverlay.centerPoint.y;
        const angleRadians = Math.atan2(relativePoint.y - centerY, relativePoint.x - centerX);
        onRotationChange(normalizeDegrees((angleRadians * 180) / Math.PI + 90));
        return;
      }

      const imagePoint = getInteractionImagePoint(event.clientX, event.clientY);
      if (!imagePoint) return;

      const nextBounds = dragState.kind === 'move'
        ? translateChipBounds(
            dragState.startRect,
            {
              x: imagePoint.x - dragState.startPoint.x,
              y: imagePoint.y - dragState.startPoint.y,
            },
            imageAspectRatio,
            { clampToImage: !allowOutOfBoundsChipBounds },
          )
        : resizeChipBounds(
            dragState.startRect,
            dragState.handle,
            imagePoint,
            imageAspectRatio,
            undefined,
            { clampToImage: !allowOutOfBoundsChipBounds },
          );

      dragDidMoveRef.current = true;
      dragLatestBoundsRef.current = nextBounds;
      onChipBoundsChange(nextBounds);
    };

    const handlePointerUp = () => {
      if (dragState.kind !== 'rotate' && dragDidMoveRef.current && dragLatestBoundsRef.current) {
        onChipBoundsCommit?.(dragLatestBoundsRef.current);
      }

      dragDidMoveRef.current = false;
      dragLatestBoundsRef.current = null;
      setDragState(null);
    };

    const handlePointerCancel = () => {
      dragDidMoveRef.current = false;
      dragLatestBoundsRef.current = null;
      onChipBoundsCancel?.();
      setDragState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [allowOutOfBoundsChipBounds, baseView, dragState, getInteractionImagePoint, getRelativePoint, imageAspectRatio, imageTransform.scale, onChipBoundsCancel, onChipBoundsChange, onChipBoundsCommit, onRotationChange, rotationOverlay]);

  useEffect(() => {
    const host = hostElement;
    if (!host || !image) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const anchorScreen = getRelativePoint(event.clientX, event.clientY);
      if (!anchorScreen) return;
      const anchorNorm = projectScreenPointToCanvas(anchorScreen, displayTransform) ?? undefined;
      const factor = event.deltaY > 0 ? 1 / ZOOM_WHEEL_FACTOR : ZOOM_WHEEL_FACTOR;
      const nextScale = clampScale(imageTransform.scale * factor);
      zoomStageTo(nextScale, anchorNorm, anchorScreen);
      onScaleChange(nextScale);
    };

    host.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      host.removeEventListener('wheel', handleWheel);
    };
  }, [displayTransform, getRelativePoint, hostElement, image, imageTransform.scale, onScaleChange, zoomStageTo]);

  const projectOverlayPointToScreen = useCallback((point: PreprocessPoint) => (
    projectCanvasPointToScreen(point, displayTransform)
  ), [displayTransform]);

  const overlay = useMemo(() => {
    if (!displayTransform || !normalizedChipBounds) return null;

    const polygonPoints = getRectSourceCorners(normalizedChipBounds)
      .map((point) => projectOverlayPointToScreen(point))
      .filter((point): point is NonNullable<typeof point> => Boolean(point));

    if (polygonPoints.length !== 4) return null;

    const markerPoints = getVisualLowerLeftMarkerPoints(polygonPoints);

    const cornerPoints = {
      nw: polygonPoints[0],
      ne: polygonPoints[1],
      se: polygonPoints[2],
      sw: polygonPoints[3],
    };

    const handlePoints: Record<LocalizationResizeHandle, { x: number; y: number }> = {
      ...cornerPoints,
      n: {
        x: (cornerPoints.nw.x + cornerPoints.ne.x) / 2,
        y: (cornerPoints.nw.y + cornerPoints.ne.y) / 2,
      },
      e: {
        x: (cornerPoints.ne.x + cornerPoints.se.x) / 2,
        y: (cornerPoints.ne.y + cornerPoints.se.y) / 2,
      },
      s: {
        x: (cornerPoints.sw.x + cornerPoints.se.x) / 2,
        y: (cornerPoints.sw.y + cornerPoints.se.y) / 2,
      },
      w: {
        x: (cornerPoints.nw.x + cornerPoints.sw.x) / 2,
        y: (cornerPoints.nw.y + cornerPoints.sw.y) / 2,
      },
    };

    return {
      polygonPoints,
      markerPoints,
      labelPoint: markerPoints[1],
      handlePoints,
    };
  }, [displayTransform, normalizedChipBounds, projectOverlayPointToScreen]);

  const swatch = LOCALIZATION_BOX_COLOR_SWATCHS[boxColor];

  return (
    <Stack flex='1' spacing={4} minW={0} data-testid={containerTestId}>
      <Flex justify='space-between' align={{ base: 'flex-start', md: 'center' }} wrap='wrap' gap={3}>
        <Stack spacing={1}>
          <Heading size='sm'>{copy.heading}</Heading>
          <Text fontSize='sm' color='gray.500'>{copy.description}</Text>
        </Stack>
        {image ? (
          copy.badgeReady ? (
            <Badge colorScheme='green' borderRadius='full'>{copy.badgeReady}</Badge>
          ) : null
        ) : (
          <Badge colorScheme='orange' borderRadius='full'>{copy.badgeWaiting}</Badge>
        )}
      </Flex>

      <Box
        position='relative'
        minH={{ base: '520px', lg: '760px' }}
        h={{ base: '60vh', lg: '74vh' }}
        maxH='900px'
        borderRadius='2xl'
        overflow='hidden'
        bg='gray.900'
        data-testid={buildTestId(controlTestIdPrefix, 'canvas-surface')}
      >
        {image ? (
          <>
            <Box
              ref={(node) => {
                hostRef.current = node;
                setHostElement(node);
              }}
              position='absolute'
              inset={0}
              tabIndex={0}
              outline='none'
              _focusVisible={{ boxShadow: `inset 0 0 0 2px rgba(47, 150, 249, 0.7)` }}
              onKeyDown={handleStageKeyDown}
              data-testid={buildTestId(controlTestIdPrefix, 'canvas-host')}
            >
              <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
              {viewportSize && overlay ? (
                <svg
                  width='100%'
                  height='100%'
                  viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
                  role='img'
                  aria-label={copy.overlayAriaLabel}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    touchAction: 'none',
                    cursor: dragState?.kind === 'pan' ? 'grabbing' : 'grab',
                  }}
                  onPointerDown={(event) => {
                    const relativePoint = getRelativePoint(event.clientX, event.clientY);
                    if (!relativePoint) return;
                    event.preventDefault();
                    setDragState({ kind: 'pan', startScreen: relativePoint, startPan: pan });
                  }}
                >
                  <polygon
                    points={overlay.polygonPoints.map((point) => `${point.x},${point.y}`).join(' ')}
                    fill='none'
                    stroke={BOX_OUTLINE_HALO_COLOR}
                    strokeWidth={3.5}
                    strokeLinejoin='round'
                    data-testid={buildTestId(controlTestIdPrefix, 'box-outline-halo')}
                    pointerEvents='none'
                  />
                  <polygon
                    points={overlay.polygonPoints.map((point) => `${point.x},${point.y}`).join(' ')}
                    fill={swatch.fill}
                    stroke={swatch.stroke}
                    strokeWidth={1.5}
                    strokeLinejoin='round'
                    data-testid={buildTestId(controlTestIdPrefix, 'box-outline')}
                    pointerEvents='none'
                  />
                  <polygon
                    points={overlay.polygonPoints.map((point) => `${point.x},${point.y}`).join(' ')}
                    fill='transparent'
                    stroke='transparent'
                    strokeWidth={20}
                    data-testid={buildTestId(controlTestIdPrefix, 'box-body')}
                    style={{ cursor: dragState ? 'grabbing' : 'move' }}
                    onPointerDown={(event) => {
                      if (!normalizedChipBounds) return;
                      const point = getOverlayImagePoint(event.clientX, event.clientY);
                      if (!point) return;
                      event.preventDefault();
                      event.stopPropagation();
                      dragDidMoveRef.current = false;
                      dragLatestBoundsRef.current = null;
                      setDragState({ kind: 'move', startPoint: point, startRect: normalizedChipBounds });
                    }}
                  />
                  <polyline
                    points={overlay.markerPoints.map((point) => `${point.x},${point.y}`).join(' ')}
                    fill='none'
                    stroke={swatch.stroke}
                    strokeWidth={3}
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    data-testid={buildTestId(controlTestIdPrefix, 'box-lower-left-marker')}
                    pointerEvents='none'
                  />
                  <text
                    x={overlay.labelPoint.x + 8}
                    y={overlay.labelPoint.y - 8}
                    fill={swatch.stroke}
                    fontSize='12'
                    fontWeight='700'
                    pointerEvents='none'
                    data-testid={buildTestId(controlTestIdPrefix, 'box-lower-left-label')}
                  >
                    LL
                  </text>
                  {ALL_HANDLE_ORDER.map((handle) => (
                    <circle
                      key={`visual-${handle}`}
                      cx={overlay.handlePoints[handle].x}
                      cy={overlay.handlePoints[handle].y}
                      r={4.5}
                      fill='white'
                      stroke={swatch.stroke}
                      strokeWidth={1.5}
                      pointerEvents='none'
                      data-testid={buildTestId(controlTestIdPrefix, `box-handle-visual-${handle}`)}
                    />
                  ))}
                  {ALL_HANDLE_ORDER.map((handle) => (
                    <circle
                      key={handle}
                      cx={overlay.handlePoints[handle].x}
                      cy={overlay.handlePoints[handle].y}
                      r={13}
                      fill='transparent'
                      stroke='transparent'
                      data-testid={buildTestId(controlTestIdPrefix, `box-handle-${handle}`)}
                      style={{
                        cursor: handle === 'n' || handle === 's'
                          ? 'ns-resize'
                          : handle === 'e' || handle === 'w'
                            ? 'ew-resize'
                            : `${handle}-resize`,
                      }}
                      onPointerDown={(event) => {
                        if (!normalizedChipBounds) return;
                        event.preventDefault();
                        event.stopPropagation();
                        dragDidMoveRef.current = false;
                        dragLatestBoundsRef.current = null;
                        setDragState({ kind: 'resize', handle, startRect: normalizedChipBounds });
                      }}
                    />
                  ))}
                </svg>
              ) : null}
              {viewportSize && rotationOverlay ? (
                <svg
                  width='100%'
                  height='100%'
                  viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
                  style={{ position: 'absolute', inset: 0, touchAction: 'none', pointerEvents: 'none' }}
                  aria-hidden='true'
                >
                  <line
                    x1={rotationOverlay.guidePoint.x}
                    y1={rotationOverlay.guidePoint.y}
                    x2={rotationOverlay.handlePoint.x}
                    y2={rotationOverlay.handlePoint.y}
                    stroke={swatch.stroke}
                    strokeWidth={2}
                    pointerEvents='none'
                  />
                  <circle
                    cx={rotationOverlay.handlePoint.x}
                    cy={rotationOverlay.handlePoint.y}
                    r={11}
                    fill='black'
                    fillOpacity={0.75}
                    stroke={swatch.stroke}
                    strokeWidth={2}
                    data-testid={buildTestId(controlTestIdPrefix, 'rotation-handle-visible')}
                    style={{ cursor: dragState?.kind === 'rotate' ? 'grabbing' : 'grab', pointerEvents: 'auto' }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDragState({ kind: 'rotate' });
                    }}
                  />
                </svg>
              ) : null}
              {viewportSize && overlay && normalizedChipBounds && image?.width && image?.height && (dragState?.kind === 'move' || dragState?.kind === 'resize') ? (
                <Box
                  position='absolute'
                  left={overlay.handlePoints.n.x}
                  top={overlay.handlePoints.n.y}
                  transform='translate(-50%, -150%)'
                  bg='blackAlpha.800'
                  color='white'
                  px={2}
                  py={1}
                  borderRadius='md'
                  fontSize='xs'
                  fontWeight='semibold'
                  whiteSpace='nowrap'
                  pointerEvents='none'
                  data-testid={buildTestId(controlTestIdPrefix, 'box-size-readout')}
                >
                  {`${Math.round(normalizedChipBounds.width * image.width)} × ${Math.round(normalizedChipBounds.height * image.height)} px`}
                </Box>
              ) : null}
            </Box>
            <Box
              position='absolute'
              top={4}
              left={4}
              bg='blackAlpha.700'
              color='whiteAlpha.800'
              px={3}
              py={2}
              borderRadius='lg'
              data-testid={buildTestId(controlTestIdPrefix, 'stage-hints')}
            >
              <Text fontSize='xs'>Scroll to zoom · Drag canvas to pan · Drag box to move · Arrow keys to fine-tune</Text>
            </Box>
            <Box
              position='absolute'
              top={4}
              right={4}
              bg='blackAlpha.700'
              color='whiteAlpha.950'
              border='1px solid'
              borderColor='whiteAlpha.300'
              borderRadius='xl'
              px={3}
              py={3}
              backdropFilter='blur(12px)'
              data-testid={buildTestId(controlTestIdPrefix, 'stage-controls')}
            >
              <Stack spacing={3} minW='220px'>
                <Stack spacing={2} data-testid={buildTestId(controlTestIdPrefix, 'stage-section-zoom')}>
                  <Flex justify='space-between' align='center' gap={3}>
                    <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>Zoom</Text>
                    <Text fontSize='sm' fontWeight='semibold' data-testid={buildTestId(controlTestIdPrefix, 'stage-scale-value')}>
                      {(imageTransform.scale * 100).toFixed(0)}%
                    </Text>
                  </Flex>
                  <ButtonGroup size='sm' isAttached variant='outline' w='100%'>
                    <Button
                      aria-label='Zoom out'
                      data-testid={buildTestId(controlTestIdPrefix, 'stage-zoom-out')}
                      onClick={() => {
                        zoomStageTo(clampScale(imageTransform.scale - ZOOM_BUTTON_STEP));
                        onScaleDelta(-ZOOM_BUTTON_STEP);
                      }}
                      flex={1}
                      color='white'
                      borderColor='whiteAlpha.400'
                      _hover={{ bg: 'whiteAlpha.200' }}
                    >
                      <ZoomOutIcon />
                    </Button>
                    <Button
                      aria-label='Zoom in'
                      data-testid={buildTestId(controlTestIdPrefix, 'stage-zoom-in')}
                      onClick={() => {
                        zoomStageTo(clampScale(imageTransform.scale + ZOOM_BUTTON_STEP));
                        onScaleDelta(ZOOM_BUTTON_STEP);
                      }}
                      flex={1}
                      color='white'
                      borderColor='whiteAlpha.400'
                      _hover={{ bg: 'whiteAlpha.200' }}
                    >
                      <ZoomInIcon />
                    </Button>
                  </ButtonGroup>
                </Stack>
                <Stack spacing={2} data-testid={buildTestId(controlTestIdPrefix, 'stage-section-rotation')}>
                  <Flex justify='space-between' align='center' gap={3}>
                    <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>Rotation</Text>
                    <Text fontSize='sm' fontWeight='semibold' data-testid={buildTestId(controlTestIdPrefix, 'stage-rotation-value')}>
                      {imageTransform.rotationDegrees.toFixed(1)}°
                    </Text>
                  </Flex>
                  <ButtonGroup size='sm' variant='outline' isAttached w='100%'>
                    <Button
                      aria-label='Rotate left 90 degrees'
                      data-testid={buildTestId(controlTestIdPrefix, 'stage-rotate-left-90')}
                      onClick={() => onRotationDelta(-90)}
                      flex={1}
                      color='white'
                      borderColor='whiteAlpha.400'
                      _hover={{ bg: 'whiteAlpha.200' }}
                    >
                      <HStack spacing={1.5}>
                        <RotateLeftIcon />
                        <Text as='span' fontSize='xs' fontWeight='semibold'>90°</Text>
                      </HStack>
                    </Button>
                    <Button
                      aria-label='Rotate right 90 degrees'
                      data-testid={buildTestId(controlTestIdPrefix, 'stage-rotate-right-90')}
                      onClick={() => onRotationDelta(90)}
                      flex={1}
                      color='white'
                      borderColor='whiteAlpha.400'
                      _hover={{ bg: 'whiteAlpha.200' }}
                    >
                      <HStack spacing={1.5}>
                        <RotateRightIcon />
                        <Text as='span' fontSize='xs' fontWeight='semibold'>90°</Text>
                      </HStack>
                    </Button>
                    <Button
                      aria-label='Rotate left 1 degree'
                      data-testid={buildTestId(controlTestIdPrefix, 'stage-rotate-left-1')}
                      onClick={() => onRotationDelta(-1)}
                      flex={1}
                      color='white'
                      borderColor='whiteAlpha.400'
                      _hover={{ bg: 'whiteAlpha.200' }}
                    >
                      <HStack spacing={1.5}>
                        <RotateLeftIcon />
                        <Text as='span' fontSize='xs' fontWeight='semibold'>1°</Text>
                      </HStack>
                    </Button>
                    <Button
                      aria-label='Rotate right 1 degree'
                      data-testid={buildTestId(controlTestIdPrefix, 'stage-rotate-right-1')}
                      onClick={() => onRotationDelta(1)}
                      flex={1}
                      color='white'
                      borderColor='whiteAlpha.400'
                      _hover={{ bg: 'whiteAlpha.200' }}
                    >
                      <HStack spacing={1.5}>
                        <RotateRightIcon />
                        <Text as='span' fontSize='xs' fontWeight='semibold'>1°</Text>
                      </HStack>
                    </Button>
                  </ButtonGroup>
                  <Slider
                    aria-label='Fine rotation'
                    data-testid={buildTestId(controlTestIdPrefix, 'stage-rotation-slider')}
                    min={-180}
                    max={180}
                    step={0.1}
                    value={imageTransform.rotationDegrees}
                    onChange={(value) => onRotationChange(value)}
                    focusThumbOnChange={false}
                    colorScheme='brand'
                  >
                    <SliderTrack bg='whiteAlpha.300'>
                      <SliderFilledTrack bg='brand.400' />
                    </SliderTrack>
                    <SliderThumb bg='white' boxSize={3.5} />
                  </Slider>
                </Stack>
                <Stack spacing={2} data-testid={buildTestId(controlTestIdPrefix, 'stage-section-flip')}>
                  <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>Flip</Text>
                  <ButtonGroup size='sm' variant='outline' isAttached w='100%'>
                    <Button
                      aria-label='Flip horizontally'
                      data-testid={buildTestId(controlTestIdPrefix, 'stage-flip-horizontal')}
                      onClick={onFlipHorizontal}
                      flex={1}
                      color='white'
                      borderColor='whiteAlpha.400'
                      _hover={{ bg: 'whiteAlpha.200' }}
                    >
                      <HStack spacing={1.5}>
                        <FlipHorizontalIcon />
                        <Text as='span' fontSize='xs' fontWeight='semibold'>H</Text>
                      </HStack>
                    </Button>
                    <Button
                      aria-label='Flip vertically'
                      data-testid={buildTestId(controlTestIdPrefix, 'stage-flip-vertical')}
                      onClick={onFlipVertical}
                      flex={1}
                      color='white'
                      borderColor='whiteAlpha.400'
                      _hover={{ bg: 'whiteAlpha.200' }}
                    >
                      <HStack spacing={1.5}>
                        <FlipVerticalIcon />
                        <Text as='span' fontSize='xs' fontWeight='semibold'>V</Text>
                      </HStack>
                    </Button>
                  </ButtonGroup>
                </Stack>
                <Stack spacing={2} data-testid={buildTestId(controlTestIdPrefix, 'stage-section-reset')}>
                  <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>Reset</Text>
                  <Button
                    aria-label={copy.resetAriaLabel}
                    size='sm'
                    variant='outline'
                    w='100%'
                    data-testid={buildTestId(controlTestIdPrefix, 'stage-reset')}
                    onClick={resetStageView}
                    color='white'
                    borderColor='whiteAlpha.400'
                    _hover={{ bg: 'whiteAlpha.200' }}
                  >
                    <HStack spacing={1.5}>
                      <ResetIcon />
                      <Text as='span' fontSize='xs' fontWeight='semibold'>Reset</Text>
                    </HStack>
                  </Button>
                </Stack>
              </Stack>
            </Box>
            <Box position='absolute' left={4} bottom={4} bg='blackAlpha.700' color='whiteAlpha.900' px={3} py={2} borderRadius='lg' maxW='320px'>
              <Text fontSize='xs'>{copy.savedHint}</Text>
            </Box>
          </>
        ) : (
          <Flex align='center' justify='center' h='100%' px={6} textAlign='center'>
            <Stack spacing={3} maxW='420px'>
              <Text fontSize='lg' fontWeight='semibold' color='whiteAlpha.900'>{copy.emptyTitle}</Text>
              <Text color='whiteAlpha.700'>{copy.emptyDescription}</Text>
            </Stack>
          </Flex>
        )}
      </Box>
    </Stack>
  );
}
