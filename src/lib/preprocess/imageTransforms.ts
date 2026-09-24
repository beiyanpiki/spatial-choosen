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

export function applyImageDisplayTransform(
  point: PreprocessPoint,
  transform: LocalizationImageTransform,
): PreprocessPoint {
  const centered = toCentered(point);
  const radians = degreesToRadians(normalizeRotationDegrees(transform.rotationDegrees));
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

export function invertImageDisplayTransform(
  point: PreprocessPoint,
  transform: LocalizationImageTransform,
): PreprocessPoint {
  const centered = toCentered(point);
  const unflipped = {
    x: centered.x * (transform.flipHorizontal ? -1 : 1),
    y: centered.y * (transform.flipVertical ? -1 : 1),
  };
  const radians = degreesToRadians(-normalizeRotationDegrees(transform.rotationDegrees));
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return fromCentered({
    x: unflipped.x * cos - unflipped.y * sin,
    y: unflipped.x * sin + unflipped.y * cos,
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
  const radians = degreesToRadians(normalizeRotationDegrees(transform.rotationDegrees));
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotatedDisplayDeltaX = displayDeltaX * cos - displayDeltaY * sin;
  const rotatedDisplayDeltaY = displayDeltaX * sin + displayDeltaY * cos;

  return {
    x: centerX + rotatedDisplayDeltaX * (transform.flipHorizontal ? -1 : 1),
    y: centerY + rotatedDisplayDeltaY * (transform.flipVertical ? -1 : 1),
  };
}

export function invertDisplayRectPointToSource(
  point: PreprocessPoint,
  transform: LocalizationImageTransform,
  displayRect: ImageDisplayRect,
): PreprocessPoint {
  const centerX = displayRect.originX + displayRect.width / 2;
  const centerY = displayRect.originY + displayRect.height / 2;
  const unflippedDisplayDeltaX = (point.x - centerX) * (transform.flipHorizontal ? -1 : 1);
  const unflippedDisplayDeltaY = (point.y - centerY) * (transform.flipVertical ? -1 : 1);
  const radians = degreesToRadians(-normalizeRotationDegrees(transform.rotationDegrees));
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const unrotatedDisplayDeltaX = unflippedDisplayDeltaX * cos - unflippedDisplayDeltaY * sin;
  const unrotatedDisplayDeltaY = unflippedDisplayDeltaX * sin + unflippedDisplayDeltaY * cos;

  return {
    x: unrotatedDisplayDeltaX / displayRect.width + CENTER,
    y: unrotatedDisplayDeltaY / displayRect.height + CENTER,
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

/**
 * Maps canvas-axis normalized chip bounds onto the oriented (rotated/flipped)
 * pixel frame. Chip bounds are stored in display-frame coordinates — the same
 * frame the user draws the capture box in — so the mapping is a direct scale to
 * the oriented frame size. Transforming the bounds again through the rotation
 * would double-apply the orientation and drift the crop away from the boxed
 * region.
 */
export function getOrientedChipBoundsPixelRect(
  rect: PreprocessRect,
  outputSize: PixelSize,
): PixelPoint & PixelSize {
  return {
    x: Math.round(rect.x * outputSize.width),
    y: Math.round(rect.y * outputSize.height),
    width: Math.max(1, Math.round(rect.width * outputSize.width)),
    height: Math.max(1, Math.round(rect.height * outputSize.height)),
  };
}
