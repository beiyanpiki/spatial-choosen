import type { TissueSpotStyle } from '@/types/preprocess';

export const DEFAULT_TISSUE_SPOT_STYLE: TissueSpotStyle = {
  color: '#38A169',
  opacity: 0.8,
};

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const normalizeTissueSpotStyle = (value: unknown): TissueSpotStyle => {
  const style = (value ?? {}) as Partial<TissueSpotStyle>;
  return {
    color:
      typeof style.color === 'string' && HEX_COLOR_PATTERN.test(style.color)
        ? style.color
        : DEFAULT_TISSUE_SPOT_STYLE.color,
    opacity:
      typeof style.opacity === 'number' && Number.isFinite(style.opacity)
        ? Math.min(1, Math.max(0, style.opacity))
        : DEFAULT_TISSUE_SPOT_STYLE.opacity,
  };
};
