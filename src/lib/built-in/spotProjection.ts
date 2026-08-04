import type {
  CropQcTransitionalGeometryContract,
  PreprocessRect,
  ProjectedSpot,
  SpotExportChipRectSource,
  SpotExportGeometryContract,
  SpotExportTemplateAnchor,
  SpotExportTemplateAnchorBounds,
} from '@/types/built-in';
import type { ChipConfigManifest, ChipTemplateEntry } from './chipConfigs';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export type ProjectedSpotPixelBounds = {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
};

export type ProjectedSpotFullresCsvCoordinates = {
  pxl_row_in_fullres: number;
  pxl_col_in_fullres: number;
};

export type SpotExportFullresCoordinates = {
  barcode: string;
  arrayRow: number;
  arrayCol: number;
} & ProjectedSpotFullresCsvCoordinates;

export type SpotExportFullresLayout = SpotExportGeometryContract & {
  spotCenters: SpotExportFullresCoordinates[];
  squareSideLength: number;
};

type SpotExportCropQcGeometry = Pick<
  CropQcTransitionalGeometryContract,
  'eosinReferenceGeometry' | 'heQcGeometry'
>;

const resolveSpotExportChipRect = (args: {
  cropQc?: SpotExportCropQcGeometry | null;
  exportFullresWidth: number;
  exportFullresHeight: number;
}): {
  chipRect: PreprocessRect;
  chipRectSource: SpotExportChipRectSource;
} => {
  const { exportFullresWidth, exportFullresHeight } = args;
  const eosinReferenceGeometry = args.cropQc?.eosinReferenceGeometry;
  const heQcGeometry = args.cropQc?.heQcGeometry;
  const heQcRect = heQcGeometry?.rect;

  // eosinReferenceGeometry describes the crop region in eosin image space.
  // It should map to the full HE fullres export frame (the crop).
  // See preprocess.ts lines 278-281 for the contract.
  if (eosinReferenceGeometry) {
    return {
      chipRect: {
        x: 0,
        y: 0,
        width: exportFullresWidth,
        height: exportFullresHeight,
      },
      chipRectSource: 'eosin-reference-geometry',
    };
  }

  // heQcGeometry describes the chip region within the crop-local frame.
  // Convert normalized coordinates to pixel coordinates.
  if (heQcRect) {
    return {
      chipRect: {
        x: heQcRect.x * exportFullresWidth,
        y: heQcRect.y * exportFullresHeight,
        width: heQcRect.width * exportFullresWidth,
        height: heQcRect.height * exportFullresHeight,
      },
      chipRectSource: 'he-qc-geometry',
    };
  }

  return {
    chipRect: {
      x: 0,
      y: 0,
      width: exportFullresWidth,
      height: exportFullresHeight,
    },
    chipRectSource: 'crop-bounds-fallback',
  };
};

const toSpotExportTemplateAnchor = (entry: ChipTemplateEntry): SpotExportTemplateAnchor => {
  if (
    typeof entry.pxl_row_in_fullres !== 'number'
    || !Number.isFinite(entry.pxl_row_in_fullres)
    || typeof entry.pxl_col_in_fullres !== 'number'
    || !Number.isFinite(entry.pxl_col_in_fullres)
  ) {
    throw new Error(`Chip template entry ${entry.barcode} is missing full-resolution anchor metadata.`);
  }

  return {
    barcode: entry.barcode,
    arrayRow: entry.arrayRow,
    arrayCol: entry.arrayCol,
    pxl_row_in_fullres: entry.pxl_row_in_fullres,
    pxl_col_in_fullres: entry.pxl_col_in_fullres,
  } satisfies SpotExportTemplateAnchor;
};

const getSpotExportTemplateAnchorBounds = (
  templateAnchors: SpotExportTemplateAnchor[],
): SpotExportTemplateAnchorBounds => {
  const firstAnchor = templateAnchors[0];
  if (!firstAnchor) {
    throw new Error('Chip template anchor geometry missing. Reapply chip configuration before export.');
  }

  let minPxlRowInFullres = firstAnchor.pxl_row_in_fullres;
  let maxPxlRowInFullres = firstAnchor.pxl_row_in_fullres;
  let minPxlColInFullres = firstAnchor.pxl_col_in_fullres;
  let maxPxlColInFullres = firstAnchor.pxl_col_in_fullres;

  for (const anchor of templateAnchors.slice(1)) {
    minPxlRowInFullres = Math.min(minPxlRowInFullres, anchor.pxl_row_in_fullres);
    maxPxlRowInFullres = Math.max(maxPxlRowInFullres, anchor.pxl_row_in_fullres);
    minPxlColInFullres = Math.min(minPxlColInFullres, anchor.pxl_col_in_fullres);
    maxPxlColInFullres = Math.max(maxPxlColInFullres, anchor.pxl_col_in_fullres);
  }

  return {
    minPxlRowInFullres,
    maxPxlRowInFullres,
    minPxlColInFullres,
    maxPxlColInFullres,
  } satisfies SpotExportTemplateAnchorBounds;
};

const normalizeTemplateAnchorAxisValue = (value: number, min: number, max: number) => {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) {
    return 0.5;
  }

  return clamp((value - min) / span, 0, 1);
};

const getSortedUniqueValues = (values: number[]) => Array.from(new Set(values)).sort((left, right) => left - right);

const getMinimumPositiveDifference = (values: number[]) => {
  let minimumDifference: number | null = null;

  for (let index = 1; index < values.length; index += 1) {
    const previousValue = values[index - 1];
    const currentValue = values[index];
    if (previousValue === undefined || currentValue === undefined) {
      continue;
    }

    const difference = currentValue - previousValue;
    if (difference <= 0) {
      continue;
    }

    minimumDifference = minimumDifference === null
      ? difference
      : Math.min(minimumDifference, difference);
  }

  return minimumDifference;
};

const isValidPositiveNumber = (value: unknown): value is number => (
  typeof value === 'number'
  && Number.isFinite(value)
  && value > 0
);

const resolveSpotExportAnchorCoordinates = (args: {
  templateAnchor: SpotExportTemplateAnchor;
  exportGeometry: Pick<SpotExportGeometryContract, 'chipRect' | 'templateAnchorBounds'>;
}) => {
  const {
    templateAnchor,
    exportGeometry: {
      chipRect,
      templateAnchorBounds,
    },
  } = args;

  const rowFraction = normalizeTemplateAnchorAxisValue(
    templateAnchor.pxl_row_in_fullres,
    templateAnchorBounds.minPxlRowInFullres,
    templateAnchorBounds.maxPxlRowInFullres,
  );
  const colFraction = normalizeTemplateAnchorAxisValue(
    templateAnchor.pxl_col_in_fullres,
    templateAnchorBounds.minPxlColInFullres,
    templateAnchorBounds.maxPxlColInFullres,
  );

  return {
    pxl_row_in_fullres: chipRect.y + rowFraction * chipRect.height,
    pxl_col_in_fullres: chipRect.x + colFraction * chipRect.width,
  } satisfies ProjectedSpotFullresCsvCoordinates;
};

const roundProjectedSpotFullresCoordinates = (
  coordinates: ProjectedSpotFullresCsvCoordinates,
): ProjectedSpotFullresCsvCoordinates => ({
  pxl_row_in_fullres: Math.round(coordinates.pxl_row_in_fullres),
  pxl_col_in_fullres: Math.round(coordinates.pxl_col_in_fullres),
});

const resolveSpotExportAxisPitch = (args: {
  sourceValues: number[];
  sourceMin: number;
  sourceMax: number;
  targetSpan: number;
}) => {
  const minimumSourceStep = getMinimumPositiveDifference(getSortedUniqueValues(args.sourceValues));
  if (minimumSourceStep === null) {
    return null;
  }

  const sourceSpan = args.sourceMax - args.sourceMin;
  if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
    return null;
  }

  return (minimumSourceStep / sourceSpan) * args.targetSpan;
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

export function getProjectedSpotLowresBounds(args: {
  spot: ProjectedSpot;
  cropWidth: number;
  cropHeight: number;
  tissue_lowres_scalef: number;
}) {
  const {
    spot,
    cropWidth,
    cropHeight,
    tissue_lowres_scalef,
  } = args;

  return scaleNormalizedBoundsToPixelBounds({
    bounds: getProjectedSpotNormalizedBounds(spot),
    width: Math.max(1, Math.round(cropWidth * tissue_lowres_scalef)),
    height: Math.max(1, Math.round(cropHeight * tissue_lowres_scalef)),
  });
}

export function getProjectedSpotFullresCsvCoordinates(args: {
  spot: ProjectedSpot;
  cropWidth: number;
  cropHeight: number;
}) {
  const { spot, cropWidth, cropHeight } = args;
  const bounds = getProjectedSpotNormalizedBounds(spot);

  return {
    pxl_row_in_fullres: Math.round(((bounds.startY + bounds.endY) / 2) * cropHeight),
    pxl_col_in_fullres: Math.round(((bounds.startX + bounds.endX) / 2) * cropWidth),
  } satisfies ProjectedSpotFullresCsvCoordinates;
}

export function resolveSpotExportGeometry(args: {
  templateEntries: ChipTemplateEntry[];
  cropQc?: SpotExportCropQcGeometry | null;
  exportFullresWidth: number;
  exportFullresHeight: number;
}) {
  const {
    templateEntries,
    cropQc,
    exportFullresWidth,
    exportFullresHeight,
  } = args;
  const templateAnchors = templateEntries.map(toSpotExportTemplateAnchor);
  const { chipRect, chipRectSource } = resolveSpotExportChipRect({
    cropQc,
    exportFullresWidth,
    exportFullresHeight,
  });

  return {
    chipRect,
    chipRectSource,
    templateAnchorBounds: getSpotExportTemplateAnchorBounds(templateAnchors),
    templateAnchors,
  } satisfies SpotExportGeometryContract;
}

export function resolveSpotExportFullresLayout(args: {
  templateEntries: ChipTemplateEntry[];
  chipManifest: Pick<ChipConfigManifest, 'spotDiameter' | 'spotGap'>;
  cropQc?: SpotExportCropQcGeometry | null;
  exportFullresWidth: number;
  exportFullresHeight: number;
}) {
  const {
    templateEntries,
    chipManifest,
    cropQc,
    exportFullresWidth,
    exportFullresHeight,
  } = args;
  const exportGeometry = resolveSpotExportGeometry({
    templateEntries,
    cropQc,
    exportFullresWidth,
    exportFullresHeight,
  });
  const rowPitch = resolveSpotExportAxisPitch({
    sourceValues: exportGeometry.templateAnchors.map((anchor) => anchor.pxl_row_in_fullres),
    sourceMin: exportGeometry.templateAnchorBounds.minPxlRowInFullres,
    sourceMax: exportGeometry.templateAnchorBounds.maxPxlRowInFullres,
    targetSpan: exportGeometry.chipRect.height,
  });
  const colPitch = resolveSpotExportAxisPitch({
    sourceValues: exportGeometry.templateAnchors.map((anchor) => anchor.pxl_col_in_fullres),
    sourceMin: exportGeometry.templateAnchorBounds.minPxlColInFullres,
    sourceMax: exportGeometry.templateAnchorBounds.maxPxlColInFullres,
    targetSpan: exportGeometry.chipRect.width,
  });
  const squareSideLengthCandidates = [rowPitch, colPitch].filter((pitch): pitch is number => pitch !== null);

  if (squareSideLengthCandidates.length === 0) {
    throw new Error('Spot export geometry is missing anchor spacing. Reapply chip configuration before export.');
  }

  const spotPitchRatio = chipManifest.spotDiameter / (chipManifest.spotDiameter + chipManifest.spotGap);

  return {
    ...exportGeometry,
    spotCenters: exportGeometry.templateAnchors.map((templateAnchor) => ({
      barcode: templateAnchor.barcode,
      arrayRow: templateAnchor.arrayRow,
      arrayCol: templateAnchor.arrayCol,
      ...roundProjectedSpotFullresCoordinates(resolveSpotExportAnchorCoordinates({
        templateAnchor,
        exportGeometry,
      })),
    } satisfies SpotExportFullresCoordinates)),
    squareSideLength: (squareSideLengthCandidates.reduce((sum, pitch) => sum + pitch, 0)
      / squareSideLengthCandidates.length)
      * spotPitchRatio,
  } satisfies SpotExportFullresLayout;
}

export function getProjectedSpotFullresSquareSideLength(args: {
  projectedSpots: ProjectedSpot[];
  cropWidth: number;
  cropHeight: number;
}) {
  const { projectedSpots, cropWidth, cropHeight } = args;
  const firstSpot = projectedSpots[0];
  if (!firstSpot) {
    throw new Error('Projected spot geometry missing. Reapply chip configuration before export.');
  }

  const bounds = getProjectedSpotFullresBounds({
    spot: firstSpot,
    cropWidth,
    cropHeight,
  });

  return Math.max(1, Math.round(((bounds.endX - bounds.startX) + (bounds.endY - bounds.startY)) / 2));
}

export function resolveAuthoritativeSpotDiameterFullres(args: {
  persistedSpotDiameterFullres?: number | null;
  projectedSpots?: ProjectedSpot[] | null;
  cropWidth?: number | null;
  cropHeight?: number | null;
}) {
  const {
    persistedSpotDiameterFullres,
    projectedSpots,
    cropWidth,
    cropHeight,
  } = args;

  if (isValidPositiveNumber(persistedSpotDiameterFullres)) {
    return persistedSpotDiameterFullres;
  }

  if (
    !projectedSpots
    || projectedSpots.length === 0
    || typeof cropWidth !== 'number'
    || cropWidth <= 0
    || typeof cropHeight !== 'number'
    || cropHeight <= 0
  ) {
    return null;
  }

  return getProjectedSpotFullresSquareSideLength({
    projectedSpots,
    cropWidth,
    cropHeight,
  });
}

export function resolveSpotExportFullresDiameter(args: {
  persistedSpotDiameterFullres?: number | null;
  exportLayout: Pick<SpotExportFullresLayout, 'squareSideLength'>;
}) {
  if (isValidPositiveNumber(args.persistedSpotDiameterFullres)) {
    return args.persistedSpotDiameterFullres;
  }

  return args.exportLayout.squareSideLength;
}

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
