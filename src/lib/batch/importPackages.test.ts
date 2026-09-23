import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import {
  buildBatchPackage,
  groupSourceFiles,
  normalizeSourcePath,
  readBatchSourceFiles,
  resolvePackageRoot,
  type BatchSelectedFile,
} from './importPackages';

// The preview derivative needs a browser decoder; resume parsing does not.
vi.mock('./imagePreview', () => ({
  readImageSize: async () => ({ width: 6005, height: 6005 }),
  createPreviewDerivative: async () => ({
    blob: new Blob(['preview']),
    size: { width: 800, height: 800 },
  }),
}));

/** Minimal PNG containing only the header `readImageSize` inspects. */
const pngHeaderBytes = () => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 6005);
  view.setUint32(20, 6005);
  return bytes;
};

const file = (path: string, content = 'x', type = 'text/plain'): BatchSelectedFile => ({
  path: normalizeSourcePath(path),
  name: path.split('/').pop() ?? path,
  blob: new Blob([content], { type }),
});

const packageFiles = (prefix: string) => [
  file(`${prefix}spatial/tissue_fullres_image.png`, 'png', 'image/png'),
  file(`${prefix}spatial/tissue_positions.csv`, 'barcode,pxl_row_in_fullres,pxl_col_in_fullres\n'),
  file(`${prefix}spatial/scalefactors_json.json`, '{}'),
  file(`${prefix}spatial/tissue_matrix.csv`, '0,0\n'),
];

describe('resolvePackageRoot', () => {
  it('returns everything above the spatial segment', () => {
    expect(resolvePackageRoot('250926-SPA-GW1/spatial/tissue_positions.csv')).toBe('250926-SPA-GW1');
    expect(resolvePackageRoot('batch/250926-SPA-GW1/spatial/tissue_positions.csv')).toBe('batch/250926-SPA-GW1');
  });

  it('falls back to the containing folder without a spatial segment', () => {
    expect(resolvePackageRoot('flat/tissue_positions.csv')).toBe('flat');
  });
});

describe('groupSourceFiles', () => {
  it('groups sibling sample folders into separate packages', () => {
    const groups = groupSourceFiles([
      ...packageFiles('250926-SPA-GW1/'),
      ...packageFiles('250926-SPA-GW3/'),
    ]);

    expect(groups.map((group) => group.name)).toEqual(['250926-SPA-GW1', '250926-SPA-GW3']);
    expect(groups[0].files.map((entry) => entry.relativePath)).toEqual([
      'spatial/tissue_fullres_image.png',
      'spatial/tissue_positions.csv',
      'spatial/scalefactors_json.json',
      'spatial/tissue_matrix.csv',
    ]);
  });

  it('ignores the parent folder the user selected', () => {
    const groups = groupSourceFiles(packageFiles('睾丸空转/250926-SPA-GW1/'));

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('250926-SPA-GW1');
    expect(groups[0].files[0].relativePath).toBe('spatial/tissue_fullres_image.png');
  });

  it('handles a flat spatial folder without a sample prefix', () => {
    const groups = groupSourceFiles(packageFiles(''));

    expect(groups).toHaveLength(1);
    expect(groups[0].rootPath).toBe('');
    expect(groups[0].files).toHaveLength(4);
  });

  it('ignores folders that are not NATA packages', () => {
    const groups = groupSourceFiles([
      file('notes/readme.txt'),
      ...packageFiles('250926-SPA-GW1/'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].files.every((entry) => entry.relativePath.startsWith('spatial/'))).toBe(true);
  });

  it('disambiguates packages that share a folder name', () => {
    const groups = groupSourceFiles([
      ...packageFiles('run-a/sample/'),
      ...packageFiles('run-b/sample/'),
    ]);

    expect(groups.map((group) => group.name)).toEqual(['sample', 'sample-2']);
  });
});

describe('readBatchSourceFiles', () => {
  it('expands zip archives in place of the loose files', async () => {
    const zip = new JSZip();
    zip.file('250926-SPA-GW1/spatial/tissue_fullres_image.png', 'png');
    zip.file('250926-SPA-GW1/spatial/tissue_positions.csv', 'barcode\nAAA\n');
    const archive = await zip.generateAsync({ type: 'arraybuffer' });

    const { files, archives } = await readBatchSourceFiles([
      { path: 'packages.zip', name: 'packages.zip', blob: new Blob([archive]) },
    ]);

    expect(archives).toEqual(['packages.zip']);
    expect(files.map((entry) => entry.path).sort()).toEqual([
      '250926-SPA-GW1/spatial/tissue_fullres_image.png',
      '250926-SPA-GW1/spatial/tissue_positions.csv',
    ]);

    const groups = groupSourceFiles(files);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('250926-SPA-GW1');
  });

  it('keeps folder selections as-is', async () => {
    const { files, archives } = await readBatchSourceFiles(packageFiles('250926-SPA-GW1/'));

    expect(archives).toEqual([]);
    expect(files).toHaveLength(4);
  });
});

describe('resuming a step 5 export', () => {
  const exportArchive = async () => {
    const zip = new JSZip();
    zip.file('spatial/tissue_fullres_image.png', pngHeaderBytes());
    zip.file('spatial/scalefactors_json.json', JSON.stringify({ spot_diameter_fullres: 20 }));
    zip.file('spatial/tissue_positions.csv', [
      'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres,in_selected',
      'AAA,1,1,1,100,100,0',
      'BBB,1,1,2,140,100,1',
      '',
    ].join('\n'));
    // The own-size frame matrix written by step 5 for a 2x zoom.
    zip.file('spatial/transform-matrix.csv', '2,0,-3002.5\n0,2,-3002.5\n');

    return zip.generateAsync({ type: 'arraybuffer' });
  };

  it('names the package after the archive and restores alignment plus selection', async () => {
    const archive = await exportArchive();
    const { files } = await readBatchSourceFiles([
      { path: '250926-SPA-GW1-batch.zip', name: '250926-SPA-GW1-batch.zip', blob: new Blob([archive]) },
    ]);
    const groups = groupSourceFiles(files);

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('250926-SPA-GW1');
    expect(groups[0].files.map((entry) => entry.relativePath)).toContain('spatial/tissue_positions.csv');

    const pkg = await buildBatchPackage(groups[0], 'pkg-1');

    expect(pkg.status).toBe('ready');
    expect(pkg.resume?.selectedBarcodes).toEqual(['BBB']);
    expect(pkg.resume?.alignment?.scale).toBeCloseTo(2, 8);
    expect(pkg.resume?.alignment?.rotationDegrees).toBeCloseTo(0, 8);
  });

  it('leaves a plain package untouched', async () => {
    const { files } = await readBatchSourceFiles([
      file('250926-SPA-GW1/spatial/tissue_fullres_image.png'),
      file('250926-SPA-GW1/spatial/tissue_positions.csv', [
        'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
        'AAA,1,1,1,100,100',
        '',
      ].join('\n')),
    ]);
    const pkg = await buildBatchPackage(groupSourceFiles(files)[0], 'pkg-2');

    expect(pkg.resume).toBeNull();
  });

  it('reads the region class of a newer export', async () => {
    const zip = new JSZip();
    zip.file('spatial/tissue_fullres_image.png', pngHeaderBytes());
    zip.file('spatial/scalefactors_json.json', JSON.stringify({ spot_diameter_fullres: 20 }));
    zip.file('spatial/tissue_positions.csv', [
      'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres,in_selected,selected_class,selected_color',
      'AAA,1,1,1,100,100,1,2,#3182CE',
      'BBB,1,1,2,140,100,1,3,#38A169',
      'CCC,1,1,3,180,100,0,0,',
      '',
    ].join('\n'));
    const archive = await zip.generateAsync({ type: 'arraybuffer' });

    const { files } = await readBatchSourceFiles([
      { path: '250926-SPA-GW1-batch.zip', name: '250926-SPA-GW1-batch.zip', blob: new Blob([archive]) },
    ]);
    const pkg = await buildBatchPackage(groupSourceFiles(files)[0], 'pkg-3');

    expect(pkg.resume?.selectedBarcodes).toEqual(['AAA', 'BBB']);
    expect([...(pkg.resume?.classByBarcode ?? new Map())]).toEqual([['AAA', 2], ['BBB', 3]]);
    expect([...(pkg.resume?.colorByClass ?? new Map())]).toEqual([[2, '#3182CE'], [3, '#38A169']]);
  });
});
