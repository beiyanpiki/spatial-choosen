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
  Stack,
  Switch,
  Text,
} from '@chakra-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { clamp, composeAffine } from '@/lib/batch/affine';
import {
  BATCH_REGION_COLORS,
  findRegionColorByHex,
  regionColor,
  type BatchRegionColor,
} from '@/lib/batch/regionColors';
import { spotRect } from '@/lib/batch/selection';
import { computeBaseView, computeZoomTransform, getTransform } from '@/lib/canvasViewport';
import type {
  BatchAffineMatrix,
  BatchImageSize,
  BatchPoint,
  BatchRegion,
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

/**
 * How a new stroke combines with what is already drawn.
 *
 * - `merge`: the stroke is unioned into the region that carries the active
 *   colour (and becomes a new region when that colour has none yet).
 * - `cut`: the stroke is carved out of every region it overlaps.
 */
export type BatchRegionTool = 'merge' | 'cut';

/**
 * Draws the image through an affine transform instead of its own frame.
 *
 * Used when a package should be shown already rotated and scaled onto the
 * reference: the polygons on screen then live in the reference frame.
 */
export type BatchRegionFrame = {
  size: BatchImageSize;
  /** Preview pixels of `imageUrl` -> pixels of the frame. */
  previewToFrame: BatchAffineMatrix;
  /** Package full-resolution pixels -> pixels of the frame (spot overlay). */
  fullresToFrame?: BatchAffineMatrix | null;
};

/** Sub-rectangle of the frame that is shown, normalized to the frame. */
export type BatchViewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const FULL_BOUNDS: BatchViewBounds = { x: 0, y: 0, width: 1, height: 1 };

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
  frame?: BatchRegionFrame | null;
  viewBounds?: BatchViewBounds | null;
  regions: readonly BatchRegion[];
  overlayRegions?: readonly BatchRegion[];
  overlayLabel?: string;
  interactive?: boolean;
  /** Read-only reference panel: no drawing, no view zoom, no tool controls. */
  locked?: boolean;
  tool?: BatchRegionTool;
  onToolChange?: (tool: BatchRegionTool) => void;
  activeColorId?: number;
  onActiveColorChange?: (colorId: number) => void;
  /** Classes shown in the colour row: the built-ins plus anything the operator added. */
  colors?: readonly BatchRegionColor[];
  /** Adds a class from a picked colour. */
  onAddColor?: (hex: string) => void;
  /** Removes every operator-added class, keeping the built-in five. */
  onClearColors?: () => void;
  /** Renames a colour group; the id stays the exported value. */
  onRenameColor?: (colorId: number, name: string) => void;
  /** Optional controlled view, so sibling panels can stay aligned. */
  viewZoom?: number;
  viewPan?: { x: number; y: number };
  onViewZoomChange?: (zoom: number) => void;
  onViewPanChange?: (pan: { x: number; y: number }) => void;
  spots?: readonly BatchSpot[] | null;
  selectedBarcodeSet?: ReadonlySet<string> | null;
  /**
   * Barcodes of the tissue that was already kept before this tool ran, read
   * from the second column of `tissue_positions.csv`. When set, the spot
   * overlay switches to a comparison of that list against the selection drawn
   * here, so the operator can see what the region adds and what it drops.
   */
  comparisonBarcodes?: ReadonlySet<string> | null;
  spotDiameterFullres?: number | null;
  anchorMode?: BatchSpotAnchorMode;
  onCommitStroke?: (points: BatchPoint[], tool: BatchRegionTool, colorId: number) => void;
  onUndoRegion?: () => void;
  /** False when there is nothing left in the edit history. */
  canUndo?: boolean;
  onClearRegions?: () => void;
  testIdPrefix?: string;
  emptyMessage?: string;
};

const SELECTED_SPOT_FILL = 'rgba(56, 161, 105, 0.45)';
const SELECTED_SPOT_DOT = 'rgba(56, 161, 105, 0.95)';
// Unmarked spots sit on top of the tissue image, so they need a mid-dark grey
// to stay legible instead of the faint white wash they used to be.
const UNMARKED_SPOT_FILL = 'rgba(70, 70, 70, 0.55)';
const UNMARKED_SPOT_DOT = 'rgba(90, 90, 90, 0.9)';
// Comparison palette: the tissue table and the drawn region are two sets, so
// the overlay shows the intersection and the two differences.
const COMPARE_BOTH_FILL = 'rgba(56, 161, 105, 0.75)';
const COMPARE_BOTH_DOT = 'rgba(56, 161, 105, 0.95)';
const COMPARE_PREVIOUS_FILL = 'rgba(214, 158, 46, 0.75)';
const COMPARE_PREVIOUS_DOT = 'rgba(214, 158, 46, 0.95)';
const COMPARE_CURRENT_FILL = 'rgba(49, 130, 206, 0.75)';
const COMPARE_CURRENT_DOT = 'rgba(49, 130, 206, 0.95)';
const OVERLAY_STROKE = 'rgba(214, 158, 46, 0.95)';
const CUT_STROKE = 'rgba(229, 62, 62, 0.9)';
const CLICK_MOVEMENT_THRESHOLD_PX = 4;

export function BatchRegionStage({
  title,
  description,
  imageUrl,
  imageSize,
  frame = null,
  viewBounds = null,
  regions,
  overlayRegions = EMPTY_REGIONS,
  overlayLabel = 'Reference guide',
  interactive = true,
  locked = false,
  tool = 'merge',
  onToolChange,
  activeColorId = 1,
  onActiveColorChange,
  colors = BATCH_REGION_COLORS,
  onAddColor,
  onClearColors,
  onRenameColor,
  viewZoom: controlledZoom,
  viewPan: controlledPan,
  onViewZoomChange,
  onViewPanChange,
  spots = null,
  selectedBarcodeSet = null,
  comparisonBarcodes = null,
  spotDiameterFullres = null,
  anchorMode = 'top-left',
  onCommitStroke,
  onUndoRegion,
  canUndo = true,
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

  const [internalZoom, setInternalZoom] = useState(1);
  const [internalPan, setInternalPan] = useState({ x: 0, y: 0 });
  const viewZoom = controlledZoom ?? internalZoom;
  const viewPan = controlledPan ?? internalPan;

  const applyViewZoom = useCallback((value: number) => {
    const next = clamp(value, PREVIEW_STAGE_ZOOM_MIN, PREVIEW_STAGE_ZOOM_MAX);
    if (controlledZoom === undefined) setInternalZoom(next);
    onViewZoomChange?.(next);
  }, [controlledZoom, onViewZoomChange]);

  const applyViewPan = useCallback((value: { x: number; y: number }) => {
    if (controlledPan === undefined) setInternalPan(value);
    onViewPanChange?.(value);
  }, [controlledPan, onViewPanChange]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showUnmarkedSpots, setShowUnmarkedSpots] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  /** Colour group whose name is being edited in the panel. */
  const [renamingColorId, setRenamingColorId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  /** Floating control panel, draggable so it can be moved out of the way. */
  const {
    ref: panelRef,
    offset: panelOffset,
    isDragging: isPanelDragging,
    startDrag: startPanelDrag,
    reset: resetPanelOffset,
  } = useDraggableOverlay();

  const bounds = viewBounds ?? FULL_BOUNDS;
  const frameSize = frame?.size ?? imageSize;
  const activeSwatch = regionColor(activeColorId, colors).swatch;
  const activeSwatchHex = /^#[0-9a-f]{6}$/i.test(activeSwatch) ? activeSwatch : '#167dde';
  /** Colour staged in the picker; only the Add button turns it into a class. */
  const [draftColor, setDraftColor] = useState(activeSwatchHex);
  const [isPickingColor, setIsPickingColor] = useState(false);
  const [pickerNotice, setPickerNotice] = useState<string | null>(null);

  /**
   * Splits the overlay into "already kept" and "drawn here" when the stage is
   * showing the tissue-table comparison, so the legend can report the numbers.
   */
  const comparisonSummary = useMemo(() => {
    if (!comparisonBarcodes) return null;

    let both = 0;
    let previousOnly = 0;
    let currentOnly = 0;
    comparisonBarcodes.forEach((barcode) => {
      if (selectedBarcodeSet?.has(barcode)) both += 1;
      else previousOnly += 1;
    });
    selectedBarcodeSet?.forEach((barcode) => {
      if (!comparisonBarcodes.has(barcode)) currentOnly += 1;
    });

    return { both, previousOnly, currentOnly };
  }, [comparisonBarcodes, selectedBarcodeSet]);

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
    if (!frameSize || bounds.width <= 0 || bounds.height <= 0) return null;
    const ratio = (frameSize.width * bounds.width) / (frameSize.height * bounds.height);
    return computeBaseView(viewport, ratio);
  }, [bounds.height, bounds.width, frameSize, viewport]);

  const stage = useMemo(
    () => getTransform(baseView, viewZoom, viewPan),
    [baseView, viewPan, viewZoom],
  );

  /**
   * Frame *pixels* -> screen pixels, honouring the trimmed view bounds.
   *
   * Everything drawn through a matrix (the image, the spot grid) is expressed in
   * frame pixels, while polygons are normalized, so this has to stay in pixels
   * and `toScreen` converts normalized points into it.
   */
  const frameToStage = useMemo<BatchAffineMatrix | null>(() => {
    if (!stage || !frameSize || frameSize.width <= 0 || frameSize.height <= 0) return null;

    const visibleWidth = bounds.width * frameSize.width;
    const visibleHeight = bounds.height * frameSize.height;
    if (visibleWidth <= 0 || visibleHeight <= 0) return null;

    return [
      stage.width / visibleWidth,
      0,
      stage.originX - (bounds.x * frameSize.width * stage.width) / visibleWidth,
      0,
      stage.height / visibleHeight,
      stage.originY - (bounds.y * frameSize.height * stage.height) / visibleHeight,
    ];
  }, [bounds.height, bounds.width, bounds.x, bounds.y, frameSize, stage]);

  const getLiveHostRect = useCallback(
    () => hostRef.current?.getBoundingClientRect() ?? null,
    [hostRef],
  );

  const screenToFrame = useCallback((clientX: number, clientY: number): BatchPoint | null => {
    const rect = getLiveHostRect();
    const transformed = frameToStage;
    if (!rect || !transformed || !frameSize) return null;

    const relative = { x: clientX - rect.left, y: clientY - rect.top };
    const pixels = {
      x: (relative.x - transformed[2]) / transformed[0],
      y: (relative.y - transformed[5]) / transformed[4],
    };

    return {
      x: clamp(pixels.x / frameSize.width, 0, 1),
      y: clamp(pixels.y / frameSize.height, 0, 1),
    };
  }, [frameSize, frameToStage, getLiveHostRect]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const transformed = frameToStage;
    if (!canvas || !viewport || !transformed || !stage) return;

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

    if (image && frame) {
      // The package is drawn already aligned to the reference frame.
      const matrix = composeAffine(transformed, frame.previewToFrame);
      context.save();
      context.setTransform(
        devicePixelRatio * matrix[0],
        devicePixelRatio * matrix[3],
        devicePixelRatio * matrix[1],
        devicePixelRatio * matrix[4],
        devicePixelRatio * matrix[2],
        devicePixelRatio * matrix[5],
      );
      context.drawImage(image, 0, 0);
      context.restore();
    } else if (image) {
      context.drawImage(
        image,
        transformed[2],
        transformed[5],
        transformed[0] * (frameSize?.width ?? 1),
        transformed[4] * (frameSize?.height ?? 1),
      );
    }

    const toScreen = (point: BatchPoint) => ({
      x: transformed[2] + point.x * (frameSize?.width ?? 1) * transformed[0],
      y: transformed[5] + point.y * (frameSize?.height ?? 1) * transformed[4],
    });

    if (showGrid && spots && spots.length > 0) {
      const spotMatrix = frame?.fullresToFrame
        ? composeAffine(transformed, frame.fullresToFrame)
        : null;
      const scaleX = spotMatrix ? Math.hypot(spotMatrix[0], spotMatrix[3]) : transformed[0];
      const scaleY = spotMatrix ? Math.hypot(spotMatrix[1], spotMatrix[4]) : transformed[4];
      const size = (spotDiameterFullres ?? 0) * Math.min(scaleX, scaleY);
      const drawDots = size < 3;

      for (const spot of spots) {
        const rect = spotRect(spot, anchorMode, spotDiameterFullres);
        const topLeft = spotMatrix
          ? {
              x: spotMatrix[0] * rect.x + spotMatrix[1] * rect.y + spotMatrix[2],
              y: spotMatrix[3] * rect.x + spotMatrix[4] * rect.y + spotMatrix[5],
            }
          : toScreen({
              x: rect.x / (frameSize?.width ?? 1),
              y: rect.y / (frameSize?.height ?? 1),
            });
        const selected = selectedBarcodeSet?.has(spot.barcode) ?? false;
        // In comparison mode only the two sets matter — the table's tissue and
        // the region drawn here — so a spot in neither is left out entirely.
        const inPreviousTissue = comparisonBarcodes?.has(spot.barcode) ?? false;
        if (comparisonBarcodes && !selected && !inPreviousTissue) continue;
        if (!comparisonBarcodes && !selected && !showUnmarkedSpots) continue;

        const comparisonFill = inPreviousTissue
          ? (selected ? COMPARE_BOTH_FILL : COMPARE_PREVIOUS_FILL)
          : COMPARE_CURRENT_FILL;
        const comparisonDot = inPreviousTissue
          ? (selected ? COMPARE_BOTH_DOT : COMPARE_PREVIOUS_DOT)
          : COMPARE_CURRENT_DOT;

        if (drawDots) {
          context.fillStyle = comparisonBarcodes
            ? comparisonDot
            : selected ? SELECTED_SPOT_DOT : UNMARKED_SPOT_DOT;
          context.fillRect(topLeft.x - 1, topLeft.y - 1, 2.5, 2.5);
          continue;
        }

        context.fillStyle = comparisonBarcodes
          ? comparisonFill
          : selected ? SELECTED_SPOT_FILL : UNMARKED_SPOT_FILL;
        context.fillRect(topLeft.x, topLeft.y, rect.width * scaleX, rect.height * scaleY);
      }
    }

    const tracePath = (points: readonly BatchPoint[]) => {
      if (points.length < 3) return false;
      context.beginPath();
      const first = toScreen(points[0]);
      context.moveTo(first.x, first.y);
      points.slice(1).forEach((point) => {
        const screenPoint = toScreen(point);
        context.lineTo(screenPoint.x, screenPoint.y);
      });
      context.closePath();
      return true;
    };

    const drawRegion = (
      region: BatchRegion,
      stroke: string,
      fill: string | null,
      dashed: boolean,
    ) => {
      if (!tracePath(region.points)) return;
      (region.holes ?? []).forEach((hole) => {
        if (hole.length < 3) return;
        const first = toScreen(hole[0]);
        context.moveTo(first.x, first.y);
        hole.slice(1).forEach((point) => {
          const screenPoint = toScreen(point);
          context.lineTo(screenPoint.x, screenPoint.y);
        });
        context.closePath();
      });

      if (fill) {
        context.fillStyle = fill;
        context.fill('evenodd');
      }
      context.setLineDash(dashed ? [8, 6] : []);
      context.strokeStyle = stroke;
      context.lineWidth = dashed ? 1.5 : 2;
      context.stroke();
      context.setLineDash([]);
    };

    overlayRegions.forEach((region) => drawRegion(region, OVERLAY_STROKE, null, true));
    regions.forEach((region) => {
      const color = regionColor(region.colorId, colors);
      drawRegion(region, color.stroke, color.fill, false);
    });

    const path = pathRef.current;
    if (path.length > 1) {
      context.beginPath();
      const first = toScreen(path[0]);
      context.moveTo(first.x, first.y);
      path.slice(1).forEach((point) => {
        const screenPoint = toScreen(point);
        context.lineTo(screenPoint.x, screenPoint.y);
      });
      context.strokeStyle = tool === 'cut' ? CUT_STROKE : regionColor(activeColorId, colors).stroke;
      context.lineWidth = 2;
      context.setLineDash([6, 4]);
      context.stroke();
      context.setLineDash([]);
    }
  }, [
    activeColorId,
    anchorMode,
    comparisonBarcodes,
    colors,
    frame,
    frameSize,
    frameToStage,
    image,
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
    const point = screenToFrame(event.clientX, event.clientY);
    if (!point) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    pathRef.current = [point];
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    pointerMovedRef.current = false;
    drawingRef.current = true;
    setIsDrawing(true);
    requestRefresh();
  }, [interactive, requestRefresh, screenToFrame]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (panningRef.current && panStartRef.current) {
      const deltaX = event.clientX - panStartRef.current.x;
      const deltaY = event.clientY - panStartRef.current.y;
      applyViewPan({ x: viewPan.x + deltaX, y: viewPan.y + deltaY });
      panStartRef.current = { x: event.clientX, y: event.clientY };
      return;
    }

    if (!drawingRef.current) return;
    const start = pointerStartRef.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_MOVEMENT_THRESHOLD_PX) {
      pointerMovedRef.current = true;
    }

    const point = screenToFrame(event.clientX, event.clientY);
    if (!point) return;
    pathRef.current.push(point);
    requestRefresh();
  }, [applyViewPan, requestRefresh, screenToFrame, viewPan.x, viewPan.y]);

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
      onCommitStroke?.(committed, tool, activeColorId);
    }
  }, [activeColorId, onCommitStroke, resetInteraction, tool]);

  /**
   * Wheel zoom is bound natively and non-passively.
   *
   * React registers `onWheel` through a passive root listener, so a
   * `preventDefault()` there is ignored and the page keeps scrolling behind the
   * canvas. Attaching the listener ourselves keeps the image area authoritative
   * whenever the pointer is over it.
   *
   * The zoom is anchored on the pointer: the image point under the cursor stays
   * put, so the operator can push into a corner instead of always growing the
   * view out of its centre.
   */
  useEffect(() => {
    if (!hostElement || !stage || locked) return;
    if (stage.width <= 0 || stage.height <= 0) return;

    const handleWheel = (event: WheelEvent) => {
      if (!baseView) return;
      event.preventDefault();

      const rect = hostElement.getBoundingClientRect();
      const anchorScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
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
      applyViewZoom(next.zoom);
      applyViewPan(next.pan);
    };

    hostElement.addEventListener('wheel', handleWheel, { passive: false });
    return () => hostElement.removeEventListener('wheel', handleWheel);
  }, [applyViewPan, applyViewZoom, baseView, hostElement, locked, stage, viewZoom]);

  const showRegionTools = interactive && !locked && Boolean(onUndoRegion || onClearRegions);

  return (
    <Stack spacing={4} flex='1' minW={0} data-testid={`${testIdPrefix}-stage`}>
      <Flex
        justify='space-between'
        align={{ base: 'flex-start', md: 'center' }}
        gap={3}
        wrap={{ base: 'wrap', xl: 'nowrap' }}
        // Sibling panels share this height so their canvases line up exactly.
        minH='76px'
      >
        <Stack spacing={1}>
          <Heading size='sm'>{title}</Heading>
          <Text fontSize='sm' color='gray.500' noOfLines={2}>{description}</Text>
        </Stack>
        <HStack spacing={2} flexShrink={0}>
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
        bg='gray.900'
      >
        {/* The canvas layer is clipped; the control panel below deliberately is
            not, so it can be parked outside the image. */}
        <Box position='absolute' inset={0} overflow='hidden' borderRadius='2xl'>
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
                cursor: !interactive ? 'default' : 'crosshair',
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
            left={4}
            bottom={4}
            bg='blackAlpha.700'
            color='whiteAlpha.800'
            px={3}
            py={2}
            borderRadius='lg'
            maxW='460px'
          >
            <Text fontSize='xs'>
              {locked
                ? 'Reference view is fixed.'
                : isDrawing
                  ? 'Release to commit the region.'
                  : tool === 'merge'
                    ? 'Drag to add to the active region · middle-drag to pan · wheel to zoom'
                    : 'Drag to cut out · middle-drag to pan · wheel to zoom'}
            </Text>
          </Box>
        </Box>

        <Box
          ref={panelRef}
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
          maxW='300px'
          maxH='calc(100% - 32px)'
          overflowY='auto'
          style={{ transform: `translate(${panelOffset.x}px, ${panelOffset.y}px)` }}
        >
          <Stack spacing={3} minW='210px'>
            <Box
              data-testid={`${testIdPrefix}-panel-handle`}
              title='Drag to move the panel · double-click to snap back'
              cursor={isPanelDragging ? 'grabbing' : 'grab'}
              borderBottom='1px solid'
              borderColor='whiteAlpha.200'
              pb={1}
              mb={1}
              onPointerDown={startPanelDrag}
              onDoubleClick={resetPanelOffset}
            >
              <HStack spacing={2} justify='space-between'>
                <HStack spacing={2}>
                  <Text fontSize='sm' color='whiteAlpha.600' lineHeight={1}>⠿</Text>
                  <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.600'>
                    Controls
                  </Text>
                </HStack>
                <Text fontSize='xs' color='whiteAlpha.500'>drag</Text>
              </HStack>
            </Box>

            {interactive && onActiveColorChange ? (
              <Stack spacing={2}>
                <Flex justify='space-between' align='center' gap={2}>
                  <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>
                    Region colour
                  </Text>
                  {onClearColors && colors.length > BATCH_REGION_COLORS.length ? (
                    <Button
                      size='xs'
                      variant='ghost'
                      color='white'
                      h='auto'
                      py={0}
                      fontSize='xs'
                      data-testid={`${testIdPrefix}-clear-colors`}
                      onClick={onClearColors}
                    >
                      Clear added
                    </Button>
                  ) : null}
                </Flex>
                <Flex wrap='wrap' gap={2}>
                  {colors.map((color) => (
                    <Box
                      key={color.id}
                      as='button'
                      type='button'
                      w='22px'
                      h='22px'
                      borderRadius='md'
                      bg={color.swatch}
                      border='2px solid'
                      borderColor={activeColorId === color.id ? 'white' : 'whiteAlpha.300'}
                      cursor='pointer'
                      title={`${color.name} — value ${color.id} in the export`}
                      data-testid={`${testIdPrefix}-color-${color.id}`}
                      onClick={() => onActiveColorChange(color.id)}
                    />
                  ))}
                  {onAddColor ? (
                    <Box
                      as='button'
                      type='button'
                      w='22px'
                      h='22px'
                      borderRadius='md'
                      border='2px solid'
                      borderColor={isPickingColor ? 'white' : 'whiteAlpha.400'}
                      borderStyle={isPickingColor ? 'solid' : 'dashed'}
                      color={isPickingColor ? 'white' : 'whiteAlpha.800'}
                      display='flex'
                      alignItems='center'
                      justifyContent='center'
                      fontSize='sm'
                      lineHeight={1}
                      cursor='pointer'
                      title='Pick a custom colour'
                      data-testid={`${testIdPrefix}-add-color`}
                      onClick={() => {
                        setDraftColor(activeSwatchHex);
                        setPickerNotice(null);
                        setIsPickingColor((previous) => !previous);
                      }}
                    >
                      ＋
                    </Box>
                  ) : null}
                </Flex>
                {onAddColor && isPickingColor ? (
                  <HStack spacing={2}>
                    <Box
                      as='input'
                      type='color'
                      value={draftColor}
                      aria-label='Custom region colour'
                      data-testid={`${testIdPrefix}-color-input`}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        setDraftColor(event.target.value);
                        setPickerNotice(null);
                      }}
                      w='34px'
                      h='22px'
                      p={0}
                      border='1px solid'
                      borderColor='whiteAlpha.400'
                      borderRadius='md'
                      bg='transparent'
                      cursor='pointer'
                    />
                    <Button
                      size='xs'
                      colorScheme='brand'
                      h='22px'
                      data-testid={`${testIdPrefix}-add-color-confirm`}
                      onClick={() => {
                        const existing = findRegionColorByHex(colors, draftColor);
                        if (existing) {
                          // A colour is one class, so reuse it instead of adding a twin.
                          setPickerNotice(`That colour is already value ${existing.id}.`);
                          onActiveColorChange?.(existing.id);
                          return;
                        }

                        onAddColor(draftColor);
                        setPickerNotice(null);
                        setIsPickingColor(false);
                      }}
                    >
                      Add
                    </Button>
                  </HStack>
                ) : null}
                {pickerNotice ? (
                  <Text fontSize='xs' color='orange.200' data-testid={`${testIdPrefix}-color-notice`}>
                    {pickerNotice}
                  </Text>
                ) : null}
                <Text fontSize='xs' color='whiteAlpha.700'>
                  New regions are stored as value {activeColorId}.
                </Text>
              </Stack>
            ) : null}

            {interactive ? (
              <Stack spacing={2}>
                <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>Tool</Text>
                <ButtonGroup size='xs' variant='outline' isAttached w='100%'>
                  <Button
                    flex={1}
                    color='white'
                    borderColor='whiteAlpha.400'
                    bg={tool === 'merge' ? 'whiteAlpha.300' : undefined}
                    _hover={{ bg: 'whiteAlpha.200' }}
                    data-testid={`${testIdPrefix}-tool-merge`}
                    onClick={() => onToolChange?.('merge')}
                  >
                    Merge
                  </Button>
                  <Button
                    flex={1}
                    color='white'
                    borderColor='whiteAlpha.400'
                    bg={tool === 'cut' ? 'whiteAlpha.300' : undefined}
                    _hover={{ bg: 'whiteAlpha.200' }}
                    data-testid={`${testIdPrefix}-tool-cut`}
                    onClick={() => onToolChange?.('cut')}
                  >
                    Cut out
                  </Button>
                </ButtonGroup>
                <Text fontSize='xs' color='whiteAlpha.700'>
                  {tool === 'merge'
                    ? 'Strokes are added to the region of the active colour.'
                    : 'Strokes are carved out of every region they touch.'}
                </Text>
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
              <Flex
                justify='space-between'
                align='center'
                opacity={showGrid && !comparisonBarcodes ? 1 : 0.45}
              >
                <Text fontSize='xs' color='whiteAlpha.700'>Unmarked spots (grey)</Text>
                <Switch
                  size='sm'
                  isChecked={showUnmarkedSpots}
                  isDisabled={!showGrid || Boolean(comparisonBarcodes)}
                  data-testid={`${testIdPrefix}-unmarked-spots`}
                  onChange={(event) => setShowUnmarkedSpots(event.target.checked)}
                />
              </Flex>
              {comparisonSummary ? (
                <Stack
                  spacing={1}
                  pt={1}
                  borderTop='1px solid'
                  borderColor='whiteAlpha.200'
                  data-testid={`${testIdPrefix}-compare-legend`}
                >
                  <Text fontSize='xs' color='whiteAlpha.600'>
                    Against the tissue table (column 2, in_tissue)
                  </Text>
                  <HStack spacing={2}>
                    <Box w='10px' h='10px' borderRadius='sm' bg={COMPARE_BOTH_DOT} flexShrink={0} />
                    <Text fontSize='xs' color='whiteAlpha.800' flex='1'>In both</Text>
                    <Text fontSize='xs' color='whiteAlpha.600' data-testid={`${testIdPrefix}-compare-both`}>
                      {comparisonSummary.both}
                    </Text>
                  </HStack>
                  <HStack spacing={2}>
                    <Box w='10px' h='10px' borderRadius='sm' bg={COMPARE_PREVIOUS_DOT} flexShrink={0} />
                    <Text fontSize='xs' color='whiteAlpha.800' flex='1'>Only in the table</Text>
                    <Text fontSize='xs' color='whiteAlpha.600' data-testid={`${testIdPrefix}-compare-previous-only`}>
                      {comparisonSummary.previousOnly}
                    </Text>
                  </HStack>
                  <HStack spacing={2}>
                    <Box w='10px' h='10px' borderRadius='sm' bg={COMPARE_CURRENT_DOT} flexShrink={0} />
                    <Text fontSize='xs' color='whiteAlpha.800' flex='1'>Only in the region</Text>
                    <Text fontSize='xs' color='whiteAlpha.600' data-testid={`${testIdPrefix}-compare-current-only`}>
                      {comparisonSummary.currentOnly}
                    </Text>
                  </HStack>
                </Stack>
              ) : null}
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
                      onClick={() => applyViewZoom(viewZoom * 0.9)}
                    >
                      −
                    </Button>
                    <Button
                      color='white'
                      borderColor='whiteAlpha.400'
                      _hover={{ bg: 'whiteAlpha.200' }}
                      onClick={() => applyViewZoom(viewZoom * 1.1)}
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
                      applyViewZoom(1);
                      applyViewPan({ x: 0, y: 0 });
                    }}
                  >
                    Fit
                  </Button>
                  <Text fontSize='xs' color='whiteAlpha.700' data-testid={`${testIdPrefix}-zoom`}>
                    {Math.round(viewZoom * 100)}%
                  </Text>
                </HStack>
              </Stack>
            )}

            {showRegionTools ? (
              <Stack spacing={2}>
                <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>
                  Colours
                </Text>
                {/*
                  One row per colour group rather than per polygon: the group name
                  is what lands in the export, and renaming it here keeps every
                  region of that colour in step with the operator's own wording.
                */}
                <Stack spacing={1} maxH='140px' overflowY='auto'>
                  {colors.map((color) => {
                    const drawn = regions.filter((region) => region.colorId === color.id).length;
                    const isRenaming = renamingColorId === color.id;

                    return (
                      <HStack key={color.id} spacing={2} data-testid={`${testIdPrefix}-group-${color.id}`}>
                        <Box w='10px' h='10px' borderRadius='sm' bg={color.swatch} flexShrink={0} />
                        {isRenaming ? (
                          <Input
                            size='xs'
                            h='22px'
                            value={renameDraft}
                            autoFocus
                            aria-label={`Rename ${color.name}`}
                            data-testid={`${testIdPrefix}-group-name-${color.id}`}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onBlur={() => {
                              const next = renameDraft.trim();
                              if (next) onRenameColor?.(color.id, next);
                              setRenamingColorId(null);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                const next = renameDraft.trim();
                                if (next) onRenameColor?.(color.id, next);
                                setRenamingColorId(null);
                              }
                              if (event.key === 'Escape') setRenamingColorId(null);
                            }}
                          />
                        ) : (
                          <Text fontSize='xs' color='whiteAlpha.800' flex='1' noOfLines={1}>
                            {color.name}
                          </Text>
                        )}
                        <Text fontSize='xs' color='whiteAlpha.500' flexShrink={0}>
                          {drawn}
                        </Text>
                        {onRenameColor && !isRenaming ? (
                          <Button
                            size='xs'
                            variant='ghost'
                            color='whiteAlpha.700'
                            h='auto'
                            py={0}
                            px={1}
                            lineHeight={1}
                            title={`Rename ${color.name}`}
                            aria-label={`Rename ${color.name}`}
                            data-testid={`${testIdPrefix}-rename-${color.id}`}
                            onClick={() => {
                              setRenameDraft(color.name);
                              setRenamingColorId(color.id);
                            }}
                          >
                            ✎
                          </Button>
                        ) : null}
                      </HStack>
                    );
                  })}
                </Stack>

                <HStack spacing={2}>
                  {onUndoRegion ? (
                    <Button
                      size='xs'
                      variant='ghost'
                      color='white'
                      isDisabled={!canUndo}
                      title='Reverts the most recent edit, whichever image it was made on'
                      data-testid={`${testIdPrefix}-undo`}
                      onClick={onUndoRegion}
                    >
                      Undo
                    </Button>
                  ) : null}
                  {onClearRegions ? (
                    <Button
                      size='xs'
                      variant='ghost'
                      color='white'
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

      </Box>
    </Stack>
  );
}
