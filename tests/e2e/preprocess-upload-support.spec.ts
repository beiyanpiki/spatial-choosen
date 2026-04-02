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

test('TIFF uploads are accepted for eosin and H&E images', async ({ page }) => {
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.tiff');
  const hePath = path.join(process.cwd(), 'tests/fixtures/preprocess/he.tiff');

  await createProject(page, `tiff-upload-${Date.now()}`);
  await page.getByTestId('preprocess-step-localize').click();
  await page.getByRole('button', { name: /Upload eosin image/i }).click();
  await page.locator('input[type="file"]').first().setInputFiles(eosinPath);

  await expect(page.getByTestId('preprocess-step-align')).toBeEnabled();

  await page.getByTestId('preprocess-step-align').click();
  await page.getByRole('button', { name: /Upload H&E image/i }).click();
  await page.locator('input[type="file"]').last().setInputFiles(hePath);

  await expect(page.getByTestId('alignment-runtime-status-badge')).toContainText(/ready/i, { timeout: 20_000 });
  await expect(page.getByText('H&E: he.tiff')).toBeVisible();
});

test('new uploads persist source assets as blobs in IndexedDB', async ({ page }) => {
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');
  const hePath = path.join(process.cwd(), 'tests/fixtures/preprocess/he.png');

  await createProject(page, `blob-storage-${Date.now()}`);
  const projectId = new URL(page.url()).searchParams.get('preprocess_id');
  if (!projectId) throw new Error('Missing preprocess_id in URL');

  await page.getByTestId('preprocess-step-localize').click();
  await page.getByRole('button', { name: /Upload eosin image/i }).click();
  await page.locator('input[type="file"]').first().setInputFiles(eosinPath);
  await page.getByTestId('preprocess-step-align').click();
  await page.getByRole('button', { name: /Upload H&E image/i }).click();
  await page.locator('input[type="file"]').last().setInputFiles(hePath);
  await expect(page.getByTestId('alignment-runtime-status-badge')).toContainText(/ready/i, { timeout: 20_000 });
  await page.getByTestId('preprocess-step-source-assets').click();
  await expect(page.getByTestId('autosave-status')).toContainText(/saved/i, { timeout: 20_000 });

  const persistedTypes = await page.evaluate(async (id) => {
    const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open('spatial-preprocess', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const readValue = async (db: IDBDatabase, storeName: string, keyName: string) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(keyName);
      const value = await new Promise<unknown>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return value;
    };

    const db = await openDb();
    const eosin = await readValue(db, 'preprocess-source-images', `${id}:eosin`);
    const he = await readValue(db, 'preprocess-source-images', `${id}:he`);

    return {
      eosin: eosin instanceof Blob ? eosin.type : typeof eosin,
      he: he instanceof Blob ? he.type : typeof he,
    };
  }, projectId);

  expect(persistedTypes).toEqual({
    eosin: 'image/png',
    he: 'image/png',
  });
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
  await page.getByTestId('preprocess-step-localize').click();
  await page.getByRole('button', { name: /Upload eosin image/i }).click();
  await page.locator('input[type="file"]').first().setInputFiles(oversizedPath);

  await expect(page.getByTestId('preprocess-step-align')).toBeEnabled();
  await expect(page.getByText(/exceeds/i)).toBeHidden();

  await fs.rm(oversizedPath, { force: true });
});
