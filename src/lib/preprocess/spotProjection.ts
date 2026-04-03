import type { ProjectedSpot } from '@/types/preprocess';
import type { ChipConfigManifest, ChipTemplateEntry } from './chipConfigs';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

    return {
      id: entry.barcode,
      barcode: entry.barcode,
      arrayRow: entry.arrayRow,
      arrayCol: entry.arrayCol,
      x: clamp(centerX / cropWidth, 0, 1),
      y: clamp(centerY / cropHeight, 0, 1),
      diameterX: clamp(spotPx / cropWidth, 0, 1),
      diameterY: clamp(spotPx / cropHeight, 0, 1),
    };
  });

  return projected;
}
