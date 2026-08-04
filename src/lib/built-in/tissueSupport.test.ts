import { describe, expect, it } from 'vitest';

import { resolveTissueSelectionSupport } from './tissueSupport';

describe('resolveTissueSelectionSupport', () => {
  it('supports 15um 96x96 chips', () => {
    expect(resolveTissueSelectionSupport({ chipType: '15um', rows: 96, columns: 96 })).toEqual({
      supportState: 'supported',
      unsupportedReason: null,
    });
  });

  it('supports 50um 64x64 chips', () => {
    expect(resolveTissueSelectionSupport({ chipType: '50um', rows: 64, columns: 64 })).toEqual({
      supportState: 'supported',
      unsupportedReason: null,
    });
  });

  it('rejects 50um 50x50 chips as unsupported', () => {
    expect(resolveTissueSelectionSupport({ chipType: '50um', rows: 50, columns: 50 })).toEqual({
      supportState: 'unsupported',
      unsupportedReason: '50um tissue auto-selection requires a 64x64 spot grid.',
    });
  });

  it('rejects unknown chip types with a reason', () => {
    const result = resolveTissueSelectionSupport({ chipType: '25um', rows: 96, columns: 96 });

    expect(result.supportState).toBe('unsupported');
    expect(result.unsupportedReason).not.toBeNull();
  });
});
