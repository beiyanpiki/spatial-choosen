import type {
  LocalizationImageTransform,
  PreprocessPoint,
  PreprocessRect,
} from "../../types/preprocess";

const CENTER = 0.5;

const toCentered = (point: PreprocessPoint) => ({
  x: point.x - CENTER,
  y: point.y - CENTER,
});

const fromCentered = (point: PreprocessPoint): PreprocessPoint => ({
  x: point.x + CENTER,
  y: point.y + CENTER,
});

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
