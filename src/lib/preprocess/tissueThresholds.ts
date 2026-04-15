import type { TissueThresholdMode } from '@/types/preprocess';

export type { TissueThresholdMode };

export type TissueParams = {
  thresholdMode: TissueThresholdMode;
  activationThreshold: number;
  blockThreshold: number;
  dbscanEps: number;
  dbscanMinSamples: number;
  minConnectedSpotCount: number;
};

export const DEFAULT_TISSUE_PARAMS: TissueParams = {
  thresholdMode: 'raw',
  activationThreshold: 0.1,
  blockThreshold: 135,
  dbscanEps: 0.03,
  dbscanMinSamples: 3,
  minConnectedSpotCount: 8,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeThresholdMode = (value: TissueThresholdMode | undefined): TissueThresholdMode => (
  value === 'gray-max' || value === 'gray-min' || value === 'raw'
    ? value
    : DEFAULT_TISSUE_PARAMS.thresholdMode
);

export const normalizeTissueParams = (value: Partial<TissueParams>): TissueParams => ({
  thresholdMode: normalizeThresholdMode(value.thresholdMode),
  activationThreshold: clamp(
    (value.activationThreshold ?? DEFAULT_TISSUE_PARAMS.activationThreshold) > 1
      ? (value.activationThreshold ?? DEFAULT_TISSUE_PARAMS.activationThreshold) / 255
      : (value.activationThreshold ?? DEFAULT_TISSUE_PARAMS.activationThreshold),
    0,
    1,
  ),
  blockThreshold: clamp(Math.round(value.blockThreshold ?? DEFAULT_TISSUE_PARAMS.blockThreshold), 0, 255),
  dbscanEps: clamp(value.dbscanEps ?? DEFAULT_TISSUE_PARAMS.dbscanEps, 0.005, 0.2),
  dbscanMinSamples: clamp(Math.round(value.dbscanMinSamples ?? DEFAULT_TISSUE_PARAMS.dbscanMinSamples), 1, 20),
  minConnectedSpotCount: clamp(Math.round(value.minConnectedSpotCount ?? DEFAULT_TISSUE_PARAMS.minConnectedSpotCount), 1, 200),
});
