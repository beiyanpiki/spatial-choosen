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

