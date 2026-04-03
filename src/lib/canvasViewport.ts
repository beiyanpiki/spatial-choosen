import type { Point } from '@/types/project';

export type ViewportRect = {
  width: number;
  height: number;
};

export type BaseView = {
  rect: ViewportRect;
  viewWidth: number;
  viewHeight: number;
  viewX: number;
  viewY: number;
};

export type ViewTransform = BaseView & {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

export type Pan = {
  x: number;
  y: number;
};

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 20;

export function computeBaseView(rect: ViewportRect | null | undefined, ratio: number): BaseView | null {
  if (!rect) return null;

  let viewWidth = rect.width;
  let viewHeight = viewWidth / ratio;
  if (viewHeight > rect.height) {
    viewHeight = rect.height;
    viewWidth = viewHeight * ratio;
  }

  const viewX = (rect.width - viewWidth) / 2;
  const viewY = (rect.height - viewHeight) / 2;

  return { rect, viewWidth, viewHeight, viewX, viewY };
}

export function getTransform(base: BaseView | null, zoom: number, pan: Pan): ViewTransform | null {
  if (!base) return null;

  const scaledWidth = base.viewWidth * zoom;
  const scaledHeight = base.viewHeight * zoom;
  const originX = base.viewX + pan.x + (base.viewWidth - scaledWidth) / 2;
  const originY = base.viewY + pan.y + (base.viewHeight - scaledHeight) / 2;

  return {
    ...base,
    originX,
    originY,
    width: scaledWidth,
    height: scaledHeight,
  };
}

export function relativeToImage(relative: Point | null, transform: ViewTransform | null): Point | null {
  if (!transform || !relative) return null;

  const x = (relative.x - transform.originX) / transform.width;
  const y = (relative.y - transform.originY) / transform.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

export function computeZoomTransform(
  base: BaseView | null,
  rawZoom: number,
  anchorNorm?: Point,
  anchorScreen?: Point,
): { zoom: number; pan: Pan } | null {
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, rawZoom));
  if (!base) return null;

  const width = base.viewWidth * nextZoom;
  const height = base.viewHeight * nextZoom;
  const oxNoPan = base.viewX + (base.viewWidth - width) / 2;
  const oyNoPan = base.viewY + (base.viewHeight - height) / 2;

  const hasAnchor = Boolean(anchorNorm && anchorScreen);
  const pivotNorm = hasAnchor && anchorNorm ? anchorNorm : { x: 0.5, y: 0.5 };
  const pivotScreen = hasAnchor && anchorScreen
    ? anchorScreen
    : {
        x: base.viewX + base.viewWidth / 2,
        y: base.viewY + base.viewHeight / 2,
      };

  return {
    zoom: nextZoom,
    pan: {
      x: pivotScreen.x - (oxNoPan + pivotNorm.x * width),
      y: pivotScreen.y - (oyNoPan + pivotNorm.y * height),
    },
  };
}
