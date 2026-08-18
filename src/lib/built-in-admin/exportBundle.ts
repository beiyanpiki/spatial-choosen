import JSZip from 'jszip';
import type {
  CropQcTransitionalGeometryContract,
  PreprocessProject,
  ProjectedSpot,
  TissueActivationMatrix,
} from '@/types/built-in-admin';
import { applyExclusionLockToMatrix } from './exclusion';
import { type ChipConfigManifest, loadChipConfigData } from './chipConfigs';
import { getPreprocessPackageSourceEntries, serializePreprocessProject } from './package';
import {
  resolveAuthoritativeSpotDiameterFullres,
  resolveSpotExportFullresLayout,
} from './spotProjection';
import { selectedSpotIdsFromMatrix, validateTissueActivationMatrix } from './tissueMatrix';
import { resolveTissueSelectionSupport } from './tissueSupport';

const FIDUCIAL_DIAMETER_FULLRES = 0.027;
const FULLRES_DIMENSIONS_UNAVAILABLE_ERROR = 'Full-resolution H&E crop image dimensions are unavailable. Regenerate crop QC before export.';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

type PreprocessExportReadiness =
  | {
      canExport: false;
      reason: string;
    }
  | {
      canExport: true;
      data: {
        cropWidth: number;
        cropHeight: number;
        heCropAssets: {
          fullres: { dataUrl: string };
          hires: { dataUrl: string };
          lowres: { dataUrl: string };
        };
        projectedSpots: ProjectedSpot[];
        rows: number;
        columns: number;
        matrixValues: number[];
        selectedSpotIds: Set<string>;
        /** Barcodes captured from the tissue activation CSV, keyed by in-memory `${arrayRow}:${arrayCol}` (image-top). */
        barcodesByPosition: Record<string, string>;
        spotDiameterFullres: number;
        tissueHiresScale: number;
        tissueLowresScale: number;
        alignedImageDataUrl: string | null;
      };
    };

const imageSourceToBytes = async (sourceUrl: string): Promise<Uint8Array> => {
  if (sourceUrl.startsWith('blob:')) {
    const response = await fetch(sourceUrl);
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  const [meta, payload] = sourceUrl.split(',', 2);
  if (!meta || !payload) throw new Error('Invalid data URL payload');
  const binary = atob(payload);
  const buffer = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    buffer[index] = binary.charCodeAt(index);
  }
  return buffer;
};

export const getPngDimensionsFromBytes = (bytes: Uint8Array) => {
  const fail = () => {
    throw new Error(FULLRES_DIMENSIONS_UNAVAILABLE_ERROR);
  };

  if (bytes.byteLength < 24) {
    fail();
  }

  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      fail();
    }
  }

  if (
    bytes[12] !== 0x49
    || bytes[13] !== 0x48
    || bytes[14] !== 0x44
    || bytes[15] !== 0x52
  ) {
    fail();
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    fail();
  }

  return { width, height };
};

type ExportOnlySpotCenter = {
  arrayRow: number;
  arrayCol: number;
  pxl_row_in_fullres: number;
  pxl_col_in_fullres: number;
};

const getArrayPositionKey = (arrayRow: number, arrayCol: number) => `${arrayRow}:${arrayCol}`;

/** Quote-escape a CSV field when it contains a separator, quote, or newline. */
const csvEscape = (value: string | number) => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const isSupportedChipConfigId = (chipType: string | null): chipType is ChipConfigManifest['id'] => chipType === '50um' || chipType === '15um';

const resolveExportOnlyFullresLayout = async (args: {
  chipType: string | null;
  cropQc?: Pick<CropQcTransitionalGeometryContract, 'eosinReferenceGeometry' | 'heQcGeometry'> | null;
  exportFullresWidth: number;
  exportFullresHeight: number;
}) => {
  if (!isSupportedChipConfigId(args.chipType)) {
    throw new Error('Chip projection geometry or spot diameter metadata is missing. Reapply chip configuration before export.');
  }

  const { manifest, templateEntries } = await loadChipConfigData(args.chipType);

  return resolveSpotExportFullresLayout({
    templateEntries,
    chipManifest: manifest,
    cropQc: args.cropQc,
    exportFullresWidth: args.exportFullresWidth,
    exportFullresHeight: args.exportFullresHeight,
  });
};

type ExcludedGridCompression = {
  rows: number;
  columns: number;
  projectedSpots: ProjectedSpot[];
  matrixValues: number[];
  spotCenters: ExportOnlySpotCenter[];
  barcodesByPosition: Record<string, string>;
};

/**
 * Drop excluded rows AND columns from the exported grid when the Step 2
 * "Remove excluded rows/columns from export" toggle is on, matching the
 * compacted Step 2 preview (compactSpotGridForDisplay removes both). Excluded
 * rows keep their in-memory arrayRow (1-based, image top) and columns keep
 * arrayCol; the remaining grid is compacted to contiguous indices and every
 * row/column-keyed artifact (spots, matrix cells, template spot centers, CSV
 * barcodes) is remapped, so the exported CSVs renumber array_row from the
 * lower-left valid row and array_col from the leftmost valid column. Returns
 * null when nothing is actually dropped.
 */
const compressExcludedGrid = (args: {
  projectedSpots: ProjectedSpot[];
  matrixValues: number[];
  spotCenters: ExportOnlySpotCenter[];
  barcodesByPosition: Record<string, string>;
  rows: number;
  columns: number;
  excludedRows: number[];
  excludedColumns: number[];
}): ExcludedGridCompression | null => {
  const excludedRows = new Set(args.excludedRows);
  const excludedColumns = new Set(args.excludedColumns);
  if (excludedRows.size === 0 && excludedColumns.size === 0) {
    return null;
  }

  const rowRemap = new Map<number, number>();
  let nextRow = 0;
  for (let arrayRow = 1; arrayRow <= args.rows; arrayRow += 1) {
    if (excludedRows.has(arrayRow)) continue;
    nextRow += 1;
    rowRemap.set(arrayRow, nextRow);
  }

  const colRemap = new Map<number, number>();
  let nextCol = 0;
  for (let arrayCol = 1; arrayCol <= args.columns; arrayCol += 1) {
    if (excludedColumns.has(arrayCol)) continue;
    nextCol += 1;
    colRemap.set(arrayCol, nextCol);
  }

  if (nextRow === args.rows && nextCol === args.columns) {
    return null;
  }

  const projectedSpots: ProjectedSpot[] = [];
  for (const spot of args.projectedSpots) {
    const remappedRow = rowRemap.get(spot.arrayRow);
    const remappedCol = colRemap.get(spot.arrayCol);
    if (remappedRow === undefined || remappedCol === undefined) continue;
    projectedSpots.push({
      ...spot,
      arrayRow: remappedRow,
      arrayCol: remappedCol,
    });
  }

  const matrixValues: number[] = [];
  for (let arrayRow = 1; arrayRow <= args.rows; arrayRow += 1) {
    if (excludedRows.has(arrayRow)) continue;
    const rowStart = (arrayRow - 1) * args.columns;
    for (let arrayCol = 1; arrayCol <= args.columns; arrayCol += 1) {
      if (excludedColumns.has(arrayCol)) continue;
      matrixValues.push(args.matrixValues[rowStart + arrayCol - 1]);
    }
  }

  const spotCenters: ExportOnlySpotCenter[] = [];
  for (const spotCenter of args.spotCenters) {
    const remappedRow = rowRemap.get(spotCenter.arrayRow);
    const remappedCol = colRemap.get(spotCenter.arrayCol);
    if (remappedRow === undefined || remappedCol === undefined) continue;
    spotCenters.push({
      ...spotCenter,
      arrayRow: remappedRow,
      arrayCol: remappedCol,
    });
  }

  const barcodesByPosition: Record<string, string> = {};
  for (const [position, barcode] of Object.entries(args.barcodesByPosition)) {
    const separatorIndex = position.indexOf(':');
    if (separatorIndex === -1) continue;
    const arrayRow = Number(position.slice(0, separatorIndex));
    const arrayCol = Number(position.slice(separatorIndex + 1));
    const remappedRow = rowRemap.get(arrayRow);
    const remappedCol = colRemap.get(arrayCol);
    if (remappedRow === undefined || remappedCol === undefined) continue;
    barcodesByPosition[`${remappedRow}:${remappedCol}`] = barcode;
  }

  return {
    rows: nextRow,
    columns: nextCol,
    projectedSpots,
    matrixValues,
    spotCenters,
    barcodesByPosition,
  };
};

const toCsv = (
  projectedSpots: ProjectedSpot[],
  selectedSpotIds: Set<string>,
  exportOnlySpotCenters: ExportOnlySpotCenter[],
  rows: number,
  barcodesByPosition: Record<string, string>,
) => {
  const lines = [
    'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
  ];
  const exportOnlySpotCentersByArrayPosition = new Map(
    exportOnlySpotCenters.map((spotCenter) => [
      getArrayPositionKey(spotCenter.arrayRow, spotCenter.arrayCol),
      spotCenter,
    ] as const),
  );

  const rowsByArrayPosition = projectedSpots.map((spot) => {
    const coordinates = exportOnlySpotCentersByArrayPosition.get(getArrayPositionKey(spot.arrayRow, spot.arrayCol));
    if (!coordinates) {
      throw new Error(`Chip template anchor geometry is missing for array position ${spot.arrayRow}:${spot.arrayCol}. Reapply chip configuration before export.`);
    }

    // CSV keeps bottom-left array_row while pxl_* stays in top-left image space.
    const serializedArrayRow = rows + 1 - spot.arrayRow;

    // Barcodes captured from the tissue activation CSV (keyed by in-memory
    // image-top array position) replace the template placeholders; positions
    // absent from the CSV keep the placeholder barcode.
    const csvBarcode = barcodesByPosition[`${spot.arrayRow}:${spot.arrayCol}`];

    return {
      barcode: csvBarcode ?? spot.barcode,
      inTissue: selectedSpotIds.has(spot.id) ? '1' : '0',
      arrayRow: serializedArrayRow,
      arrayCol: spot.arrayCol,
      pxlRowInFullres: coordinates.pxl_row_in_fullres,
      pxlColInFullres: coordinates.pxl_col_in_fullres,
    };
  }).sort((left, right) => left.arrayRow - right.arrayRow || left.arrayCol - right.arrayCol);

  for (const row of rowsByArrayPosition) {
    lines.push([
      csvEscape(row.barcode),
      row.inTissue,
      String(row.arrayRow),
      String(row.arrayCol),
      String(row.pxlRowInFullres),
      String(row.pxlColInFullres),
    ].join(','));
  }

  return `${lines.join('\n')}\n`;
};

const toMatrixCsv = (matrixValues: number[], rows: number, columns: number) => {
  // tissue_positions.csv numbers array_row bottom-up (row 1 = lower-left), so
  // the matrix file must traverse rows in the same physical direction:
  // in-memory order is top-first, hence the bottom-first emit below. Writing
  // both files top-down (or both bottom-up) keeps row i of the matrix paired
  // with array_row i of the positions file.
  const lines = Array.from({ length: rows }, (_, rowIndex) => {
    const sourceRowIndex = rows - 1 - rowIndex;
    const rowStart = sourceRowIndex * columns;
    return matrixValues.slice(rowStart, rowStart + columns).join(',');
  });

  return `${lines.join('\n')}\n`;
};

export function getPreprocessZipExportReadiness(
  project: PreprocessProject,
  options?: { includeAlignedImage?: boolean },
): PreprocessExportReadiness {
  if (project.cropQc.status !== 'complete' || project.cropQc.isStale) {
    return {
      canExport: false,
      reason: 'Crop QC output is stale or incomplete. Regenerate and accept crop QC before export.',
    };
  }

  const cropWidth = project.cropQc.cropWidth;
  const cropHeight = project.cropQc.cropHeight;
  if (typeof cropWidth !== 'number' || cropWidth <= 0 || typeof cropHeight !== 'number' || cropHeight <= 0) {
    return {
      canExport: false,
      reason: 'Crop dimensions are missing. Regenerate crop QC before export.',
    };
  }

  const cropAssets = project.cropQc.cropAssets;
  const heFullres = cropAssets?.he?.fullres?.dataUrl;
  const heHires = cropAssets?.he?.hires?.dataUrl;
  const heLowres = cropAssets?.he?.lowres?.dataUrl;
  if (!heFullres || !heHires || !heLowres) {
    return {
      canExport: false,
      reason: 'Registered H&E crop assets are missing. Regenerate crop QC before export.',
    };
  }

  const alignedImageDataUrl = project.cropQc.checkerboardPreview?.dataUrl ?? project.cropQc.checkerboardPreviewDataUrl;
  if (options?.includeAlignedImage && !alignedImageDataUrl) {
    return {
      canExport: false,
      reason: 'Registered H&E image export requires checkerboard crop QC data.',
    };
  }

  const tissueHiresScale = project.cropQc.tissue_hires_scalef;
  const tissueLowresScale = project.cropQc.tissue_lowres_scalef;
  if (
    typeof tissueHiresScale !== 'number'
    || !Number.isFinite(tissueHiresScale)
    || tissueHiresScale <= 0
    || typeof tissueLowresScale !== 'number'
    || !Number.isFinite(tissueLowresScale)
    || tissueLowresScale <= 0
  ) {
    return {
      canExport: false,
      reason: 'Scale metadata is missing. Regenerate crop QC before export.',
    };
  }

  if (project.chipConfig.status !== 'complete' || project.chipConfig.isStale) {
    return {
      canExport: false,
      reason: 'Spot projection is stale or incomplete. Reapply the capture pitch before export.',
    };
  }

  const projectedSpots = project.chipConfig.projectedSpots;
  const rows = project.chipConfig.rows;
  const columns = project.chipConfig.columns;
  const spotDiameterFullres = resolveAuthoritativeSpotDiameterFullres({
    persistedSpotDiameterFullres: project.cropQc.spot_diameter_fullres,
    projectedSpots,
    cropWidth,
    cropHeight,
  });
  if (
    !projectedSpots
    || projectedSpots.length === 0
    || typeof rows !== 'number'
    || rows <= 0
    || typeof columns !== 'number'
    || columns <= 0
    || typeof spotDiameterFullres !== 'number'
    || !Number.isFinite(spotDiameterFullres)
    || spotDiameterFullres <= 0
  ) {
    return {
      canExport: false,
      reason: 'Chip projection geometry or spot diameter metadata is missing. Reapply chip configuration before export.',
    };
  }

  if (project.tissueSelection.status !== 'complete' || project.tissueSelection.isStale) {
    return {
      canExport: false,
      reason: 'Tissue selection is stale or incomplete. Re-run tissue detection or finish tissue edits before export.',
    };
  }

  const support = resolveTissueSelectionSupport({
    chipType: project.chipConfig.chipType,
    rows,
    columns,
  });
  if (project.tissueSelection.supportState === 'unsupported' || support.supportState === 'unsupported') {
    return {
      canExport: false,
      reason: project.tissueSelection.unsupportedReason ?? support.unsupportedReason ?? 'Tissue export requires a supported chip configuration.',
    };
  }

  const matrix = project.tissueSelection.matrix;
  if (!matrix) {
    return {
      canExport: false,
      reason: 'Tissue matrix data is missing. Re-run tissue detection before export.',
    };
  }

  let validatedMatrix: TissueActivationMatrix;
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

  // The exclusion lock is applied here, at the export boundary, not on the
  // persisted selection: excluded cells export as in_tissue=0 (or are dropped
  // entirely by the compression toggle below), while the stored selection
  // stays intact so un-excluding a row/column restores it.
  const lockedMatrix = applyExclusionLockToMatrix(validatedMatrix, {
    excludedRows: project.chipConfig.excludedRows,
    excludedColumns: project.chipConfig.excludedColumns,
  });
  const resolvedSelectedSpotIds = selectedSpotIdsFromMatrix(lockedMatrix, projectedSpots);

  return {
    canExport: true,
    data: {
      cropWidth,
      cropHeight,
      heCropAssets: {
        fullres: { dataUrl: heFullres },
        hires: { dataUrl: heHires },
        lowres: { dataUrl: heLowres },
      },
      projectedSpots,
      rows,
      columns,
      matrixValues: lockedMatrix.values,
      selectedSpotIds: new Set(resolvedSelectedSpotIds),
      barcodesByPosition: project.chipConfig.barcodesByPosition ?? {},
      spotDiameterFullres,
      tissueHiresScale,
      tissueLowresScale,
      alignedImageDataUrl,
    },
  };
}

export async function exportPreprocessZip(args: {
  project: PreprocessProject;
  includeProjectJson: boolean;
  includeAlignedImage: boolean;
}) {
  const { project, includeProjectJson, includeAlignedImage } = args;
  const readiness = getPreprocessZipExportReadiness(project, { includeAlignedImage });
  if (!readiness.canExport) {
    throw new Error(readiness.reason);
  }

  const {
    heCropAssets,
    projectedSpots,
    rows,
    columns,
    matrixValues,
    selectedSpotIds,
    barcodesByPosition,
    tissueHiresScale,
    tissueLowresScale,
    alignedImageDataUrl,
  } = readiness.data;
  const heFullresBytes = await imageSourceToBytes(heCropAssets.fullres.dataUrl);
  const { width: exportFullresWidth, height: exportFullresHeight } = getPngDimensionsFromBytes(heFullresBytes);
  const exportOnlyLayout = await resolveExportOnlyFullresLayout({
    chipType: project.chipConfig.chipType,
    cropQc: project.cropQc,
    exportFullresWidth,
    exportFullresHeight,
  });
  const spotDiameterFullres = exportOnlyLayout.squareSideLength;

  // Step 2 "Remove excluded rows/columns from export" toggle: drop excluded
  // rows AND columns from the exported grid entirely, compact the remaining
  // grid, and renumber the lower-left origin (array_row = 1 at the bottom-most
  // valid row, array_col = 1 at the leftmost valid column).
  const excludedGridCompression =
    project.chipConfig.removeExcludedRowsFromExport
      ? compressExcludedGrid({
          projectedSpots,
          matrixValues,
          spotCenters: exportOnlyLayout.spotCenters,
          barcodesByPosition,
          rows,
          columns,
          excludedRows: project.chipConfig.excludedRows,
          excludedColumns: project.chipConfig.excludedColumns,
        })
      : null;
  const exportRows = excludedGridCompression?.rows ?? rows;
  const exportColumns = excludedGridCompression?.columns ?? columns;
  const exportProjectedSpots =
    excludedGridCompression?.projectedSpots ?? projectedSpots;
  const exportMatrixValues =
    excludedGridCompression?.matrixValues ?? matrixValues;
  const exportSpotCenters =
    excludedGridCompression?.spotCenters ?? exportOnlyLayout.spotCenters;
  const exportBarcodesByPosition =
    excludedGridCompression?.barcodesByPosition ?? barcodesByPosition;

  const scalefactors = {
    spot_diameter_fullres: spotDiameterFullres,
    fiducial_diameter_fullres: FIDUCIAL_DIAMETER_FULLRES,
    tissue_hires_scalef: tissueHiresScale,
    tissue_lowres_scalef: tissueLowresScale,
  };

  const zip = new JSZip();
  zip.file('tissue_fullres_image.png', heFullresBytes);
  zip.file('tissue_hires_image.png', await imageSourceToBytes(heCropAssets.hires.dataUrl));
  zip.file('tissue_lowres_image.png', await imageSourceToBytes(heCropAssets.lowres.dataUrl));
  zip.file('scalefactors_json.json', JSON.stringify(scalefactors, null, 2));
  zip.file('tissue_positions.csv', toCsv(
    exportProjectedSpots,
    selectedSpotIds,
    exportSpotCenters,
    exportRows,
    exportBarcodesByPosition,
  ));
  zip.file('tissue_matrix.csv', toMatrixCsv(exportMatrixValues, exportRows, exportColumns));

  if (includeAlignedImage) {
    if (!alignedImageDataUrl) {
      throw new Error('Registered H&E image export requires checkerboard crop QC data.');
    }
    zip.file('aligned_tissue_image.png', await imageSourceToBytes(alignedImageDataUrl));
  }

  if (includeProjectJson) {
    const projectBlob = await serializePreprocessProject(project);
    const projectText = await projectBlob.text();
    zip.file('project.json', projectText);
    const sourceEntries = await getPreprocessPackageSourceEntries(project);
    for (const entry of sourceEntries) {
      zip.file(entry.path, entry.blob);
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    fileName: `${project.name || 'preprocess-project'}-preprocess.zip`,
    blob,
  };
}
