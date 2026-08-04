import type { ProjectedSpot } from '@/types/built-in';
import type { ChipConfigManifest, ChipTemplateEntry } from './chipConfigs';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export type ProjectedSpotPixelBounds = {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
};

const resolveProjectedSpotDimensions = (spot: ProjectedSpot) => {
  const width = clamp(spot.width ?? spot.diameterX, 0, 1);
  const height = clamp(spot.height ?? spot.diameterY, 0, 1);

  return { width, height };
};

const getProjectedSpotNormalizedBounds = (spot: ProjectedSpot) => {
  const { width, height } = resolveProjectedSpotDimensions(spot);

  return {
    startX: clamp(spot.x - width / 2, 0, 1),
    endX: clamp(spot.x + width / 2, 0, 1),
    startY: clamp(spot.y - height / 2, 0, 1),
    endY: clamp(spot.y + height / 2, 0, 1),
  };
};

const scaleNormalizedBoundsToPixelBounds = (args: {
  bounds: ProjectedSpotPixelBounds;
  width: number;
  height: number;
}) => {
  const { bounds, width, height } = args;

  return {
    startX: clamp(Math.floor(bounds.startX * width), 0, width),
    endX: clamp(Math.ceil(bounds.endX * width), 0, width),
    startY: clamp(Math.floor(bounds.startY * height), 0, height),
    endY: clamp(Math.ceil(bounds.endY * height), 0, height),
  } satisfies ProjectedSpotPixelBounds;
};

export function getProjectedSpotFullresBounds(args: {
  spot: ProjectedSpot;
  cropWidth: number;
  cropHeight: number;
}) {
  const { spot, cropWidth, cropHeight } = args;

  return scaleNormalizedBoundsToPixelBounds({
    bounds: getProjectedSpotNormalizedBounds(spot),
    width: cropWidth,
    height: cropHeight,
  });
}

/**
 * Project the full chip spot grid onto a rectangular image frame in
 * normalized [0,1] coordinates. Used to lay out the chip grid over the
 * full H&E source image for tissue selection.
 */
export function projectSpotsForCrop(args: {
  chip: ChipConfigManifest;
  templateEntries: ChipTemplateEntry[];
  cropWidth: number;
  cropHeight: number;
}) {
  const { chip, cropWidth, cropHeight, templateEntries } = args;
  const cols = chip.gridCols;
  const rows = chip.gridRows;

  const scale = Math.min(
    cropWidth / (cols * chip.spotDiameter + (cols + 1) * chip.spotGap),
    cropHeight / (rows * chip.spotDiameter + (rows + 1) * chip.spotGap),
  );

  const spotPx = chip.spotDiameter * scale;
  const gapPx = chip.spotGap * scale;
  const usedWidth = cols * spotPx + (cols + 1) * gapPx;
  const usedHeight = rows * spotPx + (rows + 1) * gapPx;
  const offsetX = (cropWidth - usedWidth) / 2 + gapPx;
  const offsetY = (cropHeight - usedHeight) / 2 + gapPx;

  const projected: ProjectedSpot[] = templateEntries.map((entry) => {
    const row = entry.arrayRow - 1;
    const col = entry.arrayCol - 1;
    const centerX = offsetX + col * (spotPx + gapPx) + spotPx / 2;
    const centerY = offsetY + row * (spotPx + gapPx) + spotPx / 2;

    const width = clamp(spotPx / cropWidth, 0, 1);
    const height = clamp(spotPx / cropHeight, 0, 1);

    return {
      id: entry.barcode,
      barcode: entry.barcode,
      arrayRow: entry.arrayRow,
      arrayCol: entry.arrayCol,
      x: clamp(centerX / cropWidth, 0, 1),
      y: clamp(centerY / cropHeight, 0, 1),
      width,
      height,
      diameterX: width,
      diameterY: height,
    };
  });

  return projected;
}
