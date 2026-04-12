import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

async function createProject(page: import('@playwright/test').Page, name: string) {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(name);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);
}

async function uploadFileWithButton(
  page: import('@playwright/test').Page,
  buttonName: RegExp,
  filePath: string,
) {
  const uploadButton = page.getByRole('button', { name: buttonName });
  await uploadButton.click();
  await uploadButton.locator('xpath=following-sibling::input[@type="file"][1]').setInputFiles(filePath);
}

async function uploadSourceImages(
  page: import('@playwright/test').Page,
  options: { eosinPath: string; hePath?: string },
) {
  await page.getByTestId('preprocess-step-source-assets').click();
  await uploadFileWithButton(page, /Upload eosin image/i, options.eosinPath);

  if (options.hePath) {
    await uploadFileWithButton(page, /Upload H&E image/i, options.hePath);
  }
}

async function inspectStoredImageState(
  page: import('@playwright/test').Page,
  preprocessId: string,
  kind: 'eosin' | 'he',
) {
  return page.evaluate(async ({ preprocessId, kind }) => {
    const raw = window.localStorage.getItem('spatial-preprocess-projects');
    const projects = raw ? JSON.parse(raw) as Array<Record<string, unknown>> : [];
    const project = projects.find((entry) => entry.id === preprocessId) ?? null;
    const sourceAssets = project && typeof project.sourceAssets === 'object' && project.sourceAssets !== null
      ? project.sourceAssets as Record<string, unknown>
      : null;
    const images = sourceAssets && typeof sourceAssets.images === 'object' && sourceAssets.images !== null
      ? sourceAssets.images as Record<string, unknown>
      : null;
    const imageMeta = images && typeof images[kind] === 'object' && images[kind] !== null
      ? images[kind] as Record<string, unknown>
      : null;

    const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open('spatial-preprocess');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const readStore = (db: IDBDatabase, storeName: string, key: string) => new Promise<Blob | string | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result as Blob | string | undefined);
      request.onerror = () => reject(request.error);
    });

    const toDimensions = async (payload: Blob | string | undefined) => {
      if (!payload) return null;

      const src = payload instanceof Blob
        ? URL.createObjectURL(payload)
        : payload;

      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const element = new window.Image();
          element.onload = () => resolve(element);
          element.onerror = () => reject(new Error('Failed to decode stored image payload'));
          element.src = src;
        });

        return {
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
      } finally {
        if (payload instanceof Blob) {
          URL.revokeObjectURL(src);
        }
      }
    };

    const db = await openDb();
    const key = `${preprocessId}:${kind}`;
    const [sourcePayload, thumbnailPayload] = await Promise.all([
      readStore(db, 'preprocess-source-images', key),
      readStore(db, 'preprocess-thumbnails', key),
    ]);
    db.close();

    return {
      sourceMetaWidth: typeof imageMeta?.width === 'number' ? imageMeta.width : null,
      sourceMetaHeight: typeof imageMeta?.height === 'number' ? imageMeta.height : null,
      sourceDimensions: await toDimensions(sourcePayload),
      thumbnailDimensions: await toDimensions(thumbnailPayload),
    };
  }, { preprocessId, kind });
}

test('TIFF uploads are accepted for eosin and H&E images', async ({ page }) => {
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.tiff');
  const hePath = path.join(process.cwd(), 'tests/fixtures/preprocess/he.tiff');

  await createProject(page, `tiff-upload-${Date.now()}`);
  await uploadSourceImages(page, { eosinPath, hePath });

  await expect(page.getByTestId('preprocess-step-localize')).toBeEnabled();
  await expect(page.getByTestId('preprocess-step-align')).toBeDisabled();
  await expect(page.getByText(/eosin\.tiff/i)).toBeVisible();
  await expect(page.getByText(/he\.tiff/i)).toBeVisible();
});

test('new uploads persist source assets as blobs in IndexedDB', async ({ page }) => {
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');
  const hePath = path.join(process.cwd(), 'tests/fixtures/preprocess/he.png');

  await createProject(page, `blob-storage-${Date.now()}`);
  const projectId = new URL(page.url()).searchParams.get('preprocess_id');
  if (!projectId) throw new Error('Missing preprocess_id in URL');

  await uploadSourceImages(page, { eosinPath, hePath });
  await expect(page.getByTestId('preprocess-step-align')).toBeDisabled();
  await expect(page.getByTestId('autosave-status')).toContainText(/saved/i, { timeout: 20_000 });

  await page.reload();
  await expect(page.getByText(/eosin\.png/i)).toBeVisible();
  await expect(page.getByText(/he\.png/i)).toBeVisible();
});

test('large pixel images below the file-size cap are not rejected by the old pixel limit', async ({ page }) => {
  const oversizedPath = path.join(process.cwd(), 'test-results', `large-pixel-${Date.now()}.png`);
  await fs.mkdir(path.dirname(oversizedPath), { recursive: true });
  await sharp({
    create: {
      width: 9_963,
      height: 10_000,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  }).png().toFile(oversizedPath);
  const metadata = await sharp(oversizedPath).metadata();

  expect((metadata.width ?? 0) * (metadata.height ?? 0)).toBe(99_630_000);

  await createProject(page, `large-image-upload-${Date.now()}`);
  await uploadSourceImages(page, { eosinPath: oversizedPath });

  await expect(page.getByTestId('preprocess-step-localize')).toBeEnabled();
  await expect(page.getByText(/exceeds/i)).toBeHidden();

  await fs.rm(oversizedPath, { force: true });
});

test('uploaded source images generate 1000px-wide persisted interaction thumbnails while preserving original dimensions', async ({ page }) => {
  const fixtureDir = path.join(process.cwd(), '.sisyphus/evidence/generated-fixtures');
  const eosinPath = path.join(fixtureDir, `interaction-eosin-${Date.now()}.png`);
  const hePath = path.join(fixtureDir, `interaction-he-${Date.now()}.png`);
  await fs.mkdir(path.dirname(eosinPath), { recursive: true });

  await Promise.all([
    sharp({
      create: {
        width: 2000,
        height: 2000,
        channels: 3,
        background: { r: 180, g: 80, b: 80 },
      },
    }).png().toFile(eosinPath),
    sharp({
      create: {
        width: 2000,
        height: 2000,
        channels: 3,
        background: { r: 80, g: 80, b: 180 },
      },
    }).png().toFile(hePath),
  ]);

  await createProject(page, `interaction-thumbnails-${Date.now()}`);
  const preprocessId = new URL(page.url()).searchParams.get('preprocess_id');
  if (!preprocessId) throw new Error('Missing preprocess_id in URL');

  await uploadSourceImages(page, { eosinPath, hePath });
  await expect(page.getByTestId('autosave-status')).toContainText(/saved/i, { timeout: 20_000 });
  await page.waitForFunction((id) => {
    const raw = window.localStorage.getItem('spatial-preprocess-projects');
    const projects = raw ? JSON.parse(raw) as Array<Record<string, unknown>> : [];
    const project = projects.find((entry) => entry.id === id);
    const sourceAssets = project && typeof project.sourceAssets === 'object' && project.sourceAssets !== null
      ? project.sourceAssets as Record<string, unknown>
      : null;
    const images = sourceAssets && typeof sourceAssets.images === 'object' && sourceAssets.images !== null
      ? sourceAssets.images as Record<string, unknown>
      : null;
    const heImage = images && typeof images.he === 'object' && images.he !== null
      ? images.he as Record<string, unknown>
      : null;

    return typeof heImage?.width === 'number' && typeof heImage?.height === 'number';
  }, preprocessId);

  const [eosinState, heState] = await Promise.all([
    inspectStoredImageState(page, preprocessId, 'eosin'),
    inspectStoredImageState(page, preprocessId, 'he'),
  ]);

  expect(eosinState.sourceMetaWidth).toBe(2000);
  expect(eosinState.sourceMetaHeight).toBe(2000);
  expect(eosinState.sourceDimensions).toEqual({ width: 2000, height: 2000 });
  expect(eosinState.thumbnailDimensions).toEqual({ width: 1000, height: 1000 });

  expect(heState.sourceMetaWidth).toBe(2000);
  expect(heState.sourceMetaHeight).toBe(2000);
  expect(heState.sourceDimensions).toEqual({ width: 2000, height: 2000 });
  expect(heState.thumbnailDimensions).toEqual({ width: 1000, height: 1000 });

  await Promise.all([
    fs.rm(eosinPath, { force: true }),
    fs.rm(hePath, { force: true }),
  ]);
});
