'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { clamp } from '@/lib/batch/affine';
import type { BatchImageSize } from '@/types/batch';

export type ViewportSize = {
  width: number;
  height: number;
};

type LoadedImage = {
  url: string;
  image: HTMLImageElement;
};

/**
 * Decodes a preview URL into an image element.
 *
 * The loaded image is keyed by URL so a changed source simply stops matching
 * instead of requiring a synchronous state reset inside the effect.
 */
export function useStageImage(url: string | null | undefined): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);

  useEffect(() => {
    if (!url) return;

    let cancelled = false;
    const element = new window.Image();
    element.onload = () => {
      if (!cancelled) setLoaded({ url, image: element });
    };
    element.onerror = () => {
      if (!cancelled) setLoaded(null);
    };
    element.src = url;

    return () => {
      cancelled = true;
      element.onload = null;
      element.onerror = null;
    };
  }, [url]);

  return url && loaded?.url === url ? loaded.image : null;
}

export function useViewportSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<ViewportSize | null>(null);
  const [element, setElement] = useState<T | null>(null);

  useEffect(() => {
    if (!element) return;

    const update = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);

    return () => observer.disconnect();
  }, [element]);

  return { ref, size, element, setElement };
}

type OverlayDragState = {
  startX: number;
  startY: number;
  startOffsetX: number;
  startOffsetY: number;
  width: number;
  height: number;
  left: number;
  top: number;
};

const OVERLAY_MARGIN = 8;

/**
 * Drag state for a floating overlay panel (toolbars, transform controls).
 *
 * The panel is allowed to leave the image, it only has to stay reachable inside
 * the window, so the clamp runs against the viewport rather than the canvas.
 */
export function useDraggableOverlay() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<OverlayDragState | null>(null);

  const startDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const panel = ref.current;
    if (!panel) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: offset.x,
      startOffsetY: offset.y,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
    };
    setIsDragging(true);
  }, [offset.x, offset.y]);

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const viewportWidth = window.innerWidth || drag.left + drag.width;
      const viewportHeight = window.innerHeight || drag.top + drag.height;
      const desiredLeft = drag.left + (event.clientX - drag.startX);
      const desiredTop = drag.top + (event.clientY - drag.startY);
      const maxLeft = Math.max(OVERLAY_MARGIN, viewportWidth - drag.width - OVERLAY_MARGIN);
      const maxTop = Math.max(OVERLAY_MARGIN, viewportHeight - drag.height - OVERLAY_MARGIN);
      const nextLeft = clamp(desiredLeft, OVERLAY_MARGIN, maxLeft);
      const nextTop = clamp(desiredTop, OVERLAY_MARGIN, maxTop);

      setOffset({
        x: drag.startOffsetX + (nextLeft - drag.left),
        y: drag.startOffsetY + (nextTop - drag.top),
      });
    };

    const handlePointerUp = () => {
      dragRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDragging]);

  const reset = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  return { ref, offset, isDragging, startDrag, reset };
}

export const imageAspectRatio = (size: BatchImageSize | null | undefined) => (
  size && size.height > 0 ? size.width / size.height : 1
);

export const clampScale = (value: number, min = 0.05, max = 20) =>
  Math.min(max, Math.max(min, value));

export const PREVIEW_STAGE_ZOOM_MIN = 0.05;
export const PREVIEW_STAGE_ZOOM_MAX = 20;
