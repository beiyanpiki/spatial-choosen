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

// Chip bounds are captured in the fixed canvas-axis coordinate system: the
// stage draws the overlay at raw normalized positions while the image rotates
// underneath it, so the bounds are source-normalized positions of the *display
// frame* (aspect = source aspect). The oriented output is the source with the
// transform already applied, so the crop region is the box mapped directly at
// source-pixel offsets from the output center — applying the transform again
// would crop a different region than the box covers.
export function getCanvasAxisChipBoundsPixelRect(
  rect: PreprocessRect,
  sourceSize: PixelSize,
  outputSize: PixelSize,
): PixelPoint & PixelSize {
  return {
    x: Math.round(outputSize.width / 2 + (rect.x - 0.5) * sourceSize.width),
    y: Math.round(outputSize.height / 2 + (rect.y - 0.5) * sourceSize.height),
    width: Math.max(1, Math.round(rect.width * sourceSize.width)),
    height: Math.max(1, Math.round(rect.height * sourceSize.height)),
  };
}
