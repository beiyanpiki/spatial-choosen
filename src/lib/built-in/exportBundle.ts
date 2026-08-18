import JSZip from 'jszip';
import type { PreprocessProject, ProjectedSpot } from '@/types/built-in';
import { PREPROCESS_EXPORT_HIRES_MAX_SIDE, PREPROCESS_EXPORT_LOWRES_MAX_SIDE } from './constants';
import { createThumbnailBlob, getDownsampledDimensions, reencodeImageAsPngBlob } from './sourceImage';
import { selectedSpotIdsFromMatrix, validateTissueActivationMatrix } from './tissueMatrix';
import { resolveTissueSelectionSupport } from './tissueSupport';

const FIDUCIAL_DIAMETER_FULLRES = 0.027;
const ZIP_DEFAULT_NAME = 'built-in-project';

type BuiltInZipExportReadiness =
  | {
      canExport: false;
      reason: string;
    }
  | {
      canExport: true;
      data: {
        heSourceUrl: string;
        heWidth: number;
        heHeight: number;
        projectedSpots: ProjectedSpot[];
        rows: number;
        columns: number;
        matrixValues: number[];
        selectedSpotIds: Set<string>;
        spotDiameterFullres: number;
        tissueHiresScale: number;
        tissueLowresScale: number;
        barcodesByPosition: Record<string, string>;
        visibleRows: number[];
        visibleCols: number[];
      };
    };

const isSupportedChipConfigId = (chipType: string | null): chipType is '50um' | '15um' =>
  chipType === '50um' || chipType === '15um';

const getVisiblePositions = (count: number, excluded: number[]) => {
  const excludedSet = new Set(excluded);
  const visible: number[] = [];
  for (let position = 1; position <= count; position += 1) {
    if (!excludedSet.has(position)) visible.push(position);
  }
  return visible;
};

export function getBuiltInZipExportReadiness(
  project: PreprocessProject,
  projectedSpots: ProjectedSpot[],
): BuiltInZipExportReadiness {
  const he = project.sourceAssets.images.he;
  const heWidth = typeof he?.width === 'number' ? he.width : 0;
  const heHeight = typeof he?.height === 'number' ? he.height : 0;
  if (!he) {
    return {
      canExport: false,
      reason: 'H&E source image is missing. Upload the HE image before export.',
    };
  }
  if (heWidth <= 0 || heHeight <= 0) {
    return {
      canExport: false,
      reason: 'Full-resolution H&E image dimensions are unavailable. Upload the HE image before export.',
    };
  }

  const heSourceUrl = he.dataUrl ?? he.objectUrl;
  if (!heSourceUrl) {
    return {
      canExport: false,
      reason: 'H&E source image payload is unavailable. Re-upload the HE image before export.',
    };
  }

  const { chipConfig } = project;
  if (chipConfig.status !== 'complete' || chipConfig.isStale) {
    return {
      canExport: false,
      reason: 'Spot projection is stale or incomplete. Reapply the chip grid before export.',
    };
  }

  const rows = chipConfig.rows;
  const columns = chipConfig.columns;
  const spotDiameter = chipConfig.spotDiameter;
  const placement = chipConfig.placement;
  if (
    !isSupportedChipConfigId(chipConfig.chipType)
    || typeof rows !== 'number'
    || rows <= 0
    || typeof columns !== 'number'
    || columns <= 0
    || typeof spotDiameter !== 'number'
    || spotDiameter <= 0
    || !placement
    || typeof placement.scale !== 'number'
    || !Number.isFinite(placement.scale)
    || placement.scale <= 0
    || projectedSpots.length === 0
  ) {
    return {
      canExport: false,
      reason: 'Chip projection geometry or spot diameter metadata is missing. Reapply the chip grid before export.',
    };
  }

  if (project.tissueSelection.status !== 'complete' || project.tissueSelection.isStale) {
    return {
      canExport: false,
      reason: 'Tissue selection is stale or incomplete. Import a tissue activation CSV or finish tissue edits before export.',
    };
  }

  const support = resolveTissueSelectionSupport({
    chipType: chipConfig.chipType,
    rows,
    columns,
  });
  if (support.supportState === 'unsupported') {
    return {
      canExport: false,
      reason: support.unsupportedReason ?? 'Tissue export requires a supported chip configuration.',
    };
  }

  const matrix = project.tissueSelection.matrix;
  if (!matrix) {
    return {
      canExport: false,
      reason: 'Tissue matrix data is missing. Import a tissue activation CSV before export.',
    };
  }

  let validatedMatrix;
  try {
    validatedMatrix = validateTissueActivationMatrix(matrix);
  } catch (error) {
    return {
      canExport: false,
      reason: error instanceof Error ? error.message : 'Tissue matrix data is invalid.',
    };
  }

  if (validatedMatrix.rows !== rows || validatedMatrix.columns !== columns) {
    return {
      canExport: false,
      reason: 'Tissue matrix dimensions must match the projected chip rows and columns before export.',
    };
  }

  const visibleRows = getVisiblePositions(rows, chipConfig.excludedRows);
  const visibleCols = getVisiblePositions(columns, chipConfig.excludedColumns);
  if (visibleRows.length === 0 || visibleCols.length === 0) {
    return {
      canExport: false,
      reason: 'All chip rows or columns are excluded. Remove at least one row and one column before export.',
    };
  }

  const spotDiameterFullres = spotDiameter * placement.scale;
  if (!Number.isFinite(spotDiameterFullres) || spotDiameterFullres <= 0) {
    return {
      canExport: false,
      reason: 'Chip projection geometry or spot diameter metadata is missing. Reapply the chip grid before export.',
    };
  }

  const tissueHiresScale = getDownsampledDimensions(
    heWidth,
    heHeight,
    PREPROCESS_EXPORT_HIRES_MAX_SIDE,
  ).width / heWidth;
  const tissueLowresScale = getDownsampledDimensions(
    heWidth,
    heHeight,
    PREPROCESS_EXPORT_LOWRES_MAX_SIDE,
  ).width / heWidth;

  return {
    canExport: true,
    data: {
      heSourceUrl,
      heWidth,
      heHeight,
      projectedSpots,
      rows,
      columns,
      matrixValues: validatedMatrix.values,
      selectedSpotIds: new Set(selectedSpotIdsFromMatrix(validatedMatrix, projectedSpots)),
      spotDiameterFullres,
      tissueHiresScale,
      tissueLowresScale,
      barcodesByPosition: chipConfig.barcodesByPosition,
      visibleRows,
      visibleCols,
    },
  };
}

const toCsv = (args: {
  projectedSpots: ProjectedSpot[];
  selectedSpotIds: Set<string>;
  barcodesByPosition: Record<string, string>;
  visibleRows: number[];
  visibleCols: number[];
  heWidth: number;
  heHeight: number;
}) => {
  const { projectedSpots, selectedSpotIds, barcodesByPosition, visibleRows, visibleCols, heWidth, heHeight } = args;
  const compactedRowByArrayRow = new Map(visibleRows.map((row, index) => [row, index + 1]));
  const compactedColByArrayCol = new Map(visibleCols.map((col, index) => [col, index + 1]));
  const visibleRowCount = visibleRows.length;

  const lines = [
    'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
  ];

  // Convention: array_row/array_col are 1-based from the BOTTOM-LEFT of the grid
  // (array_row 1 = image bottom), matching the imported CSV and the `/preprocess`
  // export; pxl_row/col are 0-based from the TOP-LEFT of the image.
  //
  // Spots place arrayRow 1 at the TOP of the placed grid block (projectSpotsForPlacement
  // grows centerY with the row index), so the compacted in-memory index is flipped
  // (bottom-first). The barcode is looked up by the spot's ORIGINAL position, so it
  // never shifts with the renumbering; columns are not flipped.
  const rowsByArrayPosition = projectedSpots.flatMap((spot) => {
    const compactedRow = compactedRowByArrayRow.get(spot.arrayRow);
    const arrayCol = compactedColByArrayCol.get(spot.arrayCol);
    if (typeof compactedRow !== 'number' || typeof arrayCol !== 'number') {
      return [];
    }

    return [{
      barcode: barcodesByPosition[`${spot.arrayRow}:${spot.arrayCol}`] ?? spot.barcode,
      inTissue: selectedSpotIds.has(spot.id) ? '1' : '0',
      arrayRow: visibleRowCount + 1 - compactedRow,
      arrayCol,
      pxlRowInFullres: Math.min(heHeight, Math.max(0, Math.round(spot.y * heHeight))),
      pxlColInFullres: Math.min(heWidth, Math.max(0, Math.round(spot.x * heWidth))),
    }];
  }).sort((left, right) => left.arrayRow - right.arrayRow || left.arrayCol - right.arrayCol);

  for (const row of rowsByArrayPosition) {
    lines.push([
      row.barcode,
      row.inTissue,
      String(row.arrayRow),
      String(row.arrayCol),
      String(row.pxlRowInFullres),
      String(row.pxlColInFullres),
    ].join(','));
  }

  return `${lines.join('\n')}\n`;
};

const toMatrixCsv = (
  matrixValues: number[],
  columns: number,
  visibleRows: number[],
  visibleCols: number[],
) => {
  // Emit rows in the same bottom-left order as tissue_positions.csv: the
  // in-memory row 1 is the grid top, so iterate visible rows in reverse.
  const lines = [...visibleRows].reverse().map((row) => (
    visibleCols.map((col) => String(matrixValues[(row - 1) * columns + (col - 1)])).join(',')
  ));

  return `${lines.join('\n')}\n`;
};

export async function exportBuiltInZip(args: {
  project: PreprocessProject;
  projectedSpots: ProjectedSpot[];
}): Promise<{ fileName: string; blob: Blob }> {
  const { project, projectedSpots } = args;
  const readiness = getBuiltInZipExportReadiness(project, projectedSpots);
  if (!readiness.canExport) {
    throw new Error(readiness.reason);
  }

  const {
    heSourceUrl,
    heWidth,
    heHeight,
    columns,
    matrixValues,
    selectedSpotIds,
    spotDiameterFullres,
    tissueHiresScale,
    tissueLowresScale,
    barcodesByPosition,
    visibleRows,
    visibleCols,
  } = readiness.data;

  const [fullresBlob, hiresBlob, lowresBlob] = await Promise.all([
    reencodeImageAsPngBlob(heSourceUrl),
    createThumbnailBlob(heSourceUrl, PREPROCESS_EXPORT_HIRES_MAX_SIDE),
    createThumbnailBlob(heSourceUrl, PREPROCESS_EXPORT_LOWRES_MAX_SIDE),
  ]);
  const toBytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

  const scalefactors = {
    spot_diameter_fullres: spotDiameterFullres,
    fiducial_diameter_fullres: FIDUCIAL_DIAMETER_FULLRES,
    tissue_hires_scalef: tissueHiresScale,
    tissue_lowres_scalef: tissueLowresScale,
  };

  const zip = new JSZip();
  zip.file('tissue_fullres_image.png', await toBytes(fullresBlob));
  zip.file('tissue_hires_image.png', await toBytes(hiresBlob));
  zip.file('tissue_lowres_image.png', await toBytes(lowresBlob));
  zip.file('scalefactors_json.json', JSON.stringify(scalefactors, null, 2));
  zip.file('tissue_positions.csv', toCsv({
    projectedSpots,
    selectedSpotIds,
    barcodesByPosition,
    visibleRows,
    visibleCols,
    heWidth,
    heHeight,
  }));
  zip.file('tissue_matrix.csv', toMatrixCsv(matrixValues, columns, visibleRows, visibleCols));

  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    fileName: `${project.name || ZIP_DEFAULT_NAME}-preprocess.zip`,
    blob,
  };
}
