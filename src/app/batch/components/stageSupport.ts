'use client';

import { useEffect, useRef, useState } from 'react';

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

export const imageAspectRatio = (size: BatchImageSize | null | undefined) => (
  size && size.height > 0 ? size.width / size.height : 1
);

export const clampScale = (value: number, min = 0.05, max = 20) =>
  Math.min(max, Math.max(min, value));

export const PREVIEW_STAGE_ZOOM_MIN = 0.05;
export const PREVIEW_STAGE_ZOOM_MAX = 20;
