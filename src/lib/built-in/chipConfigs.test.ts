import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadChipConfigData,
  parseChipConfigManifestJson,
  parseChipTemplateCsv,
} from './chipConfigs';

const fiftyUmDirectory = path.resolve(process.cwd(), 'public/built-in-chip-configs/50um');
const fifteenUmDirectory = path.resolve(process.cwd(), 'public/built-in-chip-configs/15um');
const manifestText = readFileSync(path.join(fiftyUmDirectory, 'manifest.json'), 'utf8');
const tissuePositionsCsv = readFileSync(path.join(fiftyUmDirectory, 'tissue_positions.csv'), 'utf8');
const fifteenUmManifestText = readFileSync(path.join(fifteenUmDirectory, 'manifest.json'), 'utf8');
const fifteenUmTissuePositionsCsv = readFileSync(path.join(fifteenUmDirectory, 'tissue_positions.csv'), 'utf8');

const parseTissuePositions = () => tissuePositionsCsv
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => {
    const [barcode, _inTissue, arrayRow, arrayCol, pxlRow, pxlCol] = line.split(',');

    return {
      barcode,
      arrayRow: Number(arrayRow),
      arrayCol: Number(arrayCol),
      pxlRow: Number(pxlRow),
      pxlCol: Number(pxlCol),
    };
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chip config helpers', () => {
  it('resolves the 50um manifest as a 64x64 preprocess grid', () => {
    const manifest = parseChipConfigManifestJson(manifestText);

    expect(manifest.gridRows).toBe(64);
    expect(manifest.gridCols).toBe(64);
  });

  it('parses 4096 50um template entries after the header', () => {
    const manifest = parseChipConfigManifestJson(manifestText);
    const templateEntries = parseChipTemplateCsv(manifest, tissuePositionsCsv);

    expect(templateEntries).toHaveLength(4096);
  });

  it('publishes coherent full-resolution grid coordinates for the 50um asset', () => {
    const entries = parseTissuePositions();

    expect(entries).toHaveLength(4096);
    expect(entries[0]).toMatchObject({
      barcode: '50um-001-001',
      arrayRow: 1,
      arrayCol: 1,
      pxlRow: 75,
      pxlCol: 75,
    });
    expect(entries[1]).toMatchObject({
      barcode: '50um-001-002',
      arrayRow: 1,
      arrayCol: 2,
      pxlRow: 75,
      pxlCol: 175,
    });
    expect(entries[64]).toMatchObject({
      barcode: '50um-002-001',
      arrayRow: 2,
      arrayCol: 1,
      pxlRow: 175,
      pxlCol: 75,
    });
    expect(entries.at(-1)).toMatchObject({
      barcode: '50um-064-064',
      arrayRow: 64,
      arrayCol: 64,
      pxlRow: 6375,
      pxlCol: 6375,
    });
  });

  it('rejects out-of-range template entries against the 64x64 bounds', () => {
    const manifest = parseChipConfigManifestJson(manifestText);

    expect(() => parseChipTemplateCsv(
      manifest,
      [
        'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
        '50um-065-001,1,65,1,0,0',
      ].join('\n'),
    )).toThrow(/out of range/i);
  });

  it('rejects header-only templates instead of synthesizing a full grid', () => {
    const manifest = parseChipConfigManifestJson(manifestText);

    expect(() => parseChipTemplateCsv(
      manifest,
      'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres\n',
    )).toThrow(/no template entries/i);
  });

  it('loads template entries from barcodeTemplatePath in the manifest', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input === '/built-in-chip-configs/50um/manifest.json') {
        return new Response(JSON.stringify({
          ...parseChipConfigManifestJson(manifestText),
          barcodeTemplatePath: '/custom-template.csv',
          tissuePositionsPath: '/legacy-tissue-positions.csv',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (input === '/custom-template.csv') {
        return new Response([
          'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
          '50um-001-001,1,1,1,0,0',
        ].join('\n'), { status: 200 });
      }

      if (input === '/legacy-tissue-positions.csv') {
        return new Response([
          'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
          '50um-002-002,1,2,2,0,0',
        ].join('\n'), { status: 200 });
      }

      return new Response(null, { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await loadChipConfigData('50um');

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/custom-template.csv');
    expect(result.templateEntries).toEqual([
      {
        barcode: '50um-001-001',
        arrayRow: 1,
        arrayCol: 1,
        pxl_row_in_fullres: 0,
        pxl_col_in_fullres: 0,
      },
    ]);
  });

  it('parses the checked-in 15um template asset as a full 96x96 grid', () => {
    const manifest = parseChipConfigManifestJson(fifteenUmManifestText);
    const templateEntries = parseChipTemplateCsv(manifest, fifteenUmTissuePositionsCsv);

    expect(templateEntries).toHaveLength(96 * 96);
    expect(templateEntries[0]).toEqual({
      barcode: '15um-001-001',
      arrayRow: 1,
      arrayCol: 1,
      pxl_row_in_fullres: 33,
      pxl_col_in_fullres: 33,
    });
    expect(templateEntries[1]).toEqual({
      barcode: '15um-001-002',
      arrayRow: 1,
      arrayCol: 2,
      pxl_row_in_fullres: 33,
      pxl_col_in_fullres: 73,
    });
    expect(templateEntries[96]).toEqual({
      barcode: '15um-002-001',
      arrayRow: 2,
      arrayCol: 1,
      pxl_row_in_fullres: 73,
      pxl_col_in_fullres: 33,
    });
    expect(templateEntries.at(-1)).toEqual({
      barcode: '15um-096-096',
      arrayRow: 96,
      arrayCol: 96,
      pxl_row_in_fullres: 3833,
      pxl_col_in_fullres: 3833,
    });
  });
});
