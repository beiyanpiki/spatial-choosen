'use client';

import {
  Badge,
  Box,
  Button,
  ButtonGroup,
  Flex,
  HStack,
  Heading,
  Input,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Stack,
  Switch,
  Text,
} from '@chakra-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DEFAULT_SIMILARITY_PARAMS,
  SIMILARITY_SCALE_MAX,
  SIMILARITY_SCALE_MIN,
  applyAffine,
  clamp,
  composeAffine,
  normalizeSimilarityParams,
  referencePixelToStageMatrix,
  resolvePackageMatrix,
  scaleAffineInput,
  similarityPixelMatrix,
} from '@/lib/batch/affine';
import { spotRect } from '@/lib/batch/selection';
import { computeBaseView, computeZoomTransform, getTransform } from '@/lib/canvasViewport';
import type {
  BatchImageSize,
  BatchMatrixConvention,
  BatchSimilarityParams,
  BatchSpot,
  BatchSpotAnchorMode,
} from '@/types/batch';

import {
  PREVIEW_STAGE_ZOOM_MAX,
  PREVIEW_STAGE_ZOOM_MIN,
  useDraggableOverlay,
  useStageImage,
  useViewportSize,
} from './stageSupport';

export type BatchAlignTarget = {
  name: string;
  previewUrl: string | null;
  previewSize: BatchImageSize | null;
  size: BatchImageSize | null;
  spots: BatchSpot[] | null;
  spotDiameterFullres: number | null;
};

type DragState =
  | { kind: 'move'; startX: number; startY: number; startOffsetX: number; startOffsetY: number }
  | { kind: 'rotate'; startAngle: number; startRotation: number }
  | { kind: 'pan'; startX: number; startY: number; startPanX: number; startPanY: number };

type BatchAlignStageProps = {
  /**
   * Image drawn underneath the overlay. It is shown with the alignment it was
   * given in this step, so picking image 2 as the base shows the image 2 the
   * operator already matched onto image 1 rather than the raw scan.
   */
  base: BatchAlignTarget;
  /** Alignment of the base image, which places it inside the batch frame. */
  baseParams: BatchSimilarityParams;
  /** Frame everything is drawn in: the batch reference (image[0]). */
  frame: BatchImageSize | null;
  moving: BatchAlignTarget;
  /** Alignment of the overlay, in the batch frame — what the export writes. */
  params: BatchSimilarityParams;
  onParamsChange: (params: BatchSimilarityParams) => void;
  anchorMode: BatchSpotAnchorMode;
  matrixConvention: BatchMatrixConvention;
  frameName?: string;
  testIdPrefix?: string;
};

const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const REFERENCE_GRID_COLOR = 'rgba(34, 211, 238, 0.85)';
const MOVING_GRID_COLOR = 'rgba(250, 204, 21, 0.9)';

const normalizeDegrees = (value: number) => {
  const wrapped = (((value + 180) % 360) + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
};

const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const formatNumber = (value: number, decimals = 3) => (
  Number.isFinite(value) ? roundTo(value, decimals).toFixed(decimals) : '—'
);

type NumericFieldProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  suffix?: string;
  onChange: (value: number) => void;
  testId?: string;
};

function NumericField({
  label,
  value,
  min,
  max,
  step,
  decimals = 2,
  suffix,
  onChange,
  testId,
}: NumericFieldProps) {
  const [draft, setDraft] = useState(() => roundTo(value, decimals).toFixed(decimals));

  useEffect(() => {
    setDraft(roundTo(value, decimals).toFixed(decimals));
  }, [decimals, value]);

  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      onChange(clamp(parsed, min, max));
      return;
    }

    setDraft(roundTo(value, decimals).toFixed(decimals));
  };

  return (
    <HStack spacing={2} align='center'>
      <Text fontSize='xs' color='gray.500' minW='72px'>{label}</Text>
      <Input
        size='xs'
        w='96px'
        value={draft}
        inputMode='decimal'
        data-testid={testId}
        onChange={(event) => {
          setDraft(event.target.value);
          commit(event.target.value);
        }}
        onBlur={() => setDraft(roundTo(value, decimals).toFixed(decimals))}
      />
      <ButtonGroup size='xs' isAttached variant='outline'>
        <Button
          color='white'
          borderColor='whiteAlpha.500'
          _hover={{ bg: 'whiteAlpha.200' }}
          data-testid={testId ? `${testId}-minus` : undefined}
          onClick={() => onChange(clamp(value - step, min, max))}
          aria-label={`${label} minus`}
        >
          −
        </Button>
        <Button
          color='white'
          borderColor='whiteAlpha.500'
          _hover={{ bg: 'whiteAlpha.200' }}
          data-testid={testId ? `${testId}-plus` : undefined}
          onClick={() => onChange(clamp(value + step, min, max))}
          aria-label={`${label} plus`}
        >
          +
        </Button>
      </ButtonGroup>
      {suffix ? <Text fontSize='xs' color='gray.500'>{suffix}</Text> : null}
    </HStack>
  );
}

const drawSpotGrid = (
  ctx: CanvasRenderingContext2D,
  spots: readonly BatchSpot[] | null,
  spotDiameterFullres: number | null,
  anchorMode: BatchSpotAnchorMode,
  matrix: [number, number, number, number, number, number],
  color: string,
) => {
  if (!spots || spots.length === 0) return;

  const scale = Math.hypot(matrix[0], matrix[3]);
  const diameter = spotDiameterFullres ?? 0;
  const size = diameter * scale;
  const drawDots = size < 3;

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;

  for (const spot of spots) {
    const rect = spotRect(spot, anchorMode, spotDiameterFullres);
    const corner = applyAffine(matrix, { x: rect.x, y: rect.y });

    if (drawDots) {
      ctx.fillRect(corner.x - 1, corner.y - 1, 2.5, 2.5);
      continue;
    }

    ctx.strokeRect(corner.x, corner.y, rect.width * scale, rect.height * scale);
  }

  ctx.restore();
};

export function BatchAlignStage({
  base,
  baseParams,
  frame,
  moving,
  params,
  onParamsChange,
  anchorMode,
  matrixConvention,
  frameName,
  testIdPrefix = 'batch-align',
}: BatchAlignStageProps) {
  const baseImage = useStageImage(base.previewUrl);
  const movingImage = useStageImage(moving.previewUrl);
  const { ref: hostRef, size: viewport, setElement: setHostElement } = useViewportSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Both overlays are draggable, so neither has to sit on top of the tissue. */
  const {
    ref: controlsRef,
    offset: controlsOffset,
    isDragging: isControlsDragging,
    startDrag: startControlsDrag,
    reset: resetControlsOffset,
  } = useDraggableOverlay();
  const {
    ref: matrixBoxRef,
    offset: matrixBoxOffset,
    isDragging: isMatrixBoxDragging,
    startDrag: startMatrixBoxDrag,
    reset: resetMatrixBoxOffset,
  } = useDraggableOverlay();
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [overlayOpacity, setOverlayOpacity] = useState(0.55);
  // The spot lattice is off by default: it obscures the tissue while the
  // operator is judging rotation and scale. The switch re-enables it per session.
  const [showGrid, setShowGrid] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const frameSize = frame ?? base.size;
  const baseSize = base.size;
  const basePreviewSize = base.previewSize;
  const movingSize = moving.size;
  const movingPreviewSize = moving.previewSize;
  const targetName = frameName ?? base.name;

  const baseView = useMemo(() => {
    if (!frameSize) return null;
    const ratio = frameSize.height > 0 ? frameSize.width / frameSize.height : 1;
    return computeBaseView(viewport, ratio);
  }, [frameSize, viewport]);

  const stage = useMemo(() => getTransform(baseView, viewZoom, viewPan), [baseView, viewPan, viewZoom]);

  const frameToStage = useMemo(() => (
    frameSize && stage ? referencePixelToStageMatrix(frameSize, stage) : null
  ), [frameSize, stage]);

  /** The base image placed inside the batch frame by its own alignment. */
  const baseToStage = useMemo(() => {
    if (!frameToStage || !frameSize || !baseSize) return null;
    return composeAffine(frameToStage, similarityPixelMatrix(baseParams, baseSize, frameSize));
  }, [baseParams, baseSize, frameSize, frameToStage]);

  const basePreviewToStage = useMemo(() => {
    if (!baseToStage || !baseSize || !basePreviewSize) return null;

    return scaleAffineInput(
      baseToStage,
      baseSize.width / basePreviewSize.width,
      baseSize.height / basePreviewSize.height,
    );
  }, [basePreviewSize, baseSize, baseToStage]);

  const movingToStage = useMemo(() => {
    if (!frameToStage || !frameSize || !movingSize) return null;
    return composeAffine(
      frameToStage,
      similarityPixelMatrix(params, movingSize, frameSize),
    );
  }, [frameSize, frameToStage, movingSize, params]);

  const movingPreviewToStage = useMemo(() => {
    if (!movingToStage || !movingSize || !movingPreviewSize) return null;

    return scaleAffineInput(
      movingToStage,
      movingSize.width / movingPreviewSize.width,
      movingSize.height / movingPreviewSize.height,
    );
  }, [movingSize, movingPreviewSize, movingToStage]);

  const movingCenterStage = useMemo(() => {
    if (!movingPreviewToStage || !movingPreviewSize) return null;
    return applyAffine(movingPreviewToStage, {
      x: movingPreviewSize.width / 2,
      y: movingPreviewSize.height / 2,
    });
  }, [movingPreviewSize, movingPreviewToStage]);

  const rotationHandle = useMemo(() => {
    if (!movingCenterStage || !movingPreviewToStage || !movingPreviewSize) return null;

    const widthOnScreen = Math.hypot(movingPreviewToStage[0], movingPreviewToStage[3]) * movingPreviewSize.width;
    const heightOnScreen = Math.hypot(movingPreviewToStage[1], movingPreviewToStage[4]) * movingPreviewSize.height;
    const radius = clamp(0.5 * Math.max(widthOnScreen, heightOnScreen) * 0.72, 70, 1200);
    const angle = (params.rotationDegrees - 90) * DEGREES_TO_RADIANS;

    return {
      center: movingCenterStage,
      point: {
        x: movingCenterStage.x + Math.cos(angle) * radius,
        y: movingCenterStage.y + Math.sin(angle) * radius,
      },
    };
  }, [movingCenterStage, movingPreviewSize, movingPreviewToStage, params.rotationDegrees]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !viewport || !stage) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(viewport.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(viewport.height * devicePixelRatio));
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);

    if (baseImage && basePreviewToStage) {
      // Drawn through its alignment, so a rotated/scaled base is shown the way
      // the operator matched it rather than in raw scan orientation.
      context.save();
      context.setTransform(
        devicePixelRatio * basePreviewToStage[0],
        devicePixelRatio * basePreviewToStage[3],
        devicePixelRatio * basePreviewToStage[1],
        devicePixelRatio * basePreviewToStage[4],
        devicePixelRatio * basePreviewToStage[2],
        devicePixelRatio * basePreviewToStage[5],
      );
      context.drawImage(baseImage, 0, 0);
      context.restore();
    }

    if (movingImage && movingPreviewToStage) {
      context.save();
      context.globalAlpha = overlayOpacity;
      context.setTransform(
        devicePixelRatio * movingPreviewToStage[0],
        devicePixelRatio * movingPreviewToStage[3],
        devicePixelRatio * movingPreviewToStage[1],
        devicePixelRatio * movingPreviewToStage[4],
        devicePixelRatio * movingPreviewToStage[2],
        devicePixelRatio * movingPreviewToStage[5],
      );
      context.drawImage(movingImage, 0, 0);
      context.restore();
    }

    if (showGrid && baseToStage) {
      drawSpotGrid(
        context,
        base.spots,
        base.spotDiameterFullres,
        anchorMode,
        baseToStage,
        REFERENCE_GRID_COLOR,
      );
    }

    if (showGrid && movingToStage) {
      drawSpotGrid(
        context,
        moving.spots,
        moving.spotDiameterFullres,
        anchorMode,
        movingToStage,
        MOVING_GRID_COLOR,
      );
    }

  }, [
    anchorMode,
    base.spotDiameterFullres,
    base.spots,
    basePreviewToStage,
    baseImage,
    baseToStage,
    movingImage,
    movingPreviewToStage,
    moving.spotDiameterFullres,
    moving.spots,
    movingToStage,
    overlayOpacity,
    showGrid,
    stage,
    viewport,
  ]);

  const getRelativePoint = useCallback((clientX: number, clientY: number) => {
    const host = hostRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, [hostRef]);

  useEffect(() => {
    if (!dragState || !stage) return;

    const handlePointerMove = (event: PointerEvent) => {
      const relative = getRelativePoint(event.clientX, event.clientY);
      if (!relative) return;

      if (dragState.kind === 'pan') {
        setViewPan({
          x: dragState.startPanX + (event.clientX - dragState.startX),
          y: dragState.startPanY + (event.clientY - dragState.startY),
        });
        return;
      }

      if (dragState.kind === 'rotate') {
        if (!movingCenterStage) return;
        const angle = Math.atan2(
          relative.y - movingCenterStage.y,
          relative.x - movingCenterStage.x,
        ) * RADIANS_TO_DEGREES;

        onParamsChange(normalizeSimilarityParams({
          ...params,
          rotationDegrees: normalizeDegrees(angle + 90),
        }));
        return;
      }

      const startRelative = { x: dragState.startX, y: dragState.startY };
      onParamsChange(normalizeSimilarityParams({
        ...params,
        offsetX: dragState.startOffsetX + (relative.x - startRelative.x) / stage.width,
        offsetY: dragState.startOffsetY + (relative.y - startRelative.y) / stage.height,
      }));
    };

    const handlePointerUp = () => setDragState(null);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState, getRelativePoint, movingCenterStage, onParamsChange, params, stage]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !stage || stage.width <= 0 || stage.height <= 0) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const anchorScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      // Zoom into the pointer instead of growing the view from its centre.
      const anchorNorm = {
        x: clamp((anchorScreen.x - stage.originX) / stage.width, 0, 1),
        y: clamp((anchorScreen.y - stage.originY) / stage.height, 0, 1),
      };
      const next = computeZoomTransform(
        baseView,
        viewZoom * (event.deltaY > 0 ? 0.9 : 1.1),
        anchorNorm,
        anchorScreen,
      );

      if (!next) return;
      setViewZoom(next.zoom);
      setViewPan(next.pan);
    };

    host.addEventListener('wheel', handleWheel, { passive: false });
    return () => host.removeEventListener('wheel', handleWheel);
  }, [baseView, hostRef, stage, viewZoom]);

  const canAlign = Boolean(baseImage && movingImage && frameSize && movingSize);
  const pixelMatrixText = useMemo(() => {
    if (!frameSize || !movingSize) return '—';
    const matrix = resolvePackageMatrix({
      convention: matrixConvention,
      params,
      sourceSize: movingSize,
      referenceSize: frameSize,
    });
    return matrix.map((value) => formatNumber(value, 4)).join('  ');
  }, [frameSize, matrixConvention, movingSize, params]);
  /** The base is one of the other samples, so this image follows it. */
  const chainedToBase = Boolean(frameName && base.name !== frameName);

  return (
    <Stack spacing={4} flex='1' minW={0} data-testid={`${testIdPrefix}-stage`}>
      <Flex justify='space-between' align={{ base: 'flex-start', md: 'center' }} gap={3} wrap='wrap'>
        <Stack spacing={1}>
          <Heading size='sm'>Align {moving.name} to {base.name}</Heading>
          <Text fontSize='sm' color='gray.500'>
            Drag the overlay to move it, drag the handle to rotate, then fine-tune scale.
            Rotation and scale pivot on the image centre.
            {chainedToBase
              ? ` ${base.name} is drawn in the pose you gave it, so both pictures sit in the ${targetName} frame; this image also follows later adjustments of ${base.name}.`
              : ''}
          </Text>
        </Stack>
        <HStack spacing={2}>
          <Badge colorScheme={canAlign ? 'green' : 'orange'} borderRadius='full'>
            {canAlign ? 'Ready' : 'Waiting for images'}
          </Badge>
        </HStack>
      </Flex>

      <Box
        position='relative'
        minH={{ base: '460px', lg: '680px' }}
        h={{ base: '58vh', lg: '70vh' }}
        maxH='900px'
        borderRadius='2xl'
        bg='gray.900'
      >
        {/* Only the canvas layer is clipped; the floating panels below stay
            unclipped so they can be parked anywhere on the page. */}
        <Box
          ref={(node) => {
            hostRef.current = node;
            setHostElement(node);
          }}
          position='absolute'
          inset={0}
          overflow='hidden'
          borderRadius='2xl'
          data-testid={`${testIdPrefix}-surface`}
        >
          <canvas
            ref={canvasRef}
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              touchAction: 'none',
              cursor: dragState?.kind === 'move' ? 'grabbing' : 'grab',
            }}
            onPointerDown={(event) => {
              if (!stage) return;
              if (event.button === 1) {
                event.preventDefault();
                setDragState({
                  kind: 'pan',
                  startX: event.clientX,
                  startY: event.clientY,
                  startPanX: viewPan.x,
                  startPanY: viewPan.y,
                });
                return;
              }

              if (event.button !== 0) return;
              const relative = getRelativePoint(event.clientX, event.clientY);
              if (!relative) return;
              event.preventDefault();
              setDragState({
                kind: 'move',
                startX: relative.x,
                startY: relative.y,
                startOffsetX: params.offsetX,
                startOffsetY: params.offsetY,
              });
            }}
          />
          {rotationHandle ? (
            <svg
              width='100%'
              height='100%'
              viewBox={`0 0 ${viewport?.width ?? 0} ${viewport?.height ?? 0}`}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              aria-hidden='true'
            >
              <line
                x1={rotationHandle.center.x}
                y1={rotationHandle.center.y}
                x2={rotationHandle.point.x}
                y2={rotationHandle.point.y}
                stroke='rgba(255,255,255,0.6)'
                strokeWidth={1.5}
                strokeDasharray='4 4'
              />
              <circle
                cx={rotationHandle.point.x}
                cy={rotationHandle.point.y}
                r={11}
                fill='rgba(0,0,0,0.7)'
                stroke='rgba(255,255,255,0.9)'
                strokeWidth={2}
                data-testid={`${testIdPrefix}-rotation-handle`}
                style={{ cursor: 'grab', pointerEvents: 'auto' }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!movingCenterStage) return;
                  const relative = getRelativePoint(event.clientX, event.clientY);
                  if (!relative) return;
                  setDragState({
                    kind: 'rotate',
                    startAngle: Math.atan2(
                      relative.y - movingCenterStage.y,
                      relative.x - movingCenterStage.x,
                    ),
                    startRotation: params.rotationDegrees,
                  });
                }}
              />
            </svg>
          ) : null}
        </Box>

          <Box
            ref={controlsRef}
            position='absolute'
            top={4}
            right={4}
            zIndex={2}
            bg='blackAlpha.700'
            color='whiteAlpha.900'
            border='1px solid'
            borderColor='whiteAlpha.300'
            borderRadius='xl'
            px={3}
            py={3}
            backdropFilter='blur(12px)'
            maxW='330px'
            maxH='calc(100% - 32px)'
            overflowY='auto'
            style={{ transform: `translate(${controlsOffset.x}px, ${controlsOffset.y}px)` }}
          >
            <Stack spacing={3}>
              <Box
                data-testid={`${testIdPrefix}-panel-handle`}
                title='Drag to move the panel · double-click to snap back'
                cursor={isControlsDragging ? 'grabbing' : 'grab'}
                borderBottom='1px solid'
                borderColor='whiteAlpha.200'
                pb={1}
                mb={1}
                onPointerDown={startControlsDrag}
                onDoubleClick={resetControlsOffset}
              >
                <HStack spacing={2} justify='space-between'>
                  <HStack spacing={2}>
                    <Text fontSize='sm' color='whiteAlpha.600' lineHeight={1}>⠿</Text>
                    <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.600'>
                      Transform
                    </Text>
                  </HStack>
                  <Text fontSize='xs' color='whiteAlpha.500'>drag</Text>
                </HStack>
              </Box>
              <Stack spacing={1}>
                <Slider
                  aria-label='Rotation'
                  min={-180}
                  max={180}
                  step={0.1}
                  value={params.rotationDegrees}
                  onChange={(value) => onParamsChange(normalizeSimilarityParams({ ...params, rotationDegrees: value }))}
                >
                  <SliderTrack><SliderFilledTrack bg='brand.300' /></SliderTrack>
                  <SliderThumb data-testid={`${testIdPrefix}-rotation-slider`} />
                </Slider>
                <Slider
                  aria-label='Scale'
                  min={SIMILARITY_SCALE_MIN}
                  max={SIMILARITY_SCALE_MAX}
                  step={0.001}
                  value={params.scale}
                  onChange={(value) => onParamsChange(normalizeSimilarityParams({ ...params, scale: value }))}
                >
                  <SliderTrack><SliderFilledTrack bg='brand.300' /></SliderTrack>
                  <SliderThumb data-testid={`${testIdPrefix}-scale-slider`} />
                </Slider>
              </Stack>

              <Stack spacing={2}>
                <NumericField
                  label='Rotation'
                  value={params.rotationDegrees}
                  min={-180}
                  max={180}
                  step={1}
                  decimals={1}
                  suffix='°'
                  testId={`${testIdPrefix}-rotation-input`}
                  onChange={(value) => onParamsChange(normalizeSimilarityParams({ ...params, rotationDegrees: value }))}
                />
                <NumericField
                  label='Scale'
                  value={params.scale}
                  min={SIMILARITY_SCALE_MIN}
                  max={SIMILARITY_SCALE_MAX}
                  step={0.01}
                  decimals={3}
                  suffix='×'
                  testId={`${testIdPrefix}-scale-input`}
                  onChange={(value) => onParamsChange(normalizeSimilarityParams({ ...params, scale: value }))}
                />
                <HStack spacing={2}>
                  <Button
                    size='xs'
                    variant='outline'
                    color='white'
                    borderColor='brand.300'
                    _hover={{ bg: 'whiteAlpha.200' }}
                    isDisabled={!movingSize}
                    title='Flip this image left to right'
                    data-testid={`${testIdPrefix}-mirror-horizontal`}
                    onClick={() => onParamsChange(normalizeSimilarityParams({ ...params, flipHorizontal: !params.flipHorizontal }))}
                  >
                    Flip horizontal ↔
                  </Button>
                  <Button
                    size='xs'
                    variant='outline'
                    color='white'
                    borderColor='brand.300'
                    _hover={{ bg: 'whiteAlpha.200' }}
                    isDisabled={!movingSize}
                    title='Flip this image top to bottom'
                    data-testid={`${testIdPrefix}-mirror-vertical`}
                    onClick={() => onParamsChange(normalizeSimilarityParams({ ...params, flipVertical: !params.flipVertical }))}
                  >
                    Flip vertical ↕
                  </Button>
                  <Button
                    size='xs'
                    variant='outline'
                    color='white'
                    borderColor='whiteAlpha.400'
                    _hover={{ bg: 'whiteAlpha.200' }}
                    onClick={() => onParamsChange({ ...DEFAULT_SIMILARITY_PARAMS })}
                  >
                    Reset
                  </Button>
                </HStack>
              </Stack>

              <Stack spacing={1}>
                <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>
                  Overlay opacity
                </Text>
                <Slider
                  aria-label='Overlay opacity'
                  min={0.15}
                  max={1}
                  step={0.05}
                  value={overlayOpacity}
                  onChange={setOverlayOpacity}
                >
                  <SliderTrack><SliderFilledTrack bg='whiteAlpha.700' /></SliderTrack>
                  <SliderThumb />
                </Slider>
                <Flex justify='space-between' align='center'>
                  <Text fontSize='xs' color='whiteAlpha.700'>Show spot grid</Text>
                  <Switch
                    size='sm'
                    isChecked={showGrid}
                    data-testid={`${testIdPrefix}-spot-grid`}
                    onChange={(event) => setShowGrid(event.target.checked)}
                  />
                </Flex>
              </Stack>

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
                  <Text fontSize='xs' color='whiteAlpha.700'>{Math.round(viewZoom * 100)}%</Text>
                </HStack>
              </Stack>

              <Stack spacing={1}>
                <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>Offset (normalized)</Text>
                <Text fontSize='xs' fontFamily='mono'>
                  {formatNumber(params.offsetX, 4)}, {formatNumber(params.offsetY, 4)}
                </Text>
              </Stack>
            </Stack>
          </Box>

          <Box
            ref={matrixBoxRef}
            position='absolute'
            left={4}
            bottom={4}
            zIndex={2}
            bg='blackAlpha.700'
            color='whiteAlpha.800'
            px={3}
            py={2}
            borderRadius='lg'
            maxW='520px'
            style={{ transform: `translate(${matrixBoxOffset.x}px, ${matrixBoxOffset.y}px)` }}
          >
            <Stack spacing={1}>
              <Text
                fontSize='xs'
                textTransform='uppercase'
                letterSpacing='0.12em'
                cursor={isMatrixBoxDragging ? 'grabbing' : 'grab'}
                title='Drag to move this readout · double-click to snap back'
                onPointerDown={startMatrixBoxDrag}
                onDoubleClick={resetMatrixBoxOffset}
              >
                Pixel matrix → {matrixConvention === 'reference-frame' ? targetName : 'own-size frame'}
              </Text>
              <Text fontSize='xs' fontFamily='mono'>a b c | d e f = {pixelMatrixText}</Text>
            </Stack>
          </Box>
      </Box>
    </Stack>
  );
}
