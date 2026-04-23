import type {
  LocalizationBoxColor,
  LocalizationHandle,
  LocalizationImageTransform,
  LocalizationResizeHandle,
  LocalizationSlice,
  PreprocessPoint,
  PreprocessRect,
  PreprocessStepStatus,
} from "../../types/preprocess";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const LOCALIZATION_MIN_BOX_SIZE = 0.04;
export const DEFAULT_LOCALIZATION_BOX_COLOR: LocalizationBoxColor = "green";
export const DEFAULT_LOCALIZATION_IMAGE_TRANSFORM: LocalizationImageTransform = {
  rotationDegrees: 0,
  flipHorizontal: false,
  flipVertical: false,
  scale: 1,
};

export const LOCALIZATION_BOX_COLOR_SWATCHS: Record<
  LocalizationBoxColor,
  { fill: string; stroke: string; label: string }
> = {
  green: {
    fill: "rgba(0, 255, 0, 0.14)",
    stroke: "rgb(0, 255, 0)",
    label: "RGB(0,255,0)",
  },
  white: {
    fill: "rgba(255, 255, 255, 0.16)",
    stroke: "rgb(255, 255, 255)",
    label: "RGB(255,255,255)",
  },
};

export function createDefaultChipBounds(imageAspectRatio = 1): PreprocessRect {
  const width = 0.6 * Math.min(1, 1 / Math.max(imageAspectRatio, Number.EPSILON));
  const height = width * imageAspectRatio;

  return {
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height,
  };
}

export function clampNormalizedRect(rect: PreprocessRect, minSize = LOCALIZATION_MIN_BOX_SIZE): PreprocessRect {
  const width = clamp(rect.width, minSize, 1);
  const height = clamp(rect.height, minSize, 1);

  return {
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
    width,
    height,
  };
}

export function clampNormalizedSquareRect(
  rect: PreprocessRect,
  imageAspectRatio = 1,
  minSize = LOCALIZATION_MIN_BOX_SIZE,
): PreprocessRect {
  const aspectRatio = Math.max(imageAspectRatio, Number.EPSILON);
  const minHeight = minSize * aspectRatio;
  const x = clamp(rect.x, 0, 1 - minSize);
  const y = clamp(rect.y, 0, 1 - minHeight);
  const requestedSize = Math.max(rect.width, rect.height / aspectRatio, minSize);
  const maxSize = Math.max(minSize, Math.min(1 - x, (1 - y) / aspectRatio));
  const size = Math.min(requestedSize, maxSize);

  return {
    x,
    y,
    width: size,
    height: size * aspectRatio,
  };
}

export function buildPermissiveHeFocusHandles(rect: PreprocessRect): LocalizationHandle[] {
  return [
    { id: "nw", label: "NW", point: { x: rect.x, y: rect.y } },
    { id: "ne", label: "NE", point: { x: rect.x + rect.width, y: rect.y } },
    { id: "se", label: "SE", point: { x: rect.x + rect.width, y: rect.y + rect.height } },
    { id: "sw", label: "SW", point: { x: rect.x, y: rect.y + rect.height } },
  ];
}

export function buildLocalizationHandles(rect: PreprocessRect): LocalizationHandle[] {
  const nextRect = clampNormalizedRect(rect);

  return [
    { id: "nw", label: "NW", point: { x: nextRect.x, y: nextRect.y } },
    { id: "ne", label: "NE", point: { x: nextRect.x + nextRect.width, y: nextRect.y } },
    { id: "se", label: "SE", point: { x: nextRect.x + nextRect.width, y: nextRect.y + nextRect.height } },
    { id: "sw", label: "SW", point: { x: nextRect.x, y: nextRect.y + nextRect.height } },
  ];
}

export function normalizeLocalizationImageTransform(
  transform: Partial<LocalizationImageTransform> | null | undefined,
): LocalizationImageTransform {
  return {
    rotationDegrees: clamp(transform?.rotationDegrees ?? DEFAULT_LOCALIZATION_IMAGE_TRANSFORM.rotationDegrees, -180, 180),
    flipHorizontal: Boolean(transform?.flipHorizontal),
    flipVertical: Boolean(transform?.flipVertical),
    scale: clamp(transform?.scale ?? DEFAULT_LOCALIZATION_IMAGE_TRANSFORM.scale, 0.5, 4),
  };
}

export function normalizeLocalizationSlice(slice: LocalizationSlice): LocalizationSlice {
  const nextRect = slice.chipBounds ? clampNormalizedRect(slice.chipBounds) : null;

  return {
    ...slice,
    chipBounds: nextRect,
    handles: nextRect ? buildLocalizationHandles(nextRect) : [],
    boxColor: slice.boxColor === "white" ? "white" : DEFAULT_LOCALIZATION_BOX_COLOR,
    imageTransform: normalizeLocalizationImageTransform(slice.imageTransform),
  };
}

export function computeLocalizationStatus(hasImage: boolean, chipBounds: PreprocessRect | null): PreprocessStepStatus {
  if (!hasImage) return "idle";
  return chipBounds ? "complete" : "ready";
}

type ChipBoundsClampOptions = {
  clampToImage?: boolean;
};

const normalizeSquareRect = (
  rect: PreprocessRect,
  imageAspectRatio = 1,
  minSize = LOCALIZATION_MIN_BOX_SIZE,
): PreprocessRect => {
  const aspectRatio = Math.max(imageAspectRatio, Number.EPSILON);
  const size = Math.max(rect.width, rect.height / aspectRatio, minSize);

  return {
    x: rect.x,
    y: rect.y,
    width: size,
    height: size * aspectRatio,
  };
};

export function translateChipBounds(
  rect: PreprocessRect,
  delta: PreprocessPoint,
  imageAspectRatio = 1,
  options?: ChipBoundsClampOptions,
): PreprocessRect {
  const nextRect = normalizeSquareRect({
    x: rect.x + delta.x,
    y: rect.y + delta.y,
    width: rect.width,
    height: rect.height,
  }, imageAspectRatio);

  return options?.clampToImage === false
    ? nextRect
    : clampNormalizedSquareRect(nextRect, imageAspectRatio);
}

type RectEdges = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const clampSquareChipBounds = (
  rect: PreprocessRect,
  imageAspectRatio: number,
  minSize: number,
  options?: ChipBoundsClampOptions,
) => options?.clampToImage === false
  ? normalizeSquareRect(rect, imageAspectRatio, minSize)
  : clampNormalizedSquareRect(rect, imageAspectRatio, minSize);

const toEdges = (rect: PreprocessRect): RectEdges => ({
  left: rect.x,
  top: rect.y,
  right: rect.x + rect.width,
  bottom: rect.y + rect.height,
});

export function resizeChipBounds(
  rect: PreprocessRect,
  handle: LocalizationResizeHandle,
  point: PreprocessPoint,
  imageAspectRatio = 1,
  minSize = LOCALIZATION_MIN_BOX_SIZE,
  options?: ChipBoundsClampOptions,
): PreprocessRect {
  const aspectRatio = Math.max(imageAspectRatio, Number.EPSILON);
  const edges = toEdges(rect);
  const oppositeByHandle: Partial<Record<LocalizationResizeHandle, PreprocessPoint>> = {
    nw: { x: edges.right, y: edges.bottom },
    ne: { x: edges.left, y: edges.bottom },
    se: { x: edges.left, y: edges.top },
    sw: { x: edges.right, y: edges.top },
  };

  const opposite = oppositeByHandle[handle];
  if (opposite) {
    const deltaX = point.x - opposite.x;
    const deltaY = point.y - opposite.y;
    const signX = deltaX >= 0 ? 1 : -1;
    const signY = deltaY >= 0 ? 1 : -1;

    const maxSizeByX = signX > 0 ? 1 - opposite.x : opposite.x;
    const maxSizeByY = signY > 0 ? (1 - opposite.y) / aspectRatio : opposite.y / aspectRatio;
    const proposedSize = Math.max(Math.abs(deltaX), Math.abs(deltaY) / aspectRatio, minSize);
    const size = Math.min(proposedSize, maxSizeByX, maxSizeByY);

    const movedCorner = {
      x: opposite.x + signX * size,
      y: opposite.y + signY * size * aspectRatio,
    };

    return clampSquareChipBounds({
      x: Math.min(opposite.x, movedCorner.x),
      y: Math.min(opposite.y, movedCorner.y),
      width: Math.abs(movedCorner.x - opposite.x),
      height: Math.abs(movedCorner.y - opposite.y),
    }, aspectRatio, minSize, options);
  }

  const center = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };

  if (handle === 'e' || handle === 'w') {
    const anchorX = handle === 'e' ? edges.left : edges.right;
    const proposedSize = handle === 'e'
      ? point.x - anchorX
      : anchorX - point.x;
    const size = options?.clampToImage === false
      ? Math.max(proposedSize, minSize)
      : clamp(
          Math.min(
            proposedSize,
            handle === 'e' ? 1 - anchorX : anchorX,
            Math.min((2 * center.y) / aspectRatio, (2 * (1 - center.y)) / aspectRatio),
          ),
          minSize,
          1,
        );
    const nextX = handle === 'e' ? anchorX : anchorX - size;
    return clampSquareChipBounds({
      x: nextX,
      y: center.y - (size * aspectRatio) / 2,
      width: size,
      height: size * aspectRatio,
    }, aspectRatio, minSize, options);
  }

  const anchorY = handle === 's' ? edges.top : edges.bottom;
  const proposedSize = (handle === 's'
    ? point.y - anchorY
    : anchorY - point.y) / aspectRatio;
  const size = options?.clampToImage === false
    ? Math.max(proposedSize, minSize)
    : clamp(
        Math.min(
          proposedSize,
          handle === 's' ? (1 - anchorY) / aspectRatio : anchorY / aspectRatio,
          Math.min(2 * center.x, 2 * (1 - center.x)),
        ),
        minSize,
        1,
      );
  const nextY = handle === 's' ? anchorY : anchorY - size * aspectRatio;
  return clampSquareChipBounds({
    x: center.x - size / 2,
    y: nextY,
    width: size,
    height: size * aspectRatio,
  }, aspectRatio, minSize, options);
}
