import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { exportPreprocessZip } from '@/lib/preprocess/exportBundle';
import type { PreprocessProject } from '@/types/preprocess';

const PREPROCESS_STORAGE_KEY = 'spatial-preprocess-projects';
const PREPROCESS_DB_NAME = 'spatial-preprocess';
const PREPROCESS_DERIVED_IMAGE_STORE = 'preprocess-derived-images';
const HE_FOCUS_STORE_KEY_SUFFIX = 'he-focus';
const HE_FOCUS_PACKAGE_PATH = 'derived-assets/he-focus';

type SeededProjectInfo = {
  preprocessId: string;
  projectName: string;
};

async function inspectStoredProjectState(
  page: import('@playwright/test').Page,
  preprocessId: string,
) {
  return page.evaluate(async ({
    preprocessDbName,
    preprocessDerivedImageStore,
    preprocessId,
    preprocessStorageKey,
    heFocusStoreKeySuffix,
  }) => {
    const raw = window.localStorage.getItem(preprocessStorageKey);
    const projects = raw ? JSON.parse(raw) as Array<Record<string, unknown>> : [];
    const meta = projects.find((project) => project.id === preprocessId) ?? null;

    const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(preprocessDbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const readStore = (db: IDBDatabase, store: string, keyName: string) => new Promise<string | Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(keyName);
      req.onsuccess = () => resolve(req.result as string | Blob | undefined);
      req.onerror = () => reject(req.error);
    });

    const db = await openDb();
    const hasDerivedStore = db.objectStoreNames.contains(preprocessDerivedImageStore);
    const derivedAsset = hasDerivedStore
      ? await readStore(db, preprocessDerivedImageStore, `${preprocessId}:${heFocusStoreKeySuffix}`)
      : undefined;
    const heFocus = meta && typeof meta.heFocus === 'object' && meta.heFocus !== null
      ? meta.heFocus as Record<string, unknown>
      : null;
    db.close();

    return {
      derivedAssetKind:
        derivedAsset instanceof Blob
          ? 'blob'
          : typeof derivedAsset === 'string'
            ? 'string'
            : null,
      derivedAssetSize:
        derivedAsset instanceof Blob
          ? derivedAsset.size
          : typeof derivedAsset === 'string'
            ? derivedAsset.length
            : 0,
      hasDerivedStore,
      metaExists: Boolean(meta),
      heFocusFocusedImageDataUrl: heFocus?.focusedImageDataUrl ?? null,
    };
  }, {
    preprocessDbName: PREPROCESS_DB_NAME,
    preprocessDerivedImageStore: PREPROCESS_DERIVED_IMAGE_STORE,
    preprocessId,
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
    heFocusStoreKeySuffix: HE_FOCUS_STORE_KEY_SUFFIX,
  });
}

async function downloadExportOrThrow(
  page: import('@playwright/test').Page,
  preprocessId: string,
) {
  const downloadPromise = page.waitForEvent('download').then((download) => ({
    kind: 'download' as const,
    download,
  }));
  const exportErrorPromise = page.waitForFunction(
    ({ preprocessId, preprocessStorageKey }) => {
      const raw = window.localStorage.getItem(preprocessStorageKey);
      if (!raw) return false;

      const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
      const project = projects.find((entry) => entry.id === preprocessId);
      if (!project || typeof project.exportState !== 'object' || project.exportState === null) {
        return false;
      }

      const exportState = project.exportState as Record<string, unknown>;
      if (exportState.status !== 'error') {
        return false;
      }

      return typeof exportState.error === 'string' && exportState.error.length > 0
        ? exportState.error
        : 'Export failed';
    },
    {
      preprocessId,
      preprocessStorageKey: PREPROCESS_STORAGE_KEY,
    },
    {
      timeout: 15_000,
    },
  ).then(async (handle) => ({
    kind: 'error' as const,
    message: await handle.jsonValue<string>(),
  }));

  await page.getByTestId('export-download-zip').click();
  const result = await Promise.race([downloadPromise, exportErrorPromise]);

  if (result.kind === 'error') {
    throw new Error(result.message);
  }

  return result.download;
}

async function seedProjectToExportReady(
  page: import('@playwright/test').Page,
  storageMode: 'legacy-data-url' | 'blob-backed' = 'legacy-data-url',
): Promise<SeededProjectInfo> {
  const projectName = `task10-export-${Date.now()}`;
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(projectName);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);
  await expect(page.getByTestId('autosave-status')).toHaveText('saved');

  const url = new URL(page.url());
  const preprocessId = url.searchParams.get('preprocess_id');
  if (!preprocessId) throw new Error('Missing preprocess_id in URL');

  await page.evaluate(async ({ id, storageMode }) => {
    const key = 'spatial-preprocess-projects';
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error('No preprocess storage payload found');
    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable for test seed');
    context.fillStyle = 'rgb(180,180,180)';
    context.fillRect(0, 0, 320, 240);
    const eosinCropDataUrl = canvas.toDataURL('image/png');
    const eosinSourceDataUrl = canvas.toDataURL('image/png');
    context.fillStyle = 'rgb(120,120,120)';
    context.fillRect(20, 20, 280, 200);
    const alignedHeDataUrl = canvas.toDataURL('image/png');
    const heSourceDataUrl = canvas.toDataURL('image/png');
    context.fillStyle = 'rgb(200,80,80)';
    context.fillRect(60, 40, 140, 140);
    const focusedHeDataUrl = canvas.toDataURL('image/png');

    const projectedSpots = Array.from({ length: 16 }, (_, index) => {
      const row = Math.floor(index / 4) + 1;
      const col = (index % 4) + 1;
      const barcode = `50um-${String(row).padStart(3, '0')}-${String(col).padStart(3, '0')}`;
      return {
        id: barcode,
        barcode,
        arrayRow: row,
        arrayCol: col,
        x: (col - 0.5) / 4,
        y: (row - 0.5) / 4,
        diameterX: 0.12,
        diameterY: 0.12,
      };
    });

    const selected = projectedSpots.slice(0, 10).map((spot) => spot.id);
    const now = new Date().toISOString();
    const includeInlineDataUrls = storageMode === 'legacy-data-url';

    const next = projects.map((project) => {
      if (project.id !== id) return project;
      return {
        ...project,
        currentStep: 'exportState',
        updatedAt: now,
        sourceAssets: {
          ...(project.sourceAssets as Record<string, unknown>),
          status: 'ready',
          isStale: false,
          updatedAt: now,
          images: {
            eosin: {
              id: `seed-eosin-${id}`,
              kind: 'eosin',
              fileName: 'eosin.png',
              mimeType: 'image/png',
              sizeBytes: eosinSourceDataUrl.length,
              width: 320,
              height: 240,
              lastModified: Date.now(),
              ...(includeInlineDataUrls ? {
                dataUrl: eosinSourceDataUrl,
                thumbnailDataUrl: eosinSourceDataUrl,
              } : {}),
            },
            he: {
              id: `seed-he-${id}`,
              kind: 'he',
              fileName: 'he.png',
              mimeType: 'image/png',
              sizeBytes: heSourceDataUrl.length,
              width: 320,
              height: 240,
              lastModified: Date.now(),
              ...(includeInlineDataUrls ? {
                dataUrl: heSourceDataUrl,
                thumbnailDataUrl: heSourceDataUrl,
              } : {}),
            },
          },
        },
        localization: {
          ...(project.localization as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipBounds: {
            x: 0.05,
            y: 0.08,
            width: 0.24,
            height: 0.32,
          },
          handles: [],
          imageTransform: {
            rotationDegrees: 0,
            flipHorizontal: false,
            flipVertical: false,
            scale: 1,
          },
          error: null,
        },
        heFocus: {
          ...(project.heFocus as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipBounds: {
            x: 0.2,
            y: 0.15,
            width: 0.5,
            height: 0.5,
          },
          handles: [],
          imageTransform: {
            rotationDegrees: 0,
            flipHorizontal: false,
            flipVertical: false,
            scale: 1,
          },
          focusedImageDataUrl: null,
        },
        alignment: {
          ...(project.alignment as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          solveAccepted: true,
          error: null,
        },
        cropQc: {
          ...(project.cropQc as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          cropWidth: 320,
          cropHeight: 240,
          qcAccepted: true,
          eosinPreviewDataUrl: eosinCropDataUrl,
          previewDataUrl: alignedHeDataUrl,
          error: null,
        },
        chipConfig: {
          ...(project.chipConfig as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipType: '50um',
          rows: 50,
          columns: 50,
          projectedSpots,
          error: null,
        },
        tissueSelection: {
          ...(project.tissueSelection as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          selectedSpotIds: selected,
          autoSelectedSpotIds: selected,
          paritySummary: {
            selectedCount: selected.length,
            selectedPercent: (selected.length / projectedSpots.length) * 100,
            maskCoverage: (selected.length / projectedSpots.length) * 100,
          },
          error: null,
        },
        exportState: {
          ...(project.exportState as Record<string, unknown>),
          status: 'ready',
          isStale: false,
          updatedAt: now,
          error: null,
        },
      };
    });

    const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open('spatial-preprocess');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const writeStore = (db: IDBDatabase, store: string, keyName: string, value: string | Blob) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, keyName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    const toBlob = (dataUrl: string) => new Promise<Blob>((resolve, reject) => {
      fetch(dataUrl)
        .then((response) => response.blob())
        .then(resolve)
        .catch(reject);
    });

    const db = await openDb();
    const [eosinSourceValue, heSourceValue, eosinThumbnailValue, heThumbnailValue] = storageMode === 'blob-backed'
      ? await Promise.all([
        toBlob(eosinSourceDataUrl),
        toBlob(heSourceDataUrl),
        toBlob(eosinSourceDataUrl),
        toBlob(heSourceDataUrl),
      ])
      : [eosinSourceDataUrl, heSourceDataUrl, eosinSourceDataUrl, heSourceDataUrl];

    await Promise.all([
      writeStore(db, 'preprocess-source-images', `${id}:eosin`, eosinSourceValue),
      writeStore(db, 'preprocess-source-images', `${id}:he`, heSourceValue),
      writeStore(db, 'preprocess-thumbnails', `${id}:eosin`, eosinThumbnailValue),
      writeStore(db, 'preprocess-thumbnails', `${id}:he`, heThumbnailValue),
      writeStore(db, 'preprocess-derived-images', `${id}:he-focus`, focusedHeDataUrl),
    ]);
    db.close();

    window.localStorage.setItem(key, JSON.stringify(next));
  }, { preprocessId: preprocessId, storageMode, id: preprocessId });

  await page.reload();

  return {
    preprocessId,
    projectName,
  };
}

test('blob-backed preprocess storage hydrates source images after reload and routes through HE Focus', async ({ page }) => {
  await seedProjectToExportReady(page, 'blob-backed');

  await page.getByTestId('preprocess-step-localize').click();
  await expect(page.getByTestId('preprocess-step-he-focus')).toBeEnabled();
  await expect(page.getByTestId('preprocess-step-align')).toBeEnabled();
  await expect(page.getByText('No eosin image loaded')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Localization canvas' })).toBeVisible();

  await page.getByTestId('preprocess-step-he-focus').click();
  await expect(page.getByRole('heading', { name: 'H&E focus canvas' })).toBeVisible();
  await expect(page.getByText('No H&E image loaded')).toBeHidden();
  await expect(page.getByTestId('he-focus-focused-image-card')).toBeVisible();
  await page.getByTestId('he-focus-stage-reset').click();
  await expect(page.getByTestId('preprocess-step-align')).toBeEnabled();
});

test('export full preprocess ZIP with recovery payload', async ({ page }) => {
  const { preprocessId } = await seedProjectToExportReady(page);
  const storedState = await inspectStoredProjectState(page, preprocessId);
  expect(storedState.heFocusFocusedImageDataUrl).toBeNull();
  expect(storedState.hasDerivedStore).toBe(true);
  expect(storedState.derivedAssetKind).toBe('string');

  await page.getByTestId('export-include-project').check();
  await page.getByTestId('export-include-aligned-image').check();

  const download = await downloadExportOrThrow(page, preprocessId);
  const filePath = await download.path();
  if (!filePath) throw new Error('Missing downloaded zip path');

  const bytes = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.keys(zip.files).sort();

  expect(entries).toEqual(expect.arrayContaining([
    'process.png',
    'scalefactors.json',
    'tissue_matrix.csv',
    'tissue_res_image.png',
    'tissue_position.csv',
    'project.json',
    'aligned_tissue_image.png',
    HE_FOCUS_PACKAGE_PATH,
  ]));

   const projectEntry = zip.file('project.json');
   if (!projectEntry) throw new Error('Missing project.json in export zip');
   const projectPayload = JSON.parse(await projectEntry.async('text')) as {
     project: {
       heFocus: {
         focusedImageDataUrl: string | null;
       };
     };
   };
   expect(projectPayload.project.heFocus.focusedImageDataUrl).toBeNull();

  const scalefactorsEntry = zip.file('scalefactors.json');
  if (!scalefactorsEntry) throw new Error('Missing scalefactors.json in export zip');
  const scalefactorsText = await scalefactorsEntry.async('text');
  const scalefactors = JSON.parse(scalefactorsText) as Record<string, unknown>;
  expect(scalefactors).toHaveProperty('spot_diameter_fullres');
  expect(scalefactors).toHaveProperty('fiducial_diameter_fullres');
  expect(scalefactors).toHaveProperty('tissue_hires_scalef');
  expect(scalefactors).toHaveProperty('tissue_lowres_scalef');

  const csvEntry = zip.file('tissue_position.csv');
  if (!csvEntry) throw new Error('Missing tissue_position.csv in export zip');
  const csv = await csvEntry.async('text');
  const firstLine = csv.split(/\r?\n/)[0];
  expect(firstLine).toBe('barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres');

  await fs.writeFile(
    path.join(process.cwd(), '.sisyphus/evidence/task-10-export-happy.txt'),
    `download=${download.suggestedFilename()}\nentries=${entries.join(',')}\nheader=${firstLine}\n`,
  );
});

test('export includes the chip-sized tissue matrix csv', async ({ page }) => {
  const { preprocessId } = await seedProjectToExportReady(page);

  const download = await downloadExportOrThrow(page, preprocessId);
  const filePath = await download.path();
  if (!filePath) throw new Error('Missing downloaded zip path');

  const bytes = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(bytes);
  const matrixEntry = zip.file('tissue_matrix.csv');
  if (!matrixEntry) throw new Error('Missing tissue_matrix.csv in export zip');

  const matrixCsv = await matrixEntry.async('text');
  const rows = matrixCsv.trim().split(/\r?\n/);
  expect(rows).toHaveLength(50);
  expect(rows[0]?.split(',')).toHaveLength(50);
});

test('export derives tissue matrix content from regions when selectedSpotIds is missing', async () => {
  const baseDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=';
  const now = new Date().toISOString();
  const project: PreprocessProject = {
    id: 'export-region-derived',
    name: 'Region Derived Export',
    createdAt: now,
    updatedAt: now,
    workflowVersion: 1,
    storageVersion: 2,
    currentStep: 'exportState',
    sourceAssets: {
      status: 'ready',
      isStale: false,
      updatedAt: now,
      error: null,
      activeImage: 'eosin',
      oversizedImageWarning: null,
      images: { eosin: null, he: null },
    },
    localization: {
      status: 'complete',
      isStale: false,
      updatedAt: now,
      error: null,
      targetImage: 'eosin',
      chipType: '50um',
      method: 'manual',
      chipBounds: { x: 0, y: 0, width: 1, height: 1 },
      handles: [],
      boxColor: 'green',
      imageTransform: { rotationDegrees: 0, flipHorizontal: false, flipVertical: false, scale: 1 },
    },
    alignment: {
      status: 'complete',
      isStale: false,
      updatedAt: now,
      error: null,
      referenceImage: 'eosin',
      movingImage: 'he',
      movingImageTransform: { rotationDegrees: 0, flipHorizontal: false, flipVertical: false, scale: 1 },
      overlayOpacity: 0.5,
      controlPoints: [],
      inlierMask: null,
      affineMatrix: null,
      reprojectionRmse: null,
      inlierRatio: null,
      ransacReprojThreshold: null,
      qualityFlags: { minPairs: true, inlierRatio: true, rmse: true, finiteMatrix: true, scaleRange: true, accepted: true },
      solveAccepted: true,
      failureReason: null,
      transform: null,
      previewDataUrl: null,
    },
    cropQc: {
      status: 'complete',
      isStale: false,
      updatedAt: now,
      error: null,
      cropRect: { x: 0, y: 0, width: 1, height: 1 },
      cropWidth: 320,
      cropHeight: 240,
      paddingRatio: 0.02,
      checkerboardTileSize: 64,
      overlayOpacity: 0.5,
      qcAccepted: true,
      issues: [],
      eosinPreviewDataUrl: baseDataUrl,
      previewDataUrl: baseDataUrl,
      checkerboardPreviewDataUrl: null,
    },
    chipConfig: {
      status: 'complete',
      isStale: false,
      updatedAt: now,
      error: null,
      chipType: '50um',
      rows: 50,
      columns: 50,
      pitchX: 50,
      pitchY: 50,
      origin: { x: 0, y: 0 },
      rotationDegrees: 0,
      projectedSpots: [
        { id: 'spot-1', barcode: 'spot-1', arrayRow: 1, arrayCol: 1, x: 0.125, y: 0.125, diameterX: 0.12, diameterY: 0.12 },
        { id: 'spot-2', barcode: 'spot-2', arrayRow: 1, arrayCol: 2, x: 0.375, y: 0.125, diameterX: 0.12, diameterY: 0.12 },
      ],
    },
    tissueSelection: {
      status: 'complete',
      isStale: false,
      updatedAt: now,
      error: null,
      mode: 'polygon',
      thresholdMode: 'light',
      activationThreshold: 140,
      blockThreshold: 180,
      dbscanEps: 0.03,
      dbscanMinSamples: 3,
      minConnectedSpotCount: 8,
      autoSelectedSpotIds: [],
      forcedInSpotIds: [],
      forcedOutSpotIds: [],
      overrideNotice: null,
      paritySummary: { selectedCount: 1, selectedPercent: 50, maskCoverage: 50 },
      warning: null,
      regions: [
        {
          id: 'region-top-left',
          label: 'Region 1',
          color: '#3182ce',
          points: [
            { x: 0.05, y: 0.05 },
            { x: 0.20, y: 0.05 },
            { x: 0.20, y: 0.20 },
            { x: 0.05, y: 0.20 },
          ],
          paths: [[
            { x: 0.05, y: 0.05 },
            { x: 0.20, y: 0.05 },
            { x: 0.20, y: 0.20 },
            { x: 0.05, y: 0.20 },
          ]],
        },
      ],
      selectedRegionId: 'region-top-left',
      previewDataUrl: null,
      selectedSpotIds: null,
    },
    exportState: {
      status: 'ready',
      isStale: false,
      updatedAt: now,
      error: null,
      requestedFormats: [],
      lastExportedAt: null,
      artifacts: [],
    },
  };

  const output = await exportPreprocessZip({ project, includeProjectJson: false, includeAlignedImage: false });
  const zip = await JSZip.loadAsync(await output.blob.arrayBuffer());
  const matrixEntry = zip.file('tissue_matrix.csv');
  if (!matrixEntry) throw new Error('Missing tissue_matrix.csv in export zip');

  const matrixCsv = await matrixEntry.async('text');
  const matrixRows = matrixCsv.trim().split(/\r?\n/).map((row) => row.split(','));
  expect(matrixRows[0]?.[0]).toBe('1');
  expect(matrixRows[0]?.[1]).toBe('0');
});

test('recovery import restores a saved project from exported zip', async ({ page }) => {
  const { preprocessId, projectName } = await seedProjectToExportReady(page);

  await page.getByTestId('export-include-project').check();
  const download = await downloadExportOrThrow(page, preprocessId);

  const zipPath = path.join(process.cwd(), '.sisyphus/evidence/task-10-recovery-source.zip');
  await download.saveAs(zipPath);

  await page.goto('/preprocess');
  await page.getByTestId('preprocess-import-project').click();
  await page.locator('input[type="file"]').setInputFiles(zipPath);

  try {
    await expect(page).toHaveURL(/preprocess_id=/, { timeout: 15_000 });
  } catch {
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open workspace' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Open workspace' }).first().click();
    await expect(page).toHaveURL(/preprocess_id=/);
  }

  await expect(page.getByTestId('preprocess-step-export')).toBeEnabled();

  await page.screenshot({
    path: path.join(process.cwd(), '.sisyphus/evidence/task-10-export-recovery.png'),
    fullPage: true,
  });
});

test('recovery import restores a blob-backed project from exported zip', async ({ page }) => {
  const { preprocessId, projectName } = await seedProjectToExportReady(page, 'blob-backed');

  await page.getByTestId('export-include-project').check();
  const download = await downloadExportOrThrow(page, preprocessId);

  const zipPath = path.join(process.cwd(), '.sisyphus/evidence/task-10-recovery-source-blob.zip');
  await download.saveAs(zipPath);

  await page.goto('/preprocess');
  await page.getByTestId('preprocess-import-project').click();
  await page.locator('input[type="file"]').setInputFiles(zipPath);

  try {
    await expect(page).toHaveURL(/preprocess_id=/, { timeout: 15_000 });
  } catch {
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open workspace' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Open workspace' }).first().click();
    await expect(page).toHaveURL(/preprocess_id=/);
  }

  await page.reload();
  await expect(page.getByTestId('export-download-zip')).toBeVisible();

   const importedUrl = new URL(page.url());
   const importedPreprocessId = importedUrl.searchParams.get('preprocess_id');
   if (!importedPreprocessId) throw new Error('Missing imported preprocess_id in URL');

   const storedState = await inspectStoredProjectState(page, importedPreprocessId);
   expect(storedState.metaExists).toBe(true);
   expect(storedState.heFocusFocusedImageDataUrl).toBeNull();
   expect(storedState.hasDerivedStore).toBe(true);
   expect(storedState.derivedAssetKind).toBe('blob');
   expect(storedState.derivedAssetSize).toBeGreaterThan(0);
});

test('deleting a preprocess project removes the focused HE derived asset store entry', async ({ page }) => {
  const { preprocessId, projectName } = await seedProjectToExportReady(page, 'blob-backed');

  await page.getByTestId('export-include-project').check();
  const download = await downloadExportOrThrow(page, preprocessId);

  const zipPath = path.join(process.cwd(), '.sisyphus/evidence/task-10-delete-derived-source.zip');
  await download.saveAs(zipPath);

  await page.goto('/preprocess');
  await page.getByTestId('preprocess-import-project').click();
  await page.locator('input[type="file"]').setInputFiles(zipPath);

  try {
    await expect(page).toHaveURL(/preprocess_id=/, { timeout: 15_000 });
  } catch {
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open workspace' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Open workspace' }).first().click();
    await expect(page).toHaveURL(/preprocess_id=/);
  }

  const storedBeforeDelete = await inspectStoredProjectState(page, preprocessId);
  expect(storedBeforeDelete.derivedAssetKind).toBe('blob');
  expect(storedBeforeDelete.derivedAssetSize).toBeGreaterThan(0);

  await page.goto('/preprocess');
  await page.getByLabel(`Delete ${projectName}`).click();
  await expect(page.getByRole('heading', { name: projectName })).toHaveCount(0);

  const storedState = await inspectStoredProjectState(page, preprocessId);
  expect(storedState.metaExists).toBe(false);
  expect(storedState.derivedAssetKind).toBeNull();
  expect(storedState.derivedAssetSize).toBe(0);
});
