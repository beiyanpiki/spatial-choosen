import type {
  LocalizationImageTransform,
  PreprocessPoint,
  PreprocessRect,
} from '@/types/preprocess';

const CENTER = 0.5;

const toCentered = (point: PreprocessPoint) => ({
  x: point.x - CENTER,
  y: point.y - CENTER,
});

const fromCentered = (point: PreprocessPoint): PreprocessPoint => ({
  x: point.x + CENTER,
  y: point.y + CENTER,
});

export type ImageDisplayRect = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

export type PixelPoint = {
  x: number;
  y: number;
};

export type PixelSize = {
  width: number;
  height: number;
};

export function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function normalizeRotationDegrees(value: number): number {
  return Math.min(180, Math.max(-180, Number.isFinite(value) ? value : 0));
}

// Flips are applied in the source/screen coordinate system first, then the
// rotation — so `rotationDegrees` always means the visible rotation on screen,
// regardless of flip state (a reflection would otherwise invert the visual
// rotation direction).
export function applyImageDisplayTransform(
  point: PreprocessPoint,
  transform: LocalizationImageTransform,
): PreprocessPoint {
  const centered = toCentered(point);
  const flipped = {
    x: centered.x * (transform.flipHorizontal ? -1 : 1),
    y: centered.y * (transform.flipVertical ? -1 : 1),
  };
  const radians = degreesToRadians(normalizeRotationDegrees(transform.rotationDegrees));
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return fromCentered({
    x: flipped.x * cos - flipped.y * sin,
    y: flipped.x * sin + flipped.y * cos,
  });
}

export function invertImageDisplayTransform(
  point: PreprocessPoint,
  transform: LocalizationImageTransform,
): PreprocessPoint {
  const centered = toCentered(point);
  const radians = degreesToRadians(-normalizeRotationDegrees(transform.rotationDegrees));
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotated = {
    x: centered.x * cos - centered.y * sin,
    y: centered.x * sin + centered.y * cos,
  };

  return fromCentered({
    x: rotated.x * (transform.flipHorizontal ? -1 : 1),
    y: rotated.y * (transform.flipVertical ? -1 : 1),
  });
}

export function projectSourcePointToDisplayRect(
  point: PreprocessPoint,
  transform: LocalizationImageTransform,
  displayRect: ImageDisplayRect,
): PreprocessPoint {
  const centerX = displayRect.originX + displayRect.width / 2;
  const centerY = displayRect.originY + displayRect.height / 2;
  const displayDeltaX = (point.x - CENTER) * displayRect.width;
  const displayDeltaY = (point.y - CENTER) * displayRect.height;
  const flippedDisplayDeltaX = displayDeltaX * (transform.flipHorizontal ? -1 : 1);
  const flippedDisplayDeltaY = displayDeltaY * (transform.flipVertical ? -1 : 1);
  const radians = degreesToRadians(normalizeRotationDegrees(transform.rotationDegrees));
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    x: centerX + flippedDisplayDeltaX * cos - flippedDisplayDeltaY * sin,
    y: centerY + flippedDisplayDeltaX * sin + flippedDisplayDeltaY * cos,
  };
}

export function invertDisplayRectPointToSource(
  point: PreprocessPoint,
  transform: LocalizationImageTransform,
  displayRect: ImageDisplayRect,
): PreprocessPoint {
  const centerX = displayRect.originX + displayRect.width / 2;
  const centerY = displayRect.originY + displayRect.height / 2;
  const rotatedDisplayDeltaX = point.x - centerX;
  const rotatedDisplayDeltaY = point.y - centerY;
  const radians = degreesToRadians(-normalizeRotationDegrees(transform.rotationDegrees));
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const unrotatedDisplayDeltaX = rotatedDisplayDeltaX * cos - rotatedDisplayDeltaY * sin;
  const unrotatedDisplayDeltaY = rotatedDisplayDeltaX * sin + rotatedDisplayDeltaY * cos;
  const unflippedDisplayDeltaX = unrotatedDisplayDeltaX * (transform.flipHorizontal ? -1 : 1);
  const unflippedDisplayDeltaY = unrotatedDisplayDeltaY * (transform.flipVertical ? -1 : 1);

  return {
    x: unflippedDisplayDeltaX / displayRect.width + CENTER,
    y: unflippedDisplayDeltaY / displayRect.height + CENTER,
  };
}

export function getTransformedRectCorners(
  rect: PreprocessRect,
  transform: LocalizationImageTransform,
): readonly [PreprocessPoint, PreprocessPoint, PreprocessPoint, PreprocessPoint] {
  return [
    applyImageDisplayTransform({ x: rect.x, y: rect.y }, transform),
    applyImageDisplayTransform({ x: rect.x + rect.width, y: rect.y }, transform),
    applyImageDisplayTransform({ x: rect.x + rect.width, y: rect.y + rect.height }, transform),
    applyImageDisplayTransform({ x: rect.x, y: rect.y + rect.height }, transform),
  ] as const;
}

export function getLowerLeftMarkerPoints(
  rect: PreprocessRect,
  transform: LocalizationImageTransform,
): readonly [PreprocessPoint, PreprocessPoint, PreprocessPoint] {
  const markerSize = Math.max(0.04, Math.min(rect.width, rect.height) * 0.18);
  const anchor = { x: rect.x, y: rect.y + rect.height };

  return [
    applyImageDisplayTransform({ x: anchor.x, y: anchor.y - markerSize }, transform),
    applyImageDisplayTransform(anchor, transform),
    applyImageDisplayTransform({ x: anchor.x + markerSize, y: anchor.y }, transform),
  ] as const;
}

export function transformImagePixelPoint(
  point: PixelPoint,
  transform: LocalizationImageTransform,
  sourceSize: PixelSize,
  outputSize: PixelSize,
): PixelPoint {
  const sourceCenter = {
    x: sourceSize.width / 2,
    y: sourceSize.height / 2,
  };
  const outputCenter = {
    x: outputSize.width / 2,
    y: outputSize.height / 2,
  };
  const radians = degreesToRadians(normalizeRotationDegrees(transform.rotationDegrees));
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const sourceDeltaX = point.x - sourceCenter.x;
  const sourceDeltaY = point.y - sourceCenter.y;
  const flippedDeltaX = sourceDeltaX * (transform.flipHorizontal ? -1 : 1);
  const flippedDeltaY = sourceDeltaY * (transform.flipVertical ? -1 : 1);
  const rotatedDeltaX = flippedDeltaX * cos - flippedDeltaY * sin;
  const rotatedDeltaY = flippedDeltaX * sin + flippedDeltaY * cos;

  return {
    x: outputCenter.x + rotatedDeltaX,
    y: outputCenter.y + rotatedDeltaY,
  };
}

export function getOrientedChipBoundsPixelRect(
  rect: PreprocessRect,
  transform: LocalizationImageTransform,
  sourceSize: PixelSize,
  outputSize: PixelSize,
): PixelPoint & PixelSize {
  const sourceX = rect.x * sourceSize.width;
  const sourceY = rect.y * sourceSize.height;
  const sourceWidth = rect.width * sourceSize.width;
  const sourceHeight = rect.height * sourceSize.height;
  const points = [
    { x: sourceX, y: sourceY },
    { x: sourceX + sourceWidth, y: sourceY },
    { x: sourceX + sourceWidth, y: sourceY + sourceHeight },
    { x: sourceX, y: sourceY + sourceHeight },
  ].map((point) => transformImagePixelPoint(point, transform, sourceSize, outputSize));
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));

  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.max(1, Math.round(maxX - minX)),
    height: Math.max(1, Math.round(maxY - minY)),
  };
}
