export type TissueThresholdMode = 'dark' | 'light';

export type TissueParams = {
  thresholdMode: TissueThresholdMode;
  activationThreshold: number;
  blockThreshold: number;
  dbscanEps: number;
  dbscanMinSamples: number;
  minConnectedSpotCount: number;
};

export const DEFAULT_TISSUE_PARAMS: TissueParams = {
  thresholdMode: 'light',
  activationThreshold: 140,
  blockThreshold: 180,
  dbscanEps: 0.03,
  dbscanMinSamples: 3,
  minConnectedSpotCount: 8,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const normalizeTissueParams = (value: Partial<TissueParams>): TissueParams => ({
  thresholdMode: value.thresholdMode === 'light' ? 'light' : 'dark',
  activationThreshold: clamp(Math.round(value.activationThreshold ?? DEFAULT_TISSUE_PARAMS.activationThreshold), 0, 255),
  blockThreshold: clamp(Math.round(value.blockThreshold ?? DEFAULT_TISSUE_PARAMS.blockThreshold), 0, 255),
  dbscanEps: clamp(value.dbscanEps ?? DEFAULT_TISSUE_PARAMS.dbscanEps, 0.005, 0.2),
  dbscanMinSamples: clamp(Math.round(value.dbscanMinSamples ?? DEFAULT_TISSUE_PARAMS.dbscanMinSamples), 1, 20),
  minConnectedSpotCount: clamp(Math.round(value.minConnectedSpotCount ?? DEFAULT_TISSUE_PARAMS.minConnectedSpotCount), 1, 200),
});
