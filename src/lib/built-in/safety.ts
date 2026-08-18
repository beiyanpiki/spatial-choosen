import { PREPROCESS_OVERSIZED_IMAGE_LIMITS } from './constants';

export type OversizedImageCheck = {
  ok: boolean;
  sizeBytes: number;
  reason: string | null;
};

export function checkSourceImageFileSize(sizeBytes: number): OversizedImageCheck {
  if (sizeBytes > PREPROCESS_OVERSIZED_IMAGE_LIMITS.hardBytes) {
    return {
      ok: false,
      sizeBytes,
      reason: `File size ${sizeBytes} bytes exceeds ${PREPROCESS_OVERSIZED_IMAGE_LIMITS.hardBytes} bytes limit`,
    };
  }

  return {
    ok: true,
    sizeBytes,
    reason: null,
  };
}
