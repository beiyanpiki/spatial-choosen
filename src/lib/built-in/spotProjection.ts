import type { ChipPlacement, ProjectedSpot } from '@/types/built-in';
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

/**
 * Project the chip spot grid into a user-placed region on the HE image,
 * returning spots in HE-normalized [0,1] coordinates. The placement carries a
 * `scale` (HE-px per chip unit); spot/gap HE sizes derive from it, so the pitch
 * stays constant while excluded rows/columns are dropped and the remaining
 * spots compact (the block shrinks). Spots keep their ORIGINAL arrayRow/arrayCol
 * (activation is looked up by those); only the visual position compacts.
 * Coordinates are intentionally unclamped so spots outside the HE render in the
 * white-padded area.
 */
export function projectSpotsForPlacement(args: {
  rows: number;
  columns: number;
  spotDiameter: number;
  spotGap: number;
  placement: ChipPlacement;
  excludedRows?: number[];
  excludedColumns?: number[];
  heWidth: number;
  heHeight: number;
}): ProjectedSpot[] {
  const {
    rows,
    columns,
    spotDiameter,
    spotGap,
    placement,
    excludedRows,
    excludedColumns,
    heWidth,
    heHeight,
  } = args;

  if (
    !heWidth
    || !heHeight
    || !placement.scale
    || rows <= 0
    || columns <= 0
    || spotDiameter <= 0
    || spotGap < 0
  ) {
    return [];
  }

  const excludedRowSet = new Set(excludedRows ?? []);
  const excludedColSet = new Set(excludedColumns ?? []);
  const visibleRows: number[] = [];
  for (let r = 1; r <= rows; r += 1) {
    if (!excludedRowSet.has(r)) visibleRows.push(r);
  }
  const visibleCols: number[] = [];
  for (let c = 1; c <= columns; c += 1) {
    if (!excludedColSet.has(c)) visibleCols.push(c);
  }
  if (visibleRows.length === 0 || visibleCols.length === 0) return [];

  const spotPx = spotDiameter * placement.scale;
  const gapPx = spotGap * placement.scale;
  const width = clamp(spotPx / heWidth, 0, 1);
  const height = clamp(spotPx / heHeight, 0, 1);

  const spots: ProjectedSpot[] = [];
  for (let ri = 0; ri < visibleRows.length; ri += 1) {
    const row = visibleRows[ri];
    const centerY = placement.y + gapPx + ri * (spotPx + gapPx) + spotPx / 2;
    for (let ci = 0; ci < visibleCols.length; ci += 1) {
      const col = visibleCols[ci];
      const centerX = placement.x + gapPx + ci * (spotPx + gapPx) + spotPx / 2;
      const id = `${row}:${col}`;
      spots.push({
        id,
        barcode: id,
        arrayRow: row,
        arrayCol: col,
        x: centerX / heWidth,
        y: centerY / heHeight,
        width,
        height,
        diameterX: width,
        diameterY: height,
      });
    }
  }

  return spots;
}
