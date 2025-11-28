import { ChipType, Spot } from '@/types/project';

export type RawChipConfig = {
  chip?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export const CHIP_LAYOUTS: Record<ChipType, { grid: number; spot: number; gap: number }> = {
  '50um': { grid: 64, spot: 50, gap: 50 },
  '15um': { grid: 96, spot: 25, gap: 15 },
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const parseChipType = (value: unknown): ChipType | null => {
  if (!value) return null;
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[μµ]/g, 'u')
    .replace(/\s|_/g, '');

  if (normalized === 'dy' || normalized === 'none' || normalized === '') return null;

  // common textual forms
  if (normalized === '50um' || normalized === '50u' || normalized === '50') return '50um';
  if (normalized === '15um' || normalized === '15u' || normalized === '15') return '15um';

  // grid-size shorthand
  if (normalized === '64' || normalized === 'grid64' || normalized === '64grid') return '50um';
  if (normalized === '96' || normalized === 'grid96' || normalized === '96grid') return '15um';

  // lenient prefixes (e.g., "50um", "50", "50-um", "50micron")
  if (normalized.startsWith('50')) return '50um';
  if (normalized.startsWith('15')) return '15um';

  return null;
};

export const normalizeChipRect = (
  raw: RawChipConfig,
  imageWidth?: number,
  imageHeight?: number,
) => {
  if (!imageWidth || !imageHeight) return null;
  const parsedWidth = Number(raw.width);
  const width = Number.isFinite(parsedWidth) ? parsedWidth : undefined;
  const parsedHeight = Number(raw.height);
  const height = Number.isFinite(parsedHeight) && parsedHeight > 0 ? parsedHeight : width;
  const parsedX = Number(raw.x);
  const parsedY = Number(raw.y);
  const x = Number.isFinite(parsedX) ? parsedX : undefined;
  const y = Number.isFinite(parsedY) ? parsedY : undefined;
  if (x === undefined || y === undefined || width === undefined || !height || width <= 0 || height <= 0) {
    return null;
  }

  const normX = clamp01(x / imageWidth);
  const normY = clamp01(y / imageHeight);
  const normW = Math.min(width / imageWidth, 1 - normX);
  const normH = Math.min(height / imageHeight, 1 - normY);

  if (normW <= 0 || normH <= 0) return null;

  return {
    x: normX,
    y: normY,
    width: normW,
    height: normH,
  } as const;
};

export const buildSpotMatrix = (
  rect: { x: number; y: number; width: number; height: number },
  chipType: ChipType,
  imageWidth?: number,
  imageHeight?: number,
): Spot[][] => {
  if (!imageWidth || !imageHeight) return [];
  const layout = CHIP_LAYOUTS[chipType];
  const cols = layout.grid;
  const rows = layout.grid;
  const rectWidthPx = rect.width * imageWidth;
  const rectHeightPx = rect.height * imageHeight;
  const scale = Math.min(
    rectWidthPx / (cols * layout.spot + (cols + 1) * layout.gap),
    rectHeightPx / (rows * layout.spot + (rows + 1) * layout.gap),
  );

  if (!Number.isFinite(scale) || scale <= 0) return [];

  const spotPx = layout.spot * scale;
  const gapPx = layout.gap * scale;
  const usedWidth = cols * spotPx + (cols + 1) * gapPx;
  const usedHeight = rows * spotPx + (rows + 1) * gapPx;
  const offsetX = rect.x * imageWidth + (rectWidthPx - usedWidth) / 2 + gapPx;
  const offsetY = rect.y * imageHeight + (rectHeightPx - usedHeight) / 2 + gapPx;

  const matrix: Spot[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const rowSpots: Spot[] = [];
    const yPx = offsetY + row * (spotPx + gapPx);
    for (let col = 0; col < cols; col += 1) {
      const xPx = offsetX + col * (spotPx + gapPx);
      rowSpots.push({
        x: xPx / imageWidth,
        y: yPx / imageHeight,
        sizeX: spotPx / imageWidth,
        sizeY: spotPx / imageHeight,
      });
    }
    matrix.push(rowSpots);
  }

  return matrix;
};
