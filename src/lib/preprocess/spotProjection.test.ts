import { describe, expect, it } from 'vitest';
import type { ChipConfigManifest, ChipTemplateEntry } from './chipConfigs';
import {
  projectSpotsForCrop,
  resolveAuthoritativeSpotDiameterFullres,
} from './spotProjection';

const chip: ChipConfigManifest = {
  id: '15um',
  label: 'Test chip',
  gridRows: 2,
  gridCols: 2,
  spotDiameter: 10,
  spotGap: 4,
  barcodeTemplatePath: '/unused/template.csv',
  tissuePositionsPath: '/unused/tissue.csv',
};

const templateEntries: ChipTemplateEntry[] = [
  { barcode: 'spot-a', arrayRow: 1, arrayCol: 1 },
  { barcode: 'spot-b', arrayRow: 1, arrayCol: 2 },
  { barcode: 'spot-c', arrayRow: 2, arrayCol: 1 },
  { barcode: 'spot-d', arrayRow: 2, arrayCol: 2 },
];

describe('spot projection canonical crop contract', () => {
  it('remains source-agnostic once downstream work is reduced to canonical crop dimensions', () => {
    const automaticAcceptedProjection = projectSpotsForCrop({
      chip,
      templateEntries,
      cropWidth: 400,
      cropHeight: 300,
    });

    const manualAcceptedProjection = projectSpotsForCrop({
      chip,
      templateEntries,
      cropWidth: 400,
      cropHeight: 300,
    });

    expect(automaticAcceptedProjection).toEqual(manualAcceptedProjection);
    expect(
      resolveAuthoritativeSpotDiameterFullres({
        projectedSpots: automaticAcceptedProjection,
        cropWidth: 400,
        cropHeight: 300,
      }),
    ).toBe(
      resolveAuthoritativeSpotDiameterFullres({
        projectedSpots: manualAcceptedProjection,
        cropWidth: 400,
        cropHeight: 300,
      }),
    );
  });
});
