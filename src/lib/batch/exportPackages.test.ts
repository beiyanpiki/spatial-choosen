import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import type { BatchPackageFile } from '@/types/batch';

import {
  buildBatchBundleZip,
  buildBatchPackageZip,
  buildPackageExportFileName,
  sanitizeFileName,
} from './exportPackages';

const FILES: BatchPackageFile[] = [
  { relativePath: 'spatial/tissue_fullres_image.png', name: 'tissue_fullres_image.png', blob: new Blob(['png-bytes']) },
  { relativePath: 'spatial/tissue_matrix.csv', name: 'tissue_matrix.csv', blob: new Blob(['0,0\n']) },
  { relativePath: 'spatial/tissue_positions.csv', name: 'tissue_positions.csv', blob: new Blob(['old,positions\n']) },
  { relativePath: 'spatial/transform-matrix.csv', name: 'transform-matrix.csv', blob: new Blob(['stale\n']) },
];

describe('sanitizeFileName', () => {
  it('strips characters that are invalid in download names', () => {
    expect(sanitizeFileName('a/b:c*d')).toBe('a-b-c-d');
    expect(sanitizeFileName('   ')).toBe('package');
  });
});

describe('buildPackageExportFileName', () => {
  it('suffixes the package name', () => {
    expect(buildPackageExportFileName('250926-SPA-GW1')).toBe('250926-SPA-GW1-batch.zip');
  });
});

describe('buildBatchPackageZip', () => {
  it('rewrites only tissue_positions.csv and adds transform-matrix.csv', async () => {
    const blob = await buildBatchPackageZip({
      packageName: '250926-SPA-GW1',
      files: FILES,
      positionsFileName: 'spatial/tissue_positions.csv',
      positionsCsv: 'barcode,in_selected\nAAA,1\n',
      transformMatrixCsv: '1,0,0\n0,1,0\n',
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();

    expect(names).toEqual([
      'spatial/tissue_fullres_image.png',
      'spatial/tissue_matrix.csv',
      'spatial/tissue_positions.csv',
      'spatial/transform-matrix.csv',
    ]);
    expect(await zip.file('spatial/tissue_matrix.csv')!.async('text')).toBe('0,0\n');
    expect(await zip.file('spatial/tissue_fullres_image.png')!.async('text')).toBe('png-bytes');
    expect(await zip.file('spatial/tissue_positions.csv')!.async('text')).toBe('barcode,in_selected\nAAA,1\n');
    expect(await zip.file('spatial/transform-matrix.csv')!.async('text')).toBe('1,0,0\n0,1,0\n');
  });

  it('places the matrix next to the positions file for flat layouts', async () => {
    const blob = await buildBatchPackageZip({
      packageName: 'flat',
      files: [
        { relativePath: 'tissue_fullres_image.png', name: 'tissue_fullres_image.png', blob: new Blob(['png']) },
        { relativePath: 'tissue_positions.csv', name: 'tissue_positions.csv', blob: new Blob(['old\n']) },
      ],
      positionsFileName: 'tissue_positions.csv',
      positionsCsv: 'barcode,in_selected\nAAA,1\n',
      transformMatrixCsv: '1,0,0\n0,1,0\n',
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    expect(Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort()).toEqual([
      'tissue_fullres_image.png',
      'tissue_positions.csv',
      'transform-matrix.csv',
    ]);
  });
});

describe('buildBatchBundleZip', () => {
  it('nests every package in its own folder', async () => {
    const input = {
      packageName: '250926-SPA-GW1',
      files: FILES,
      positionsFileName: 'spatial/tissue_positions.csv',
      positionsCsv: 'barcode,in_selected\nAAA,1\n',
      transformMatrixCsv: '1,0,0\n0,1,0\n',
    };

    const blob = await buildBatchBundleZip([input, { ...input, packageName: '250926-SPA-GW3' }]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();

    expect(names).toEqual([
      '250926-SPA-GW1/spatial/tissue_fullres_image.png',
      '250926-SPA-GW1/spatial/tissue_matrix.csv',
      '250926-SPA-GW1/spatial/tissue_positions.csv',
      '250926-SPA-GW1/spatial/transform-matrix.csv',
      '250926-SPA-GW3/spatial/tissue_fullres_image.png',
      '250926-SPA-GW3/spatial/tissue_matrix.csv',
      '250926-SPA-GW3/spatial/tissue_positions.csv',
      '250926-SPA-GW3/spatial/transform-matrix.csv',
    ]);
  });
});
