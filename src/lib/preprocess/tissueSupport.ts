import type { TissueSelectionSupportState } from '@/types/preprocess';

type TissueSupportArgs = {
  chipType: string | null;
  rows: number | null;
  columns: number | null;
};

type TissueSelectionSupport = {
  supportState: TissueSelectionSupportState;
  unsupportedReason: string | null;
};

const SUPPORTED_TISSUE_GRIDS = {
  '15um': { rows: 96, columns: 96 },
  '50um': { rows: 64, columns: 64 },
} as const;

const formatRequiredGrid = (rows: number, columns: number) => `${rows}x${columns}`;

export function resolveTissueSelectionSupport(args: TissueSupportArgs): TissueSelectionSupport {
  if (!args.chipType) {
    return {
      supportState: 'unsupported',
      unsupportedReason: 'Tissue selection requires a supported chip type.',
    };
  }

  const supportedGrid = SUPPORTED_TISSUE_GRIDS[args.chipType as keyof typeof SUPPORTED_TISSUE_GRIDS];
  if (!supportedGrid) {
    return {
      supportState: 'unsupported',
      unsupportedReason: `Tissue selection does not support ${args.chipType} chips.`,
    };
  }

  if (args.rows !== supportedGrid.rows || args.columns !== supportedGrid.columns) {
    return {
      supportState: 'unsupported',
      unsupportedReason: `${args.chipType} tissue selection requires a ${formatRequiredGrid(supportedGrid.rows, supportedGrid.columns)} grid.`,
    };
  }

  return {
    supportState: 'supported',
    unsupportedReason: null,
  };
}
