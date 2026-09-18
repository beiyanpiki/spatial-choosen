import type {
  BatchImageSize,
  BatchMatrixConvention,
  BatchMatrixLayout,
  BatchPackage,
  BatchRegion,
  BatchSelectionResult,
  BatchSelectionSettings,
  BatchSimilarityParams,
  BatchSpot,
} from '@/types/batch';

import { DEFAULT_MATRIX_CONVENTION, formatMatrixCsv, resolvePackageMatrix } from './affine';
import type { BatchPackageExportInput } from './exportPackages';
import { writePositionsWithSelection } from './positions';
import { regionsToPixelSpace } from './regions';
import { selectBarcodes } from './selection';

export type ComputeSelectionArgs = {
  spots: readonly BatchSpot[];
  /** Regions in the package's own normalized (0..1) frame. */
  regions: readonly BatchRegion[];
  size: BatchImageSize;
  settings: BatchSelectionSettings;
  spotDiameterFullres: number | null;
};

export function computeSelection({
  spots,
  regions,
  size,
  settings,
  spotDiameterFullres,
}: ComputeSelectionArgs): BatchSelectionResult {
  const selectedBarcodes = selectBarcodes({
    spots,
    regions: regionsToPixelSpace(regions, size),
    anchorMode: settings.anchorMode,
    hitMode: settings.hitMode,
    spotDiameterFullres,
  });

  return {
    selectedBarcodes,
    selectedBarcodeSet: new Set(selectedBarcodes),
    totalSpots: spots.length,
  };
}

export function buildTransformMatrixCsv(args: {
  params: BatchSimilarityParams;
  packageSize: BatchImageSize;
  referenceSize: BatchImageSize;
  layout: BatchMatrixLayout;
  convention?: BatchMatrixConvention;
}): string {
  const matrix = resolvePackageMatrix({
    convention: args.convention ?? DEFAULT_MATRIX_CONVENTION,
    params: args.params,
    sourceSize: args.packageSize,
    referenceSize: args.referenceSize,
  });
  return formatMatrixCsv(matrix, args.layout === '3x3' ? '3x3' : '2x3');
}

export type BuildExportInputsArgs = {
  packages: readonly BatchPackage[];
  referencePackageId: string | null;
  alignments: Record<string, BatchSimilarityParams>;
  selectionByPackage: Record<string, BatchSelectionResult>;
  matrixLayout: BatchMatrixLayout;
  matrixConvention: BatchMatrixConvention;
};

export function buildExportInputs({
  packages,
  referencePackageId,
  alignments,
  selectionByPackage,
  matrixLayout,
  matrixConvention,
}: BuildExportInputsArgs): BatchPackageExportInput[] {
  const referencePackage = packages.find((entry) => entry.id === referencePackageId) ?? packages[0];
  const referenceSize = referencePackage?.fullresSize ?? null;

  return packages.map((entry) => {
    const selection = selectionByPackage[entry.id];
    const positionsCsv = entry.positions
      ? writePositionsWithSelection(entry.positions, selection?.selectedBarcodeSet ?? new Set<string>())
      : '';
    const matrixCsv = referenceSize && entry.fullresSize
      ? buildTransformMatrixCsv({
          params: alignments[entry.id] ?? {
            rotationDegrees: 0,
            scale: 1,
            flipHorizontal: false,
            flipVertical: false,
            offsetX: 0,
            offsetY: 0,
          },
          packageSize: entry.fullresSize,
          referenceSize,
          layout: matrixLayout,
          convention: matrixConvention,
        })
      : '';

    return {
      packageName: entry.name,
      files: entry.files,
      positionsFileName: entry.positionsFileName ?? 'spatial/tissue_positions.csv',
      positionsCsv,
      transformMatrixCsv: matrixCsv,
    };
  });
}
