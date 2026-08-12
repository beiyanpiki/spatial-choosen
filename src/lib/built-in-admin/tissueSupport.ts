import type { TissueSelectionSupportState } from '@/types/built-in-admin';

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
      unsupportedReason: 'Tissue auto-selection requires a supported capture chip.',
    };
  }

  const supportedGrid = SUPPORTED_TISSUE_GRIDS[args.chipType as keyof typeof SUPPORTED_TISSUE_GRIDS];
  if (!supportedGrid) {
    return {
      supportState: 'unsupported',
      unsupportedReason: `Tissue auto-selection does not support ${args.chipType} capture chips.`,
    };
  }

  if (args.rows === null || args.columns === null) {
    return {
      supportState: 'unsupported',
      unsupportedReason: 'Tissue auto-selection requires configured spot-grid dimensions.',
    };
  }

  if (args.rows !== supportedGrid.rows || args.columns !== supportedGrid.columns) {
    return {
      supportState: 'unsupported',
      unsupportedReason: `${args.chipType} tissue auto-selection requires a ${formatRequiredGrid(supportedGrid.rows, supportedGrid.columns)} spot grid.`,
    };
  }

  return {
    supportState: 'supported',
    unsupportedReason: null,
  };
}
